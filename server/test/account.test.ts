import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { GarmentRow } from '@mirobe/shared';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { openDb, type Db } from '../src/db/index';
import { MediaStorage } from '../src/lib/storage';
import { UsageLedger } from '../src/lib/usage';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PASSWORD = 'correct horse battery';

let base = '';
let db: Db;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirobe-account-'));
const mediaFile = (url: string) => path.join(dataDir, 'media', path.basename(url));

before(async () => {
  const config = loadConfig({ dataDir, openRouterKey: undefined, falKey: undefined, revenueCatSecret: undefined, devPlanOverride: undefined, authRateLimit: 1000 });
  db = openDb(':memory:');
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

let accounts = 0;
const uniqueEmail = () => `delete${Date.now().toString(36)}${(accounts += 1)}@example.com`;

const anonymous = async () => (await call('POST', '/api/auth/anonymous')).body as { userId: string; token: string };

/** A user with one uploaded photo and one garment pointing at it. */
async function withWardrobe(token: string) {
  const upload = await call('POST', '/api/media', token, { dataUrl: PNG_1PX });
  assert.equal(upload.status, 201);
  const now = new Date().toISOString();
  const row: GarmentRow = {
    id: `g_${Math.random().toString(36).slice(2)}`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    name: 'Shirt',
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
    imageUrl: upload.body.url,
    cutoutUrl: null,
    taggingStatus: 'pending',
    packshotUrl: null,
    packshotStatus: 'none',
    source: 'camera',
    favorite: false,
    wornCount: 0,
    lastWornAt: null,
  };
  assert.equal((await call('POST', '/api/sync/push', token, { changes: [{ table: 'garments', row }] })).status, 200);
  assert.ok(fs.existsSync(mediaFile(upload.body.url)));
  return { url: upload.body.url as string, garmentId: row.id };
}

const count = (sql: string, ...params: string[]) => (db.prepare(sql).get(...params) as { n: number }).n;

describe('account deletion', () => {
  test('needs a session', async () => {
    assert.equal((await call('DELETE', '/api/me')).status, 401);
  });

  test('an anonymous account is deleted without a password, with its rows and media', async () => {
    const user = await anonymous();
    const { url } = await withWardrobe(user.token);

    const deleted = await call('DELETE', '/api/me', user.token, {});
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { ok: true });

    assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', user.userId), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM garments WHERE user_id = ?', user.userId), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM media WHERE user_id = ?', user.userId), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?', user.userId), 0);
    assert.equal(fs.existsSync(mediaFile(url)), false);
    assert.notEqual((await fetch(`${base}${url}`)).status, 200);
    assert.equal((await call('GET', '/api/me', user.token)).status, 401);
  });

  test('a registered account needs its current password', async () => {
    const email = uniqueEmail();
    const account = (await call('POST', '/api/auth/register', undefined, { email, password: PASSWORD })).body as { userId: string; token: string };
    const { url } = await withWardrobe(account.token);

    for (const body of [{}, { password: 'wrong password!' }]) {
      const refused = await call('DELETE', '/api/me', account.token, body);
      assert.equal(refused.status, 401);
      assert.equal(refused.body.code, 'INVALID_CREDENTIALS');
    }
    // Nothing was touched by the refused attempts.
    assert.equal((await call('GET', '/api/me', account.token)).status, 200);
    assert.ok(fs.existsSync(mediaFile(url)));

    assert.equal((await call('DELETE', '/api/me', account.token, { password: PASSWORD })).status, 200);
    assert.equal(fs.existsSync(mediaFile(url)), false);
    assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', account.userId), 0);
    const login = await call('POST', '/api/auth/login', undefined, { email, password: PASSWORD });
    assert.equal(login.status, 401);
    // The email is free again.
    assert.equal((await call('POST', '/api/auth/register', undefined, { email, password: PASSWORD })).status, 201);
  });

  test('also removes anonymous users merged into the account, and leaves other users alone', async () => {
    const email = uniqueEmail();
    const account = (await call('POST', '/api/auth/register', undefined, { email, password: PASSWORD })).body as { userId: string; token: string };
    const anon = await anonymous();
    const anonWardrobe = await withWardrobe(anon.token);
    // Signing in on the anonymous device merges its wardrobe into the account.
    const login = await call('POST', '/api/auth/login', anon.token, { email, password: PASSWORD });
    assert.equal(login.status, 200);

    const bystander = await anonymous();
    const kept = await withWardrobe(bystander.token);

    assert.equal((await call('DELETE', '/api/me', login.body.token, { password: PASSWORD })).status, 200);
    for (const id of [account.userId, anon.userId]) assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', id), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM garments WHERE id = ?', anonWardrobe.garmentId), 0);
    assert.equal(fs.existsSync(mediaFile(anonWardrobe.url)), false);
    // The other device's session was revoked as well.
    assert.equal((await call('GET', '/api/me', account.token)).status, 401);

    assert.ok(fs.existsSync(mediaFile(kept.url)));
    assert.equal(count('SELECT COUNT(*) AS n FROM garments WHERE id = ?', kept.garmentId), 1);
    assert.equal((await call('GET', '/api/me', bystander.token)).status, 200);
  });
});
