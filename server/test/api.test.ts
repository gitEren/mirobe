import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { PLANS, type GarmentRow, type UsageKind } from '@mirobe/shared';
import { createApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { openDb } from '../src/db/index';
import { upsertRow } from '../src/db/rows';
import { resolvePlan } from '../src/lib/entitlements';
import { MediaStorage } from '../src/lib/storage';
import { UsageLedger } from '../src/lib/usage';
import { heuristicDecision } from '../src/ai/stylist';
import { tryOnCacheKey } from '../src/ai/tryon';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirobe-test-'));
const KINDS: UsageKind[] = ['images', 'videos', 'stylist', 'taggings'];

before(async () => {
  const config = loadConfig({ dataDir, openRouterKey: undefined, falKey: undefined, revenueCatSecret: undefined, devPlanOverride: undefined, authRateLimit: 1000, liveMirrorEnabled: false });
  const db = openDb(':memory:');
  const app = createApp({ db, config, media: new MediaStorage(db, dataDir), usage: new UsageLedger(db) });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(method: string, url: string, token?: string, body?: unknown) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

async function newUser() {
  const { body } = await call('POST', '/api/auth/anonymous');
  return body as { userId: string; token: string };
}

let accounts = 0;
const uniqueEmail = () => `user${Date.now().toString(36)}${(accounts += 1)}@example.com`;

/** A registered (email) account that allowed AI processing: AI endpoints refuse anonymous users and accounts without consent. */
async function newAccount(url = base, { aiConsent = true } = {}) {
  const response = await fetch(`${url}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: uniqueEmail(), password: 'correct horse battery' }),
  });
  assert.equal(response.status, 201);
  const account = (await response.json()) as { userId: string; token: string; email: string };
  if (aiConsent) {
    const consent = await fetch(`${url}/api/me/ai-consent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ granted: true }),
    });
    assert.equal(consent.status, 200);
  }
  return account;
}

function garment(id: string, overrides: Partial<GarmentRow> = {}): GarmentRow {
  const now = new Date().toISOString();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    name: 'Test',
    category: 'top',
    subcategory: '',
    colors: [],
    material: '',
    pattern: '',
    seasons: [],
    formality: 2,
    occasions: [],
    styleTags: [],
    extraTags: [],
    description: '',
    confidence: 0.9,
    imageUrl: '/media/x.png',
    cutoutUrl: null,
    taggingStatus: 'ready',
    packshotUrl: null,
    packshotStatus: 'none',
    source: 'camera',
    favorite: false,
    wornCount: 0,
    lastWornAt: null,
    ...overrides,
  };
}

describe('auth', () => {
  test('rejects missing and bogus tokens', async () => {
    assert.equal((await call('GET', '/api/me')).status, 401);
    assert.equal((await call('GET', '/api/me', 'nope')).status, 401);
  });

  test('anonymous user gets a free-plan usage snapshot with a count per bucket', async () => {
    const user = await newUser();
    const me = await call('GET', '/api/me', user.token);
    assert.equal(me.status, 200);
    assert.equal(me.body.usage.planId, 'free');
    assert.deepEqual(Object.keys(me.body.usage).sort(), ['images', 'periodStart', 'planId', 'stylist', 'taggings', 'videos']);
    for (const kind of KINDS) assert.deepEqual(me.body.usage[kind], { used: 0, limit: PLANS.free[kind] }, kind);
  });
});

