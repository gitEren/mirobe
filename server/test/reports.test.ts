import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, mock, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { GarmentRow, TryOnRow } from '@mirobe/shared';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { openDb, type Db } from '../src/db/index';
import { getRow, upsertRow } from '../src/db/rows';
import { MediaStorage } from '../src/lib/storage';
import { AI_REPORT_DAILY_LIMIT } from '../src/lib/reports';
import { UsageLedger } from '../src/lib/usage';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PASSWORD = 'correct horse battery';

let base = '';
let db: Db;
let media: MediaStorage;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirobe-reports-'));

before(async () => {
  const config = loadConfig({ dataDir, openRouterKey: undefined, falKey: undefined, revenueCatSecret: undefined, devPlanOverride: undefined, authRateLimit: 1000 });
  db = openDb(':memory:');
  media = new MediaStorage(db, dataDir);
  const app = createApp({ db, config, media, usage: new UsageLedger(db) });
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

let accounts = 0;
/** A registered account that never allowed AI processing: reporting does not need it. */
async function account() {
  const email = `report${Date.now().toString(36)}${(accounts += 1)}@example.com`;
  const r = await call('POST', '/api/auth/register', undefined, { email, password: PASSWORD });
  assert.equal(r.status, 201);
  return r.body as { userId: string; token: string };
}

/** A garment with a studio image and AI tags, and a finished try-on with a clip. */
function wardrobe(userId: string) {
  const image = media.saveDataUrl(userId, PNG_1PX).url;
  const now = new Date(Date.now() - 1000).toISOString();
  const suffix = `${userId.slice(-8)}_${Math.random().toString(36).slice(2, 8)}`;
  const garment: GarmentRow = {
    id: `g_rep_${suffix}`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    name: 'Ceket',
    category: 'outerwear',
    subcategory: '',
    colors: [],
    material: '',
    pattern: '',
    seasons: [],
    formality: 3,
    occasions: [],
    styleTags: [],
    extraTags: [],
    description: '',
    confidence: 0.9,
    imageUrl: image,
    cutoutUrl: null,
    taggingStatus: 'ready',
    packshotUrl: image,
    packshotStatus: 'ready',
    source: 'camera',
    favorite: false,
    wornCount: 0,
    lastWornAt: null,
  };
  const tryon: TryOnRow = {
    id: `try_rep_${suffix}`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    avatarId: null,
    personUrl: image,
    garmentIds: [garment.id],
    status: 'ready',
    imageUrl: image,
    videoStatus: 'ready',
    videoUrl: image,
    provider: 'test',
    error: null,
  };
  upsertRow(db, 'garments', userId, garment);
  upsertRow(db, 'tryons', userId, tryon);
  return { garmentId: garment.id, tryonId: tryon.id };
}

const reports = (userId: string) =>
  db.prepare('SELECT * FROM ai_reports WHERE user_id = ? ORDER BY rowid').all(userId) as {
    id: string;
    target_type: string;
    target_id: string;
    reason: string;
    note: string | null;
    excerpt: string | null;
    handled_at: string | null;
  }[];

describe('POST /api/reports', () => {
  test('needs a registered session', async () => {
    const body = { targetType: 'stylist', targetId: 'a123', reason: 'other' };
    assert.equal((await call('POST', '/api/reports', undefined, body)).status, 401);
    const anon = (await call('POST', '/api/auth/anonymous')).body as { token: string };
    const refused = await call('POST', '/api/reports', anon.token, body);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'AUTH_REQUIRED');
  });

  test('validates the body', async () => {
    const user = await account();
    const valid = { targetType: 'stylist', targetId: 'a123', reason: 'other' };
    for (const body of [
      {},
      { ...valid, targetType: 'look' },
      { ...valid, reason: 'boring' },
      { ...valid, targetId: '' },
      { ...valid, targetId: 'x'.repeat(65) },
      { ...valid, targetId: 'a1\nREPORT fake' },
      { ...valid, note: 'x'.repeat(501) },
    ]) {
      const r = await call('POST', '/api/reports', user.token, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.code, 'VALIDATION');
    }
    assert.equal(reports(user.userId).length, 0);
  });

  test('records a report with its note and logs one operator line', async () => {
    const user = await account();
    const { tryonId } = wardrobe(user.userId);
    const info = mock.method(console, 'info', () => undefined);
    try {
      const r = await call('POST', '/api/reports', user.token, { targetType: 'tryon', targetId: tryonId, reason: 'inaccurate', note: '  Kollar yanlış  ', excerpt: 'ignored' });
      assert.equal(r.status, 201);
      assert.match(r.body.id, /^rep_/);
      assert.equal(r.body.hidden, undefined);
      assert.deepEqual(
        info.mock.calls.map((c) => c.arguments[0]),
        [`[mirobe] REPORT tryon ${tryonId} inaccurate`]
      );
    } finally {
      info.mock.restore();
    }
    const [row] = reports(user.userId);
    assert.equal(row.target_type, 'tryon');
    assert.equal(row.target_id, tryonId);
    assert.equal(row.reason, 'inaccurate');
    assert.equal(row.note, 'Kollar yanlış');
    // What the reporter saw comes from the server, not the client.
    assert.equal(row.excerpt, getRow(db, 'tryons', user.userId, tryonId)!.imageUrl);
    assert.equal(row.handled_at, null);
    // An inaccurate result stays where it was.
    assert.equal(getRow(db, 'tryons', user.userId, tryonId)!.deletedAt, null);
  });

  test('a blank note is stored as null; a Jev reply keeps its text', async () => {
    const user = await account();
    const r = await call('POST', '/api/reports', user.token, { targetType: 'stylist', targetId: 'a1727000000000', reason: 'offensive', note: '   ', excerpt: 'Bu kombin sana hiç yakışmaz.' });
    assert.equal(r.status, 201);
    assert.equal(r.body.hidden, undefined);
    const [row] = reports(user.userId);
    assert.equal(row.note, null);
    assert.equal(row.excerpt, 'Bu kombin sana hiç yakışmaz.');
  });

  test("the target must be the caller's own and not deleted", async () => {
    const owner = await account();
    const other = await account();
    const { garmentId, tryonId } = wardrobe(owner.userId);
    for (const [targetType, targetId] of [
      ['tryon', tryonId],
      ['video', tryonId],
      ['packshot', garmentId],
      ['tagging', garmentId],
      ['tryon', 'try_missing'],
      ['tagging', tryonId],
    ]) {
      const r = await call('POST', '/api/reports', other.token, { targetType, targetId, reason: 'offensive' });
      assert.equal(r.status, 404, `${targetType} ${targetId}`);
    }
    assert.equal(reports(other.userId).length, 0);
    // Nothing of the owner's was hidden by someone else's report.
    assert.equal(getRow(db, 'tryons', owner.userId, tryonId)!.deletedAt, null);
    assert.ok(getRow(db, 'garments', owner.userId, garmentId)!.packshotUrl);

    assert.equal((await call('DELETE', `/api/tryons/${tryonId}`, owner.token)).status, 200);
    assert.equal((await call('POST', '/api/reports', owner.token, { targetType: 'tryon', targetId: tryonId, reason: 'other' })).status, 404);
  });

  test('an offensive or privacy report hides the image from the reporter', async () => {
    const user = await account();
    const first = wardrobe(user.userId);

    const tryon = await call('POST', '/api/reports', user.token, { targetType: 'tryon', targetId: first.tryonId, reason: 'offensive' });
    assert.equal(tryon.status, 201);
    assert.equal(tryon.body.hidden.table, 'tryons');
    assert.ok(tryon.body.hidden.row.deletedAt);
    assert.ok(getRow(db, 'tryons', user.userId, first.tryonId)!.deletedAt);
    // Other devices drop it on their next pull, like a deleted try-on.
    const pulled = await call('GET', '/api/sync/pull?since=0', user.token);
    assert.ok(pulled.body.changes.tryons.find((t: TryOnRow) => t.id === first.tryonId).deletedAt);

    const second = wardrobe(user.userId);
    const clip = await call('POST', '/api/reports', user.token, { targetType: 'video', targetId: second.tryonId, reason: 'privacy' });
    assert.equal(clip.status, 201);
    const clipped = getRow(db, 'tryons', user.userId, second.tryonId)!;
    assert.equal(clipped.deletedAt, null);
    assert.equal(clipped.videoStatus, 'none');
    assert.equal(clipped.videoUrl, null);
    assert.equal(clip.body.hidden.row.videoStatus, 'none');

    const packshot = await call('POST', '/api/reports', user.token, { targetType: 'packshot', targetId: second.garmentId, reason: 'offensive' });
    assert.equal(packshot.status, 201);
    assert.equal(packshot.body.hidden.table, 'garments');
    const garment = getRow(db, 'garments', user.userId, second.garmentId)!;
    assert.equal(garment.packshotUrl, null);
    assert.equal(garment.packshotStatus, 'none');
    assert.equal(garment.deletedAt, null);

    // Tags are only recorded; a second report of a cleared studio image changes nothing.
    const tags = await call('POST', '/api/reports', user.token, { targetType: 'tagging', targetId: second.garmentId, reason: 'offensive' });
    assert.equal(tags.status, 201);
    assert.equal(tags.body.hidden, undefined);
    const again = await call('POST', '/api/reports', user.token, { targetType: 'packshot', targetId: second.garmentId, reason: 'privacy' });
    assert.equal(again.status, 201);
    assert.equal(again.body.hidden, undefined);
    const rows = reports(user.userId);
    assert.equal(rows.length, 5);
    // The review keeps the hidden images' paths and the tags as they were.
    assert.equal(rows[1].excerpt, clip.body.hidden.row.imageUrl);
    assert.match(rows[2].excerpt!, /^\/media\//);
    assert.equal(JSON.parse(rows[3].excerpt!).name, 'Ceket');
    assert.equal(rows[4].excerpt, null);
  });

  test(`allows ${AI_REPORT_DAILY_LIMIT} reports a day per account`, async () => {
    const user = await account();
    const other = await account();
    const body = { targetType: 'stylist', targetId: 'a1', reason: 'other' };
    for (let i = 0; i < AI_REPORT_DAILY_LIMIT; i += 1) assert.equal((await call('POST', '/api/reports', user.token, body)).status, 201);
    const refused = await call('POST', '/api/reports', user.token, body);
    assert.equal(refused.status, 429);
    assert.equal(refused.body.code, 'RATE_LIMITED');
    assert.equal(reports(user.userId).length, AI_REPORT_DAILY_LIMIT);
    // Another account is not affected, and yesterday's reports no longer count.
    assert.equal((await call('POST', '/api/reports', other.token, body)).status, 201);
    db.prepare('UPDATE ai_reports SET created_at = ? WHERE user_id = ?').run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), user.userId);
    assert.equal((await call('POST', '/api/reports', user.token, body)).status, 201);
  });

  test('account deletion removes the reports', async () => {
    const user = await account();
    const other = await account();
    const { tryonId } = wardrobe(user.userId);
    assert.equal((await call('POST', '/api/reports', user.token, { targetType: 'tryon', targetId: tryonId, reason: 'privacy', note: 'Yüzüm' })).status, 201);
    assert.equal((await call('POST', '/api/reports', other.token, { targetType: 'stylist', targetId: 'a2', reason: 'other' })).status, 201);
    assert.equal(reports(user.userId).length, 1);

    assert.equal((await call('DELETE', '/api/me', user.token, { password: PASSWORD })).status, 200);
    assert.equal(reports(user.userId).length, 0);
    assert.equal(reports(other.userId).length, 1);
  });
});
