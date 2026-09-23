import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { GarmentRow, TryOnRow, UsageKind } from '@mirobe/shared';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { openDb } from '../src/db/index';
import { getRow, upsertRow } from '../src/db/rows';
import { MediaStorage } from '../src/lib/storage';
import { UsageLedger } from '../src/lib/usage';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PASSWORD = 'correct horse battery';
const KINDS: UsageKind[] = ['images', 'videos', 'stylist', 'taggings'];
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirobe-consent-'));
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

/** Every chat call gets this back: valid garment tags and a small-talk stylist turn in one object. */
const MODEL_JSON = {
  isGarment: true,
  onPerson: false,
  name: 'Siyah Ceket',
  category: 'outerwear',
  subcategory: 'Ceket',
  colors: [{ name: 'Siyah', hex: '#111111' }],
  material: '',
  pattern: 'solid',
  seasons: ['autumn'],
  formality: 3,
  occasions: ['casual'],
  styleTags: ['minimal'],
  extraTags: [],
  description: 'x',
  confidence: 0.9,
  intent: 'chat',
  reply: 'Merhaba!',
  brief: '',
  mustIncludeIds: [],
  avoidIds: [],
  skipSlots: [],
  keepFromCurrentIds: [],
};

/** An OpenRouter stand-in that answers every call the AI routes make, and records them. */
async function fakeProvider() {
  const calls: string[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      calls.push(`${req.method} ${req.url}`);
      const json = (value: unknown) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
      if (req.url?.startsWith('/api/v1/videos')) return json({ id: 'job_consent' });
      if (req.url?.startsWith('/api/alpha/decisions')) return json({ model: 'jev', answers: {}, usage: { input_tokens: 0, output_tokens: 0 } });
      if (body.includes('"modalities"')) return json({ choices: [{ message: { content: '', images: [{ type: 'image_url', image_url: { url: PNG_1PX } }] } }] });
      json({ choices: [{ message: { content: JSON.stringify(MODEL_JSON) } }], usage: { cost: 0 } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => server.close() };
}

/** A throwaway app on Pro (so clips pass the plan check) with the live mirror on (so its routes are gated too). */
async function localApp(openRouterBase = 'http://127.0.0.1:9') {
  const config = loadConfig({
    dataDir,
    openRouterKey: 'test-key',
    openRouterBase,
    falKey: undefined,
    revenueCatSecret: undefined,
    devPlanOverride: 'pro',
    authRateLimit: 1000,
    liveMirrorEnabled: true,
  });
  const db = openDb(':memory:');
  const media = new MediaStorage(db, dataDir);
  const usage = new UsageLedger(db);
  const app = createApp({ db, config, media, usage });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (method: string, route: string, token?: string, body?: unknown) =>
    fetch(`${url}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => null)) as any }));
  let n = 0;
  /** A registered account that has not answered the consent question yet. */
  const account = async (email = `consent${Date.now().toString(36)}${(n += 1)}@example.com`) => {
    const r = await call('POST', '/api/auth/register', undefined, { email, password: PASSWORD });
    assert.equal(r.status, 201);
    return r.body as { userId: string; token: string; email: string };
  };
  const used = (userId: string) => Object.fromEntries(KINDS.map((kind) => [kind, usage.snapshot(userId, 'pro')[kind].used]));
  return { db, media, usage, call, account, used, close: () => server.close() };
}

function garment(id: string, imageUrl: string): GarmentRow {
  const now = new Date().toISOString();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    name: '',
    category: null,
    subcategory: '',
    colors: [],
    material: '',
    pattern: '',
    seasons: [],
    formality: 0,
    occasions: [],
    styleTags: [],
    extraTags: [],
    description: '',
    confidence: 0,
    imageUrl,
    cutoutUrl: null,
    taggingStatus: 'pending',
    packshotUrl: null,
    packshotStatus: 'none',
    source: 'camera',
    favorite: false,
    wornCount: 0,
    lastWornAt: null,
  };
}

function readyTryOn(id: string, imageUrl: string): TryOnRow {
  const now = new Date().toISOString();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    avatarId: null,
    personUrl: imageUrl,
    garmentIds: [],
    status: 'ready',
    imageUrl,
    videoStatus: 'none',
    videoUrl: null,
    provider: 'test',
    error: null,
  };
}

/** One pending garment and one finished try-on, and every AI route with a body that would otherwise go through. */
function wardrobe(local: Awaited<ReturnType<typeof localApp>>, userId: string) {
  const image = local.media.saveDataUrl(userId, PNG_1PX);
  const garmentId = `g_consent_${userId.slice(-8)}`;
  const tryonId = `try_consent_${userId.slice(-8)}`;
  upsertRow(local.db, 'garments', userId, garment(garmentId, image.url));
  upsertRow(local.db, 'tryons', userId, readyTryOn(tryonId, image.url));
  const routes: [string, unknown][] = [
    [`/api/garments/${garmentId}/analyze`, { lang: 'tr' }],
    [`/api/garments/${garmentId}/packshot`, {}],
    ['/api/stylist/decide', { query: 'pub', lang: 'tr' }],
    ['/api/stylist/chat', { lang: 'tr', messages: [{ role: 'user', text: 'selam' }] }],
    ['/api/tryons', { garmentIds: [garmentId], personImageUrl: image.url }],
    [`/api/tryons/${tryonId}/video`, {}],
    ['/api/live/start', { garmentId }],
    ['/api/live/token', { sessionId: 'no-such-session' }],
  ];
  return { garmentId, tryonId, routes };
}

describe('AI processing consent', () => {
  test('every AI route refuses an account without consent, before any quota or provider work', async () => {
    const provider = await fakeProvider();
    const local = await localApp(provider.url);
    try {
      const auth = await local.account();
      const { garmentId, tryonId, routes } = wardrobe(local, auth.userId);
      assert.equal((await local.call('GET', '/api/me', auth.token)).body.aiConsent, false);
      for (const [url, body] of routes) {
        const response = await local.call('POST', url, auth.token, body);
        assert.equal(response.status, 403, url);
        assert.equal(response.body.code, 'AI_CONSENT_REQUIRED', url);
      }
      assert.deepEqual(provider.calls, []);
      assert.deepEqual(local.used(auth.userId), { images: 0, videos: 0, stylist: 0, taggings: 0 });
      // Nothing was claimed or created either.
      const stored = getRow(local.db, 'garments', auth.userId, garmentId)!;
      assert.deepEqual([stored.taggingStatus, stored.packshotStatus], ['pending', 'none']);
      assert.equal(getRow(local.db, 'tryons', auth.userId, tryonId)!.videoStatus, 'none');
      assert.equal((local.db.prepare('SELECT COUNT(*) AS n FROM tryons WHERE user_id = ?').get(auth.userId) as { n: number }).n, 1);
    } finally {
      local.close();
      provider.close();
    }
  });

  test('after consent the routes run; withdrawing it blocks them again', async () => {
    const provider = await fakeProvider();
    const local = await localApp(provider.url);
    try {
      const auth = await local.account();
      const { routes } = wardrobe(local, auth.userId);
      assert.deepEqual((await local.call('POST', '/api/me/ai-consent', auth.token, { granted: true })).body, { aiConsent: true });
      assert.equal((await local.call('GET', '/api/me', auth.token)).body.aiConsent, true);

      const statuses: number[] = [];
      for (const [url, body] of routes) {
        const response = await local.call('POST', url, auth.token, body);
        assert.notEqual(response.body?.code, 'AI_CONSENT_REQUIRED', url);
        statuses.push(response.status);
      }
      // Tagged, studio image, Jev decided (nothing to pick: refunded), Jev replied, try-on, clip started;
      // the live mirror got past the gate to fal (not configured here: refunded) and to its session check.
      assert.deepEqual(statuses, [200, 200, 200, 200, 201, 202, 503, 403]);
      assert.deepEqual(local.used(auth.userId), { images: 2, videos: 1, stylist: 1, taggings: 1 });
      const calls = provider.calls.length;
      assert.ok(calls >= 5, provider.calls.join(', '));

      assert.deepEqual((await local.call('POST', '/api/me/ai-consent', auth.token, { granted: false })).body, { aiConsent: false });
      assert.equal((await local.call('GET', '/api/me', auth.token)).body.aiConsent, false);
      for (const [url, body] of routes) {
        const response = await local.call('POST', url, auth.token, body);
        assert.equal(response.body.code, 'AI_CONSENT_REQUIRED', url);
      }
      assert.equal(provider.calls.length, calls);
      assert.deepEqual(local.used(auth.userId), { images: 2, videos: 1, stylist: 1, taggings: 1 });
    } finally {
      local.close();
      provider.close();
    }
  });

  test('the consent route needs a session and a boolean; consent belongs to one account', async () => {
    const local = await localApp();
    try {
      assert.equal((await local.call('POST', '/api/me/ai-consent', undefined, { granted: true })).status, 401);
      const alice = await local.account();
      const bob = await local.account();
      for (const body of [{}, { granted: 'yes' }, { granted: 1 }, undefined]) {
        const response = await local.call('POST', '/api/me/ai-consent', alice.token, body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(response.body.code, 'VALIDATION');
      }
      assert.equal((await local.call('POST', '/api/me/ai-consent', alice.token, { granted: true })).status, 200);
      const firstGrant = (local.db.prepare('SELECT ai_consent_at FROM users WHERE id = ?').get(alice.userId) as { ai_consent_at: string }).ai_consent_at;
      assert.ok(firstGrant);
      // Granting again keeps the time of the first grant.
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.deepEqual((await local.call('POST', '/api/me/ai-consent', alice.token, { granted: true })).body, { aiConsent: true });
      assert.equal((local.db.prepare('SELECT ai_consent_at FROM users WHERE id = ?').get(alice.userId) as { ai_consent_at: string }).ai_consent_at, firstGrant);
      assert.equal((await local.call('GET', '/api/me', bob.token)).body.aiConsent, false);
    } finally {
      local.close();
    }
  });

  test('/api/me keeps its shape and adds aiConsent; anonymous users still sign in first', async () => {
    const local = await localApp();
    try {
      const anonymous = (await local.call('POST', '/api/auth/anonymous')).body as { userId: string; token: string };
      const me = await local.call('GET', '/api/me', anonymous.token);
      assert.deepEqual(Object.keys(me.body).sort(), ['aiConsent', 'email', 'isAnonymous', 'notices', 'usage', 'userId']);
      assert.equal(me.body.aiConsent, false);
      // A session may record consent, but AI features still need an account: that is asked first.
      assert.deepEqual((await local.call('POST', '/api/me/ai-consent', anonymous.token, { granted: true })).body, { aiConsent: true });
      const refused = await local.call('POST', '/api/stylist/chat', anonymous.token, { lang: 'tr', messages: [{ role: 'user', text: 'selam' }] });
      assert.equal(refused.status, 403);
      assert.equal(refused.body.code, 'AUTH_REQUIRED');
    } finally {
      local.close();
    }
  });

  test('deleting an account is unaffected by consent, and a new account with the same email starts without it', async () => {
    const local = await localApp();
    try {
      const auth = await local.account();
      assert.equal((await local.call('POST', '/api/me/ai-consent', auth.token, { granted: true })).status, 200);
      assert.equal((await local.call('DELETE', '/api/me', auth.token, { password: PASSWORD })).status, 200);
      assert.equal(local.db.prepare('SELECT 1 FROM users WHERE id = ?').get(auth.userId), undefined);
      const again = await local.account(auth.email);
      assert.notEqual(again.userId, auth.userId);
      assert.equal((await local.call('GET', '/api/me', again.token)).body.aiConsent, false);
    } finally {
      local.close();
    }
  });

  test('the consent column migration can run again on a live database', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirobe-consent-migrate-'));
    try {
      let db = openDb(dir);
      db.prepare("INSERT INTO users (id, created_at, ai_consent_at) VALUES ('u_consented', '2026-01-01', '2026-09-23T12:00:00.000Z')").run();
      db.prepare('DELETE FROM schema_migrations WHERE version >= 7').run();
      db.close();
      db = openDb(dir);
      const row = db.prepare("SELECT ai_consent_at FROM users WHERE id = 'u_consented'").get() as { ai_consent_at: string };
      assert.equal(row.ai_consent_at, '2026-09-23T12:00:00.000Z');
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