describe('media', () => {
  test('uploads an image and serves it', async () => {
    const user = await newUser();
    const upload = await call('POST', '/api/media', user.token, { dataUrl: PNG_1PX });
    assert.equal(upload.status, 201);
    assert.match(upload.body.url, /^\/media\/.+\.png$/);
    const file = await fetch(`${base}${upload.body.url}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
  });
});

describe('sync', () => {
  test('push then pull returns rows after the cursor', async () => {
    const user = await newUser();
    const push = await call('POST', '/api/sync/push', user.token, {
      changes: [{ table: 'garments', row: garment('g_sync_1') }, { table: 'garments', row: garment('g_sync_2') }],
    });
    assert.equal(push.status, 200);
    assert.equal(push.body.accepted, 2);

    const pull = await call('GET', '/api/sync/pull?since=0', user.token);
    assert.deepEqual(pull.body.changes.garments.map((g: GarmentRow) => g.id).sort(), ['g_sync_1', 'g_sync_2']);
    const again = await call('GET', `/api/sync/pull?since=${pull.body.cursor}`, user.token);
    assert.equal(again.body.changes.garments.length, 0);
  });

  test('last write wins and stale writes come back as rejected', async () => {
    const user = await newUser();
    const newer = garment('g_lww_item', { name: 'Newer', updatedAt: '2026-09-21T12:00:00.000Z' });
    const older = garment('g_lww_item', { name: 'Older', updatedAt: '2026-09-21T11:00:00.000Z' });
    await call('POST', '/api/sync/push', user.token, { changes: [{ table: 'garments', row: newer }] });
    const stale = await call('POST', '/api/sync/push', user.token, { changes: [{ table: 'garments', row: older }] });
    assert.equal(stale.body.accepted, 0);
    assert.equal(stale.body.rejected[0].row.name, 'Newer');
  });

  test('tombstones propagate and hide rows from the wardrobe', async () => {
    const user = await newUser();
    await call('POST', '/api/sync/push', user.token, { changes: [{ table: 'garments', row: garment('g_del_item') }] });
    const deleted = garment('g_del_item', { deletedAt: new Date(Date.now() + 1000).toISOString(), updatedAt: new Date(Date.now() + 1000).toISOString() });
    await call('POST', '/api/sync/push', user.token, { changes: [{ table: 'garments', row: deleted }] });
    const pull = await call('GET', '/api/sync/pull?since=0', user.token);
    assert.ok(pull.body.changes.garments.find((g: GarmentRow) => g.id === 'g_del_item').deletedAt);
  });

  test('cannot overwrite another user row or push server-owned tables', async () => {
    const alice = await newUser();
    const bob = await newUser();
    await call('POST', '/api/sync/push', alice.token, { changes: [{ table: 'garments', row: garment('g_owned_item') }] });
    const hijack = await call('POST', '/api/sync/push', bob.token, {
      changes: [{ table: 'garments', row: garment('g_owned_item', { updatedAt: '2099-01-01T00:00:00.000Z' }) }],
    });
    assert.equal(hijack.status, 403);
    const tryon = await call('POST', '/api/sync/push', bob.token, { changes: [{ table: 'tryons', row: {} }] });
    assert.equal(tryon.status, 400);
    const bobPull = await call('GET', '/api/sync/pull?since=0', bob.token);
    assert.equal(bobPull.body.changes.garments.length, 0);
  });
});

describe('stylist', () => {
  const wardrobe = [
    garment('top_party', { category: 'top', occasions: ['night_out', 'party'], formality: 3, name: 'Siyah Saten Gömlek' }),
    garment('top_office', { category: 'top', occasions: ['work'], formality: 4, name: 'Beyaz Poplin Gömlek' }),
    garment('bottom_jeans', { category: 'bottom', occasions: ['casual', 'night_out'], formality: 2, name: 'Koyu Kot' }),
    garment('bottom_trousers', { category: 'bottom', occasions: ['work'], formality: 4, name: 'Kumaş Pantolon' }),
    garment('shoes_boots', { category: 'shoes', occasions: ['night_out'], formality: 3, name: 'Chelsea Bot' }),
    garment('untagged', { category: 'top', taggingStatus: 'pending' }),
  ];

  test('heuristic picks items matching the detected occasion', () => {
    const pub = heuristicDecision('bu akşam pub a gidiyorum', wardrobe, 'tr');
    assert.equal(pub.occasion, 'night_out');
    assert.equal(pub.selection.top, 'top_party');
    assert.equal(pub.selection.bottom, 'bottom_jeans');
    const office = heuristicDecision('yarın ofiste toplantım var', wardrobe, 'tr');
    assert.equal(office.selection.top, 'top_office');
    assert.equal(office.selection.bottom, 'bottom_trousers');
    assert.ok(!office.garmentIds.includes('untagged'));
  });

  test('exclude asks for an alternative when one exists', () => {
    const next = heuristicDecision('pub', wardrobe, 'tr', ['top_party']);
    assert.equal(next.selection.top, 'top_office');
  });

  test('endpoint uses the server-side wardrobe and charges one decision', async () => {
    const user = await newAccount();
    await call('POST', '/api/sync/push', user.token, {
      changes: wardrobe.map((row) => ({ table: 'garments', row: { ...row, id: `${row.id}_${user.userId.slice(-6)}` } })),
    });
    const response = await call('POST', '/api/stylist/decide', user.token, { query: 'pub gecesi', lang: 'tr' });
    assert.equal(response.status, 200);
    assert.equal(response.body.decision.provider, 'heuristic');
    assert.ok(response.body.decision.garmentIds.length >= 2);
    assert.equal(response.body.usage.stylist.used, 1);
  });
});

describe('try-on and quotas', () => {
  test('requires a mirror photo first', async () => {
    const user = await newAccount();
    await call('POST', '/api/sync/push', user.token, { changes: [{ table: 'garments', row: garment(`g_t_${user.userId}`) }] });
    const response = await call('POST', '/api/tryons', user.token, { garmentIds: [`g_t_${user.userId}`] });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'AVATAR_REQUIRED');
  });

  test('cache key ignores garment order but not avatar', () => {
    assert.equal(tryOnCacheKey('a1', ['x', 'y'], 'm'), tryOnCacheKey('a1', ['y', 'x'], 'm'));
    assert.notEqual(tryOnCacheKey('a1', ['x'], 'm'), tryOnCacheKey('a2', ['x'], 'm'));
  });

  test('ledger counts one per action and refuses once the monthly limit is reached', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO users (id, created_at) VALUES ('u1', '2026-01-01')").run();
    const ledger = new UsageLedger(db);
    for (let i = 0; i < PLANS.free.images; i += 1) ledger.reserve('u1', 'free', 'images', i === 0 ? 'packshot:g1' : `tryon:k${i}`);
    assert.throws(() => ledger.reserve('u1', 'free', 'images', 'tryon:one_more'), /limit/);
    assert.deepEqual(ledger.snapshot('u1', 'free').images, { used: PLANS.free.images, limit: PLANS.free.images });
    // Each bucket has its own count.
    ledger.reserve('u1', 'free', 'taggings', 'tag:g1');
    ledger.reserve('u1', 'free', 'stylist');
    const snap = ledger.snapshot('u1', 'free');
    assert.deepEqual([snap.taggings.used, snap.stylist.used, snap.videos.used], [1, 1, 0]);
    // The free plan has no videos at all.
    assert.throws(() => ledger.reserve('u1', 'free', 'videos', 'clip:try_x'), /limit/);
  });

  test('a refund gives the count back, and an event counts once whatever units it stored', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO users (id, created_at) VALUES ('u2', '2026-01-01')").run();
    const ledger = new UsageLedger(db);
    const first = ledger.reserve('u2', 'plus', 'images', 'tryon:a');
    ledger.reserve('u2', 'plus', 'images', 'packshot:g');
    assert.equal(ledger.snapshot('u2', 'plus').images.used, 2);
    ledger.refund(first);
    assert.equal(ledger.snapshot('u2', 'plus').images.used, 1);
    const insert = db.prepare('INSERT INTO usage_events (id, user_id, kind, units, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    // Stored with a unit amount, as before count-based quotas: still one image.
    insert.run('ev_old_units', 'u2', 'images', 20, 'tryon:old', new Date().toISOString());
    // Last month's events are not counted.
    insert.run('ev_last_month', 'u2', 'images', 1, 'tryon:older', '2020-01-01T00:00:00.000Z');
    assert.deepEqual(ledger.snapshot('u2', 'plus').images, { used: 2, limit: PLANS.plus.images });
  });
});

describe('try-on history', () => {
  test('deleting an unknown try-on is a 404', async () => {
    const user = await newUser();
    const response = await call('DELETE', '/api/tryons/try_missing_one', user.token);
    assert.equal(response.status, 404);
  });

  test('re-using a cached render is free and moves it to the top', async () => {
    const config = loadConfig({ dataDir, openRouterKey: undefined, falKey: undefined, revenueCatSecret: undefined, devPlanOverride: undefined, authRateLimit: 1000 });
    const db = openDb(':memory:');
    const media = new MediaStorage(db, dataDir);
    const app = createApp({ db, config, media, usage: new UsageLedger(db) });
    const local = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const url = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
    try {
      const auth = await newAccount(url);
      const person = media.saveDataUrl(auth.userId, PNG_1PX);
      const garmentId = `g_cache_${auth.userId}`;
      upsertRow(db, 'garments', auth.userId, garment(garmentId));
      const earlier = '2026-01-01T00:00:00.000Z';
      upsertRow(
        db,
        'tryons',
        auth.userId,
        {
          id: 'try_cached_render',
          createdAt: earlier,
          updatedAt: earlier,
          deletedAt: null,
          avatarId: null,
          personUrl: person.url,
          garmentIds: [garmentId],
          status: 'ready',
          imageUrl: person.url,
          videoStatus: 'none',
          videoUrl: null,
          provider: config.tryonModel,
          error: null,
        },
        { extra: { cache_key: tryOnCacheKey(person.url, [garmentId], config.tryonModel) } }
      );
      const response = await fetch(`${url}/api/tryons`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ garmentIds: [garmentId], personImageUrl: person.url }),
      });
      const body = (await response.json()) as any;
      assert.equal(response.status, 200);
      assert.equal(body.cached, true);
      assert.equal(body.tryon.id, 'try_cached_render');
      assert.equal(body.tryon.createdAt, earlier);
      assert.ok(body.tryon.updatedAt > earlier);
      assert.equal(body.usage.images.used, 0);
    } finally {
      local.close();
    }
  });
});

describe('paid generations are idempotent', () => {
  test('concurrent video taps start a single job', async () => {
    // A slow fake provider: submitting a video takes 300 ms, then fails.
    let calls = 0;
    const provider = http.createServer((_req, res) => {
      calls += 1;
      setTimeout(() => res.writeHead(500).end('{"error":{"message":"boom"}}'), 300);
    });
    await new Promise<void>((resolve) => provider.listen(0, resolve));
    const config = loadConfig({
      dataDir,
      openRouterKey: 'test-key',
      openRouterBase: `http://127.0.0.1:${(provider.address() as AddressInfo).port}`,
      falKey: undefined,
      revenueCatSecret: undefined,
      devPlanOverride: 'pro',
      authRateLimit: 1000,
    });
    const db = openDb(':memory:');
    const media = new MediaStorage(db, dataDir);
    const ledger = new UsageLedger(db);
    const app = createApp({ db, config, media, usage: ledger });
    const local = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const url = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
    try {
      const auth = await newAccount(url);
      const image = media.saveDataUrl(auth.userId, PNG_1PX);
      const now = new Date().toISOString();
      upsertRow(db, 'tryons', auth.userId, {
        id: 'try_concurrency_test',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        avatarId: null,
        personUrl: image.url,
        garmentIds: [],
        status: 'ready',
        imageUrl: image.url,
        videoStatus: 'none',
        videoUrl: null,
        provider: 'test',
        error: null,
      });
      const tap = () =>
        fetch(`${url}/api/tryons/try_concurrency_test/video`, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' }, body: '{}' });
      const statuses = (await Promise.all([tap(), tap(), tap()])).map((r) => r.status).sort();
      // Exactly one request claimed the clip and reached the provider; the others saw it processing.
      // The provider's 500 reaches the client as a 502 PROVIDER_ERROR, never as its own status.
      assert.deepEqual(statuses, [200, 200, 502]);
      assert.equal(calls, 1);
      assert.equal(ledger.snapshot(auth.userId, 'pro').videos.used, 0);
    } finally {
      local.close();
      provider.close();
    }
  });
});

describe('email accounts', () => {
  const password = 'correct horse battery';

  test('anonymous users report no email', async () => {
    const user = await newUser();
    const me = await call('GET', '/api/me', user.token);
    assert.equal(me.body.email, null);
    assert.equal(me.body.isAnonymous, true);
  });

  test('registers a new account with a normalised email', async () => {
    const email = uniqueEmail();
    const response = await call('POST', '/api/auth/register', undefined, { email: `  ${email.toUpperCase()} `, password, name: 'Ada' });
    assert.equal(response.status, 201);
    assert.equal(response.body.email, email);
    const me = await call('GET', '/api/me', response.body.token);
    assert.equal(me.status, 200);
    assert.equal(me.body.userId, response.body.userId);
    assert.equal(me.body.email, email);
    assert.equal(me.body.isAnonymous, false);
  });

  test('validates email and password', async () => {
    assert.equal((await call('POST', '/api/auth/register', undefined, { email: 'not-an-email', password })).status, 400);
    assert.equal((await call('POST', '/api/auth/register', undefined, { email: uniqueEmail(), password: 'short' })).status, 400);
    assert.equal((await call('POST', '/api/auth/register', undefined, { email: uniqueEmail(), password: 'x'.repeat(129) })).status, 400);
  });

  test('registering while anonymous upgrades the same user and keeps the wardrobe', async () => {
    const anon = await newUser();
    await call('POST', '/api/sync/push', anon.token, { changes: [{ table: 'garments', row: garment(`g_up_${anon.userId}`) }] });
    const response = await call('POST', '/api/auth/register', anon.token, { email: uniqueEmail(), password });
    assert.equal(response.status, 201);
    assert.equal(response.body.userId, anon.userId);
    assert.notEqual(response.body.token, anon.token);
    // The anonymous bearer token no longer grants access to the now password-protected account.
    assert.equal((await call('GET', '/api/me', anon.token)).status, 401);
    const pull = await call('GET', '/api/sync/pull?since=0', response.body.token);
    assert.deepEqual(pull.body.changes.garments.map((g: GarmentRow) => g.id), [`g_up_${anon.userId}`]);
  });

  test('duplicate email is refused case-insensitively', async () => {
    const local = `dup${Date.now().toString(36)}`;
    assert.equal((await call('POST', '/api/auth/register', undefined, { email: `Foo.${local}@x.com`, password })).status, 201);
    for (const email of [`foo.${local}@x.com`, `FOO.${local}@X.COM`, ` foo.${local}@x.com `]) {
      const again = await call('POST', '/api/auth/register', undefined, { email, password });
      assert.equal(again.status, 409);
      assert.equal(again.body.code, 'EMAIL_TAKEN');
    }
    // An anonymous caller trying to claim a taken email is refused and stays anonymous.
    const anon = await newUser();
    const claim = await call('POST', '/api/auth/register', anon.token, { email: `foo.${local}@x.com`, password });
    assert.equal(claim.status, 409);
    assert.equal((await call('GET', '/api/me', anon.token)).body.isAnonymous, true);
  });

  test('email uniqueness is enforced by the database and the migration is re-runnable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirobe-migrate-'));
    try {
      let db = openDb(dir);
      db.prepare("INSERT INTO users (id, created_at, email) VALUES ('u_a', '2026-01-01', 'same@x.com')").run();
      assert.throws(
        () => db.prepare("INSERT INTO users (id, created_at, email) VALUES ('u_b', '2026-01-01', 'SAME@x.com')").run(),
        /UNIQUE constraint failed/
      );
      // Many anonymous users share a NULL email.
      db.prepare("INSERT INTO users (id, created_at) VALUES ('u_c', '2026-01-01')").run();
      db.prepare("INSERT INTO users (id, created_at) VALUES ('u_d', '2026-01-01')").run();
      // Re-applying the accounts (and later) migrations on a database that already has them must not fail.
      db.prepare('DELETE FROM schema_migrations WHERE version >= 2').run();
      db.close();
      db = openDb(dir);
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 3);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('login issues a new token; wrong password and unknown email fail identically', async () => {
    const email = uniqueEmail();
    const registered = await call('POST', '/api/auth/register', undefined, { email, password });
    const login = await call('POST', '/api/auth/login', undefined, { email: email.toUpperCase(), password });
    assert.equal(login.status, 200);
    assert.equal(login.body.userId, registered.body.userId);
    assert.equal(login.body.email, email);
    assert.notEqual(login.body.token, registered.body.token);
    assert.equal((await call('GET', '/api/me', login.body.token)).body.email, email);

    const wrong = await call('POST', '/api/auth/login', undefined, { email, password: 'wrong password' });
    const unknown = await call('POST', '/api/auth/login', undefined, { email: uniqueEmail(), password });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.code, 'INVALID_CREDENTIALS');
    assert.deepEqual(wrong.body, unknown.body);
  });

  test('logout revokes only the current token', async () => {
    const email = uniqueEmail();
    const first = await call('POST', '/api/auth/register', undefined, { email, password });
    const second = await call('POST', '/api/auth/login', undefined, { email, password });
    assert.equal((await call('POST', '/api/auth/logout', first.body.token)).status, 200);
    assert.equal((await call('GET', '/api/me', first.body.token)).status, 401);
    assert.equal((await call('GET', '/api/me', second.body.token)).status, 200);
    assert.equal((await call('POST', '/api/auth/logout', first.body.token)).status, 401);
  });

  test('logging in from an anonymous device moves its wardrobe into the account', async () => {
    const account = await newAccount();
    const anon = await newUser();
    const photo = await call('POST', '/api/media', anon.token, { dataUrl: PNG_1PX });
    const id = `g_merge_${anon.userId}`;
    await call('POST', '/api/sync/push', anon.token, { changes: [{ table: 'garments', row: garment(id, { imageUrl: photo.body.url }) }] });
    const login = await call('POST', '/api/auth/login', anon.token, { email: account.email, password });
    assert.equal(login.status, 200);
    assert.equal(login.body.userId, account.userId);
    assert.equal((await call('GET', '/api/me', anon.token)).status, 401);
    const pull = await call('GET', '/api/sync/pull?since=0', login.body.token);
    assert.ok(pull.body.changes.garments.some((g: GarmentRow) => g.id === id));
    // The row is now the account's: further edits from this device are accepted.
    const edit = await call('POST', '/api/sync/push', login.body.token, {
      changes: [{ table: 'garments', row: garment(id, { imageUrl: photo.body.url, name: 'Merged', updatedAt: new Date(Date.now() + 1000).toISOString() }) }],
    });
    assert.equal(edit.body.accepted, 1);
  });
});

describe('AI features require an account', () => {
  const endpoints: [string, string, unknown][] = [
    ['POST', '/api/garments/g_any_garment/analyze', { lang: 'tr' }],
    ['POST', '/api/garments/g_any_garment/packshot', {}],
    ['POST', '/api/stylist/decide', { query: 'pub', lang: 'tr' }],
    ['POST', '/api/stylist/chat', { lang: 'tr', messages: [{ role: 'user', text: 'selam' }] }],
    ['POST', '/api/tryons', { garmentIds: ['g_any_garment'] }],
    ['POST', '/api/tryons/try_any_tryon/video', {}],
  ];

  test('anonymous users get AUTH_REQUIRED before any quota is reserved', async () => {
    const user = await newUser();
    for (const [method, url, body] of endpoints) {
      const response = await call(method, url, user.token, body);
      assert.equal(response.status, 403, url);
      assert.equal(response.body.code, 'AUTH_REQUIRED', url);
    }
    const me = await call('GET', '/api/me', user.token);
    for (const kind of KINDS) assert.equal(me.body.usage[kind].used, 0, kind);
  });

  test('without a token they are still 401', async () => {
    for (const [method, url, body] of endpoints) assert.equal((await call(method, url, undefined, body)).status, 401, url);
  });
});

describe('live mirror switch', () => {
  const liveRoutes: [string, unknown][] = [
    ['/api/live/start', { garmentId: 'g_any_garment' }],
    ['/api/live/token', { sessionId: 'anything' }],
    ['/api/live/stop', { sessionId: 'anything', usedSeconds: 3 }],
  ];

  test('while switched off, every live route answers 404 FEATURE_DISABLED before auth or quota', async () => {
    const anonymous = await newUser();
    const account = await newAccount();
    for (const [url, body] of liveRoutes) {
      for (const token of [undefined, 'bogus-token', anonymous.token, account.token]) {
        const response = await call('POST', url, token, body);
        assert.equal(response.status, 404, `${url} ${token ?? 'no token'}`);
        assert.equal(response.body.code, 'FEATURE_DISABLED', url);
      }
    }
    const me = await call('GET', '/api/me', account.token);
    for (const kind of KINDS) assert.equal(me.body.usage[kind].used, 0, kind);
  });

  test('LIVE_MIRROR_ENABLED switches it on; it is off by default', () => {
    const previous = process.env.LIVE_MIRROR_ENABLED;
    try {
      for (const [value, expected] of [[undefined, false], ['', false], ['false', false], ['true', true], ['1', true]] as const) {
        if (value === undefined) delete process.env.LIVE_MIRROR_ENABLED;
        else process.env.LIVE_MIRROR_ENABLED = value;
        assert.equal(loadConfig().liveMirrorEnabled, expected, String(value));
      }
    } finally {
      if (previous === undefined) delete process.env.LIVE_MIRROR_ENABLED;
      else process.env.LIVE_MIRROR_ENABLED = previous;
    }
  });

  /** A throwaway app with the live mirror switched on. */
  async function liveApp(devPlanOverride: Config['devPlanOverride']) {
    const config = loadConfig({ dataDir, openRouterKey: undefined, falKey: undefined, revenueCatSecret: undefined, devPlanOverride, authRateLimit: 1000, liveMirrorEnabled: true });
    const db = openDb(':memory:');
    const media = new MediaStorage(db, dataDir);
    const ledger = new UsageLedger(db);
    const app = createApp({ db, config, media, usage: ledger });
    const local = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const url = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
    const post = (auth: string | undefined, route: string, body: unknown) =>
      fetch(`${url}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify(body),
      }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => null)) as any }));
    return { db, media, ledger, url, post, close: () => local.close() };
  }

  test('switched on, the live routes keep their auth and plan checks', async () => {
    const free = await liveApp(undefined);
    try {
      for (const [url, body] of liveRoutes) assert.equal((await free.post(undefined, url, body)).status, 401, url);
      const anonymous = await free.post(undefined, '/api/auth/anonymous', {});
      assert.equal((await free.post(anonymous.body.token, '/api/live/start', { garmentId: 'g_any_garment' })).body.code, 'AUTH_REQUIRED');
      const auth = await newAccount(free.url);
      upsertRow(free.db, 'garments', auth.userId, garment('g_free_live'));
      const response = await free.post(auth.token, '/api/live/start', { garmentId: 'g_free_live' });
      assert.equal(response.status, 402);
      assert.equal(response.body.code, 'PLAN_REQUIRED');
    } finally {
      free.close();
    }
    const plus = await liveApp('plus');
    try {
      const auth = await newAccount(plus.url);
      upsertRow(plus.db, 'garments', auth.userId, garment('g_plus_live'));
      assert.equal((await plus.post(auth.token, '/api/live/start', { garmentId: 'g_plus_live' })).body.code, 'PLAN_REQUIRED');
    } finally {
      plus.close();
    }
  });

  test('switched on, Pro passes the plan check and a failed start is refunded', async () => {
    const local = await liveApp('pro');
    try {
      const auth = await newAccount(local.url);
      const image = local.media.saveDataUrl(auth.userId, PNG_1PX);
      upsertRow(local.db, 'garments', auth.userId, garment('g_pro_live', { imageUrl: image.url }));
      const live = await local.post(auth.token, '/api/live/start', { garmentId: 'g_pro_live' });
      // fal is not configured, so no paid session starts; the reserved video is refunded.
      assert.equal(live.body.code, 'PROVIDER_UNAVAILABLE', JSON.stringify(live.body));
      assert.equal(local.ledger.snapshot(auth.userId, 'pro').videos.used, 0);
    } finally {
      local.close();
    }
  });

  test('live token needs an open live session of the same user', async () => {
    const config = loadConfig({ dataDir, openRouterKey: undefined, falKey: undefined, revenueCatSecret: undefined, devPlanOverride: 'pro', authRateLimit: 1000, liveMirrorEnabled: true });
    const db = openDb(':memory:');
    const ledger = new UsageLedger(db);
    const app = createApp({ db, config, media: new MediaStorage(db, dataDir), usage: ledger });
    const local = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const url = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
    const token = (auth: string, sessionId: string) =>
      fetch(`${url}/api/live/token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
    try {
      const alice = await newAccount(url);
      const bob = await newAccount(url);
      assert.equal((await token(alice.token, 'no-such-session')).body.code, 'LIVE_SESSION_REQUIRED');
      const sessionId = ledger.reserve(alice.userId, 'pro', 'videos', 'live:g_x', 20);
      // Someone else's session id is not enough.
      assert.equal((await token(bob.token, sessionId)).body.code, 'LIVE_SESSION_REQUIRED');
      // An open session passes the gate; fal is not configured here, so no token is minted (no paid call).
      assert.equal((await token(alice.token, sessionId)).body.code, 'PROVIDER_UNAVAILABLE');
      await fetch(`${url}/api/live/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, usedSeconds: 3 }),
      });
      assert.equal((await token(alice.token, sessionId)).body.code, 'LIVE_SESSION_REQUIRED');
    } finally {
      local.close();
    }
  });
});

describe('plans', () => {
  /** A throwaway app with its own database, for plan-specific behaviour. */
  async function localApp(overrides: Partial<Config>) {
    const config = loadConfig({ dataDir, openRouterKey: undefined, falKey: undefined, revenueCatSecret: undefined, devPlanOverride: undefined, authRateLimit: 1000, ...overrides });
    const db = openDb(':memory:');
    const media = new MediaStorage(db, dataDir);
    const ledger = new UsageLedger(db);
    const app = createApp({ db, config, media, usage: ledger });
    const local = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const url = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
    const post = (auth: string, route: string, body: unknown) =>
      fetch(`${url}${route}`, { method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(
        async (r) => ({ status: r.status, body: (await r.json().catch(() => null)) as any })
      );
    return { db, media, ledger, url, post, close: () => local.close() };
  }

  function readyTryOn(db: ReturnType<typeof openDb>, media: MediaStorage, userId: string, id: string) {
    const image = media.saveDataUrl(userId, PNG_1PX);
    const now = new Date().toISOString();
    upsertRow(db, 'tryons', userId, {
      id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      avatarId: null,
      personUrl: image.url,
      garmentIds: [],
      status: 'ready',
      imageUrl: image.url,
      videoStatus: 'none',
      videoUrl: null,
      provider: 'test',
      error: null,
    });
  }

  test('plan rights are monthly counts', () => {
    const counts = (id: keyof typeof PLANS) => Object.fromEntries(KINDS.map((kind) => [kind, PLANS[id][kind]]));
    assert.deepEqual(counts('free'), { images: 3, videos: 0, stylist: 30, taggings: 20 });
    assert.deepEqual(counts('plus'), { images: 100, videos: 0, stylist: 300, taggings: 200 });
    assert.deepEqual(counts('pro'), { images: 200, videos: 8, stylist: 750, taggings: 450 });
  });

  test('usage stored in token/second units is migrated to counted buckets', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirobe-usage-'));
    try {
      let db = openDb(dir);
      db.prepare("INSERT INTO users (id, created_at) VALUES ('u_units', '2026-01-01')").run();
      const insert = db.prepare('INSERT INTO usage_events (id, user_id, kind, units, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      const now = new Date().toISOString();
      for (const [id, kind, units, ref] of [
        ['e1', 'photo_tokens', 20, 'tryon:k1'],
        ['e2', 'photo_tokens', 18, 'packshot:g1'],
        ['e3', 'photo_tokens', 1, 'tag:g1'],
        ['e4', 'photo_tokens', 1, 'tag:g2'],
        ['e5', 'video_seconds', 3, 'clip:try_1'],
        ['e6', 'jev_decisions', 1, null],
      ] as const) {
        insert.run(id, 'u_units', kind, units, ref, now);
      }
      db.prepare('DELETE FROM schema_migrations WHERE version >= 4').run();
      db.close();
      db = openDb(dir);
      const snap = new UsageLedger(db).snapshot('u_units', 'pro');
      assert.deepEqual([snap.images.used, snap.videos.used, snap.stylist.used, snap.taggings.used], [2, 1, 1, 2]);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('legacy premium entitlements resolve to Plus, Pro wins, expired ones are ignored', async () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO users (id, created_at) VALUES ('u_rc', '2026-01-01')").run();
    const config = loadConfig({ dataDir, revenueCatSecret: 'test-secret' });
    const realFetch = globalThis.fetch;
    const respond = (entitlements: Record<string, { expires_date: string | null }>) => {
      globalThis.fetch = (async () => new Response(JSON.stringify({ subscriber: { entitlements } }))) as typeof fetch;
    };
    const past = '2020-01-01T00:00:00Z';
    try {
      respond({ mirobe_premium: { expires_date: null } });
      assert.equal(await resolvePlan(db, config, 'u_rc', true), 'plus');
      respond({ premium: { expires_date: null }, mirobe_pro: { expires_date: null } });
      assert.equal(await resolvePlan(db, config, 'u_rc', true), 'pro');
      respond({ mirobe_plus: { expires_date: null }, mirobe_pro: { expires_date: past } });
      assert.equal(await resolvePlan(db, config, 'u_rc', true), 'plus');
      respond({ mirobe_pro: { expires_date: past } });
      assert.equal(await resolvePlan(db, config, 'u_rc', true), 'free');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('a cached premium plan reads as Plus and the migration rewrites it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirobe-plan-'));
    try {
      let db = openDb(dir);
      db.prepare("INSERT INTO users (id, created_at, plan, plan_checked_at) VALUES ('u_old', '2026-01-01', 'premium', ?)").run(new Date().toISOString());
      assert.equal(await resolvePlan(db, loadConfig({ dataDir, revenueCatSecret: 'test-secret' }), 'u_old'), 'plus');
      db.prepare('DELETE FROM schema_migrations WHERE version >= 3').run();
      db.close();
      db = openDb(dir);
      assert.equal((db.prepare("SELECT plan FROM users WHERE id = 'u_old'").get() as { plan: string }).plan, 'plus');
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('DEV_PLAN_OVERRIDE accepts plus, pro and the legacy premium name', () => {
    const previous = process.env.DEV_PLAN_OVERRIDE;
    try {
      for (const [value, expected] of [['plus', 'plus'], ['premium', 'plus'], ['pro', 'pro'], ['free', undefined], ['bogus', undefined]] as const) {
        process.env.DEV_PLAN_OVERRIDE = value;
        assert.equal(loadConfig().devPlanOverride, expected, value);
      }
    } finally {
      if (previous === undefined) delete process.env.DEV_PLAN_OVERRIDE;
      else process.env.DEV_PLAN_OVERRIDE = previous;
    }
  });

  test('every stylist chat turn counts one, small talk included', async () => {
    const user = await newAccount();
    const response = await call('POST', '/api/stylist/chat', user.token, { lang: 'tr', messages: [{ role: 'user', text: 'selam' }] });
    assert.equal(response.status, 200);
    assert.equal(response.body.usage.stylist.used, 1);
  });

  test('Plus has no videos: a clip is refused with PLAN_REQUIRED', async () => {
    const local = await localApp({ devPlanOverride: 'plus' });
    try {
      const auth = await newAccount(local.url);
      readyTryOn(local.db, local.media, auth.userId, 'try_plus');
      const clip = await local.post(auth.token, '/api/tryons/try_plus/video', {});
      assert.equal(clip.status, 402);
      assert.equal(clip.body.code, 'PLAN_REQUIRED');
      assert.equal(local.ledger.snapshot(auth.userId, 'plus').videos.used, 0);
    } finally {
      local.close();
    }
  });

  test('Pro can make a clip; it counts one video', async () => {
    // Fake OpenRouter video API that accepts the job.
    const provider = http.createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"id":"job_ok"}'));
    await new Promise<void>((resolve) => provider.listen(0, resolve));
    const local = await localApp({ devPlanOverride: 'pro', openRouterKey: 'test-key', openRouterBase: `http://127.0.0.1:${(provider.address() as AddressInfo).port}` });
    try {
      const auth = await newAccount(local.url);
      readyTryOn(local.db, local.media, auth.userId, 'try_pro_clip');
      const clip = await local.post(auth.token, '/api/tryons/try_pro_clip/video', {});
      assert.equal(clip.status, 202, JSON.stringify(clip.body));
      assert.equal(clip.body.tryon.videoStatus, 'processing');
      assert.deepEqual(clip.body.usage.videos, { used: 1, limit: PLANS.pro.videos });
    } finally {
      local.close();
      provider.close();
    }
  });

  test('Pro gets 8 clips a month, then QUOTA_EXCEEDED', async () => {
    const local = await localApp({ devPlanOverride: 'pro' });
    try {
      const auth = await newAccount(local.url);
      for (let i = 0; i < PLANS.pro.videos; i += 1) local.ledger.reserve(auth.userId, 'pro', 'videos', `clip:try_earlier_${i}`);
      readyTryOn(local.db, local.media, auth.userId, 'try_ninth');
      const clip = await local.post(auth.token, '/api/tryons/try_ninth/video', {});
      assert.equal(clip.status, 402);
      assert.equal(clip.body.code, 'QUOTA_EXCEEDED');
      assert.equal(local.ledger.snapshot(auth.userId, 'pro').videos.used, 8);
      // Nothing was claimed: the clip can be requested again next month.
      const row = local.db.prepare("SELECT json_extract(data, '$.videoStatus') AS status FROM tryons WHERE id = 'try_ninth'").get() as { status: string };
      assert.equal(row.status, 'none');
    } finally {
      local.close();
    }
  });

  for (const resolution of ['480p', '720p'] as const) {
    test(`a ${resolution} motion clip counts one video, refunded when the provider fails`, async () => {
      // Fake provider that holds the submission, so the reservation can be observed in flight.
      const provider = http.createServer((_req, res) => {
        setTimeout(() => res.writeHead(500).end('{"error":{"message":"boom"}}'), 300);
      });
      await new Promise<void>((resolve) => provider.listen(0, resolve));
      const local = await localApp({
        devPlanOverride: 'pro',
        videoResolution: resolution,
        openRouterKey: 'test-key',
        openRouterBase: `http://127.0.0.1:${(provider.address() as AddressInfo).port}`,
      });
      try {
        const auth = await newAccount(local.url);
        readyTryOn(local.db, local.media, auth.userId, `try_${resolution}`);
        const pending = local.post(auth.token, `/api/tryons/try_${resolution}/video`, {});
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(local.ledger.snapshot(auth.userId, 'pro').videos.used, 1);
        await pending;
        assert.equal(local.ledger.snapshot(auth.userId, 'pro').videos.used, 0);
      } finally {
        local.close();
        provider.close();
      }
    });
  }
});

describe('auth rate limiting', () => {
  test('limits attempts per IP and per email', async () => {
    const config = loadConfig({ dataDir, openRouterKey: undefined, falKey: undefined, revenueCatSecret: undefined, devPlanOverride: undefined, authRateLimit: 3 });
    const db = openDb(':memory:');
    const app = createApp({ db, config, media: new MediaStorage(db, dataDir), usage: new UsageLedger(db) });
    const local = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const url = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
    const login = (email: string, ip: string) =>
      fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify({ email, password: 'wrong password' }),
      }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
    try {
      // Same IP, different emails.
      for (let i = 0; i < 3; i += 1) assert.equal((await login(`ip${i}@x.com`, '203.0.113.1')).status, 401);
      const blocked = await login('ip9@x.com', '203.0.113.1');
      assert.equal(blocked.status, 429);
      assert.equal(blocked.body.code, 'RATE_LIMITED');
      // Same email from rotating IPs.
      for (let i = 0; i < 3; i += 1) assert.equal((await login('target@x.com', `198.51.100.${i}`)).status, 401);
      assert.equal((await login('TARGET@x.com', '198.51.100.99')).body.code, 'RATE_LIMITED');
    } finally {
      local.close();
    }
  });
});
