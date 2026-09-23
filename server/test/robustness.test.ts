import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { GarmentRow, TryOnRow, UsageKind } from '@mirobe/shared';
import { createApp, pollVideosOnce, sweepStaleJobs, VIDEO_MAX_AGE_MS, type AppContext } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { openDb } from '../src/db/index';
import { getRow, upsertRow } from '../src/db/rows';
import { HttpError, ProviderError, toClientError } from '../src/lib/http';
import { MediaStorage } from '../src/lib/storage';
import { UsageLedger } from '../src/lib/usage';
import { alertOutOfCredits, CREDITS_ALERT_INTERVAL_MS, imagesApiResolution } from '../src/ai/openrouter';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirobe-robust-'));
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;

/** A fake provider (OpenRouter-shaped) whose answers each test scripts per request. */
async function fakeProvider(handler: Handler) {
  const calls: string[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      calls.push(`${req.method} ${req.url}`);
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => server.close() };
}

async function localApp(overrides: Partial<Config> = {}) {
  const config = loadConfig({
    dataDir,
    openRouterKey: undefined,
    falKey: undefined,
    revenueCatSecret: undefined,
    devPlanOverride: 'pro',
    authRateLimit: 1000,
    ...overrides,
  });
  const db = openDb(':memory:');
  const media = new MediaStorage(db, dataDir);
  const usage = new UsageLedger(db);
  const ctx: AppContext = { db, config, media, usage };
  const app = createApp(ctx);
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
  /** A registered account that allowed AI processing (the AI routes refuse anything less). */
  const account = async () => {
    const r = await call('POST', '/api/auth/register', undefined, { email: `r${Date.now().toString(36)}${(n += 1)}@example.com`, password: 'correct horse battery' });
    assert.equal(r.status, 201);
    assert.equal((await call('POST', '/api/me/ai-consent', r.body.token, { granted: true })).status, 200);
    return r.body as { userId: string; token: string };
  };
  return { ctx, db, media, usage, url, call, account, close: () => server.close() };
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

function tryon(id: string, imageUrl: string, overrides: Partial<TryOnRow> = {}): TryOnRow {
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
    ...overrides,
  };
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** Backdates a row as if it had been written `ms` ago. */
function backdate(db: ReturnType<typeof openDb>, table: 'tryons' | 'garments', id: string, ms: number) {
  const stamp = ago(ms);
  const row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as { data: string };
  const data = { ...JSON.parse(row.data), updatedAt: stamp };
  db.prepare(`UPDATE ${table} SET data = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(data), stamp, id);
}

const backdateReservation = (db: ReturnType<typeof openDb>, eventId: string, ms: number) =>
  db.prepare('UPDATE usage_events SET created_at = ? WHERE id = ?').run(ago(ms), eventId);

describe('provider errors never reach clients as-is', () => {
  test('mapping keeps our statuses and turns provider failures into 502/503', () => {
    assert.deepEqual(toClientError(new HttpError(404, 'Garment not found')), { status: 404, code: undefined, message: 'Garment not found' });
    assert.equal(toClientError(new HttpError(402, 'x', 'QUOTA_EXCEEDED')).code, 'QUOTA_EXCEEDED');
    // An OpenRouter 401 must not become our 401 (the app would sign the user out).
    const unauthorized = toClientError(new ProviderError('openrouter', 401, 'User not found. raw provider text'));
    assert.deepEqual(unauthorized, { status: 502, code: 'PROVIDER_ERROR', message: 'AI provider error' });
    assert.equal(toClientError(new ProviderError('openrouter', 503, 'OPENROUTER_API_KEY is not configured')).status, 503);
    // SDK errors carrying the upstream status (fal ApiError) and bare network failures.
    assert.deepEqual(toClientError(Object.assign(new Error('Unauthorized'), { status: 401 })), { status: 502, code: 'PROVIDER_ERROR', message: 'AI provider error' });
    assert.equal(toClientError(new TypeError('fetch failed')).code, 'PROVIDER_UNAVAILABLE');
    assert.equal(toClientError(Object.assign(new Error('timeout'), { name: 'TimeoutError' })).status, 503);
    // Our own 5xx keeps its code but not its message.
    assert.deepEqual(toClientError(new HttpError(503, 'AI provider has no credits left', 'PROVIDER_CREDITS')), {
      status: 503,
      code: 'PROVIDER_CREDITS',
      message: 'AI provider unavailable',
    });
    // body-parser client errors keep their status.
    assert.equal(toClientError(Object.assign(new Error('request entity too large'), { status: 413, expose: true })).status, 413);
    assert.equal(toClientError(new Error('boom')).status, 500);
  });

  test('an upstream 401 on a paid call is a 502, refunded, with no provider text', async () => {
    const provider = await fakeProvider((_req, res) => res.writeHead(401).end('{"error":{"message":"User not found. sk-or-secret-detail"}}'));
    const local = await localApp({ openRouterKey: 'test-key', openRouterBase: provider.url });
    try {
      const auth = await local.account();
      const image = local.media.saveDataUrl(auth.userId, PNG_1PX);
      upsertRow(local.db, 'garments', auth.userId, garment('g_upstream401', { imageUrl: image.url }));
      const response = await local.call('POST', '/api/garments/g_upstream401/packshot', auth.token, {});
      assert.equal(response.status, 502);
      assert.equal(response.body.code, 'PROVIDER_ERROR');
      assert.ok(!JSON.stringify(response.body).includes('sk-or'), JSON.stringify(response.body));
      assert.equal(local.usage.snapshot(auth.userId, 'pro').images.used, 0);
      assert.equal(getRow(local.db, 'garments', auth.userId, 'g_upstream401')!.packshotStatus, 'failed');
      // The session is intact.
      assert.equal((await local.call('GET', '/api/me', auth.token)).status, 200);
    } finally {
      local.close();
      provider.close();
    }
  });

  test('an empty OpenRouter balance (402) refunds every paid call, reaches the app as PROVIDER_CREDITS and alerts once', async () => {
    const provider = await fakeProvider((_req, res) => res.writeHead(402).end('{"error":{"message":"Insufficient credits"}}'));
    const local = await localApp({ openRouterKey: 'test-key', openRouterBase: provider.url });
    const logged: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
    try {
      const auth = await local.account();
      const image = local.media.saveDataUrl(auth.userId, PNG_1PX);
      upsertRow(local.db, 'garments', auth.userId, garment('g_nocredit', { imageUrl: image.url, taggingStatus: 'pending' }));
      upsertRow(local.db, 'tryons', auth.userId, tryon('try_nocredit', image.url));

      // Tagging runs in the background of a sync: it answers 200 with a warning the app shows.
      const tagged = await local.call('POST', '/api/garments/g_nocredit/analyze', auth.token, { lang: 'tr' });
      assert.equal(tagged.status, 200);
      assert.equal(tagged.body.warning, 'PROVIDER_CREDITS');
      assert.equal(tagged.body.garment.taggingStatus, 'failed');
      for (const [url, body] of [
        ['/api/garments/g_nocredit/packshot', {}],
        ['/api/tryons', { garmentIds: ['g_nocredit'], personImageUrl: image.url }],
        ['/api/tryons/try_nocredit/video', {}],
        // Jev does not answer from the tag-matching fallback (and charge for it) either.
        ['/api/stylist/chat', { lang: 'tr', messages: [{ role: 'user', text: 'selam' }] }],
      ] as const) {
        const response = await local.call('POST', url, auth.token, body);
        assert.equal(response.status, 503, url);
        assert.equal(response.body.code, 'PROVIDER_CREDITS', url);
        assert.ok(!JSON.stringify(response.body).includes('Insufficient'), url);
      }
      const snap = local.usage.snapshot(auth.userId, 'pro');
      assert.deepEqual([snap.images.used, snap.videos.used, snap.stylist.used, snap.taggings.used], [0, 0, 0, 0]);
      assert.equal(getRow(local.db, 'garments', auth.userId, 'g_nocredit')!.packshotStatus, 'failed');
      assert.equal(getRow(local.db, 'tryons', auth.userId, 'try_nocredit')!.videoStatus, 'none');
      // One line for operators, however many requests hit the empty balance.
      const alerts = logged.filter((line) => line.includes('ALERT'));
      assert.equal(alerts.length, 1, alerts.join('\n'));
      assert.match(alerts[0], /^\[mirobe\] ALERT: AI provider out of credits \(openrouter\)/);
    } finally {
      console.error = realError;
      local.close();
      provider.close();
    }
  });

  test('the out-of-credits alert is logged at most once per ten minutes', () => {
    const logged: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
    try {
      // Past any alert an earlier test logged.
      const start = Date.now() + CREDITS_ALERT_INTERVAL_MS;
      assert.equal(alertOutOfCredits('openrouter', start), true);
      assert.equal(alertOutOfCredits('openrouter', start + 60_000), false);
      assert.equal(alertOutOfCredits('openrouter', start + CREDITS_ALERT_INTERVAL_MS - 1), false);
      assert.equal(alertOutOfCredits('openrouter', start + CREDITS_ALERT_INTERVAL_MS), true);
      assert.equal(logged.length, 2);
    } finally {
      console.error = realError;
    }
  });

  test('a failed try-on stores a generic error, not the provider message', async () => {
    const provider = await fakeProvider((_req, res) => res.writeHead(500).end('{"error":{"message":"internal upstream detail"}}'));
    const local = await localApp({ openRouterKey: 'test-key', openRouterBase: provider.url });
    try {
      const auth = await local.account();
      const image = local.media.saveDataUrl(auth.userId, PNG_1PX);
      upsertRow(local.db, 'garments', auth.userId, garment('g_tryfail', { imageUrl: image.url }));
      const response = await local.call('POST', '/api/tryons', auth.token, { garmentIds: ['g_tryfail'], personImageUrl: image.url });
      assert.equal(response.status, 502);
      const row = local.db.prepare('SELECT data FROM tryons WHERE user_id = ?').get(auth.userId) as { data: string };
      const stored = JSON.parse(row.data) as TryOnRow;
      assert.equal(stored.status, 'failed');
      assert.equal(stored.error, 'RENDER_FAILED');
      assert.equal(local.usage.snapshot(auth.userId, 'pro').images.used, 0);
    } finally {
      local.close();
      provider.close();
    }
  });
});

describe('garment analysis', () => {
  const TAGS = {
    isGarment: true,
    onPerson: true,
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
  };

  test('concurrent analyze taps charge once, and no packshot is rendered automatically', async () => {
    const provider = await fakeProvider((_req, res) => {
      const body = JSON.stringify({ choices: [{ message: { content: JSON.stringify(TAGS) } }], usage: { cost: 0 } });
      setTimeout(() => res.writeHead(200, { 'Content-Type': 'application/json' }).end(body), 200);
    });
    const local = await localApp({ openRouterKey: 'test-key', openRouterBase: provider.url });
    try {
      const auth = await local.account();
      const image = local.media.saveDataUrl(auth.userId, PNG_1PX);
      upsertRow(local.db, 'garments', auth.userId, garment('g_wornitem', { imageUrl: image.url, taggingStatus: 'pending', source: 'wearing', cutoutUrl: image.url }));
      const tap = () => local.call('POST', '/api/garments/g_wornitem/analyze', auth.token, { lang: 'tr' });
      const results = await Promise.all([tap(), tap(), tap()]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 202, 202]);
      assert.equal(provider.calls.length, 1, provider.calls.join(', '));
      assert.ok(provider.calls.every((c) => c.includes('/chat/completions')));
      const stored = getRow(local.db, 'garments', auth.userId, 'g_wornitem')!;
      assert.equal(stored.taggingStatus, 'ready');
      assert.equal(stored.packshotStatus, 'none');
      assert.equal(stored.cutoutUrl, null);
      // Tagging has its own bucket: one tagging, no image.
      const snap = local.usage.snapshot(auth.userId, 'pro');
      assert.deepEqual([snap.taggings.used, snap.images.used], [1, 0]);
    } finally {
      local.close();
      provider.close();
    }
  });

  test('a packshot left processing by a lost request can be claimed again', async () => {
    const local = await localApp();
    try {
      const auth = await local.account();
      const image = local.media.saveDataUrl(auth.userId, PNG_1PX);
      upsertRow(local.db, 'garments', auth.userId, garment('g_stuckitem', { imageUrl: image.url, packshotStatus: 'processing' }));
      // Fresh claim: another request is working on it.
      assert.equal((await local.call('POST', '/api/garments/g_stuckitem/packshot', auth.token, {})).status, 202);
      backdate(local.db, 'garments', 'g_stuckitem', 5 * 60 * 1000);
      // Stale: claimed again (OpenRouter is not configured, so it fails with 503 and refunds).
      const retry = await local.call('POST', '/api/garments/g_stuckitem/packshot', auth.token, {});
      assert.equal(retry.status, 503);
      assert.equal(retry.body.code, 'PROVIDER_UNAVAILABLE');
      assert.equal(local.usage.snapshot(auth.userId, 'pro').images.used, 0);
    } finally {
      local.close();
    }
  });

  test('images API resolution is only sent to models that accept it', () => {
    assert.equal(imagesApiResolution('bytedance-seed/seedream-4.5'), '2K');
    assert.equal(imagesApiResolution('microsoft/mai-image-2.6-flash'), undefined);
  });
});

describe('video poller', () => {
  async function setup(handler: Handler) {
    const provider = await fakeProvider(handler);
    const local = await localApp({ openRouterKey: 'test-key', openRouterBase: provider.url });
    const auth = await local.account();
    const image = local.media.saveDataUrl(auth.userId, PNG_1PX);
    /** A try-on whose clip was submitted as `job`, with its reservation made `ageMs` ago. */
    const clip = (id: string, job: string, ageMs = 0) => {
      const reservation = local.usage.reserve(auth.userId, 'pro', 'videos', `clip:${id}`);
      backdateReservation(local.db, reservation, ageMs);
      upsertRow(local.db, 'tryons', auth.userId, tryon(id, image.url, { videoStatus: 'processing' }), {
        extra: { video_request_id: `openrouter:${job}|${reservation}` },
      });
      return reservation;
    };
    const used = () => local.usage.snapshot(auth.userId, 'pro').videos.used;
    const row = (id: string) => getRow(local.db, 'tryons', auth.userId, id)!;
    const requestId = (id: string) => (local.db.prepare('SELECT video_request_id FROM tryons WHERE id = ?').get(id) as { video_request_id: string | null }).video_request_id;
    return { provider, local, clip, used, row, requestId, close: () => (local.close(), provider.close()) };
  }

  test('one broken job does not block the others; unknown states and 404s fail and refund', async () => {
    const t = await setup((req, res) => {
      const url = req.url ?? '';
      if (url.includes('/videos/boom')) return res.writeHead(500).end('{}');
      if (url.includes('/videos/gone')) return res.writeHead(404).end('{}');
      if (url.includes('/videos/weird')) return res.writeHead(200).end('{"status":"exploded"}');
      if (url.includes('/videos/done/content')) return res.writeHead(200, { 'Content-Type': 'video/mp4' }).end('MP4DATA');
      if (url.includes('/videos/done')) return res.writeHead(200).end('{"status":"completed"}');
      return res.writeHead(200).end('{"status":"in_progress"}');
    });
    try {
      t.clip('try_boom', 'boom');
      t.clip('try_gone', 'gone');
      t.clip('try_weird', 'weird');
      t.clip('try_done', 'done');
      t.clip('try_wait', 'wait');
      assert.equal(t.used(), 5);
      await pollVideosOnce(t.local.ctx);
      // Transient provider error: still processing, still charged, retried next pass.
      assert.equal(t.row('try_boom').videoStatus, 'processing');
      assert.ok(t.requestId('try_boom'));
      assert.equal(t.row('try_gone').videoStatus, 'failed');
      assert.equal(t.row('try_gone').error, 'CLIP_FAILED');
      assert.equal(t.row('try_weird').videoStatus, 'failed');
      assert.equal(t.row('try_done').videoStatus, 'ready');
      assert.ok(t.row('try_done').videoUrl?.startsWith('/media/'));
      assert.equal(t.row('try_wait').videoStatus, 'processing');
      // gone + weird refunded; boom, done and wait stay charged.
      assert.equal(t.used(), 3);
    } finally {
      t.close();
    }
  });

  test('a failed download of a finished clip is retried, not refunded', async () => {
    let downloads = 0;
    const t = await setup((req, res) => {
      if ((req.url ?? '').includes('/content')) {
        downloads += 1;
        return downloads === 1 ? res.writeHead(502).end('bad gateway') : res.writeHead(200).end('MP4DATA');
      }
      res.writeHead(200).end('{"status":"completed"}');
    });
    try {
      t.clip('try_download', 'dl');
      await pollVideosOnce(t.local.ctx);
      assert.equal(t.row('try_download').videoStatus, 'processing');
      assert.equal(t.used(), 1);
      await pollVideosOnce(t.local.ctx);
      assert.equal(t.row('try_download').videoStatus, 'ready');
      assert.equal(t.used(), 1);
    } finally {
      t.close();
    }
  });

  test('clips past the max age fail and are refunded, whether pending or erroring', async () => {
    const t = await setup((req, res) => {
      if ((req.url ?? '').includes('/videos/boom')) return res.writeHead(503).end('{}');
      res.writeHead(200).end('{"status":"queued"}');
    });
    try {
      t.clip('try_oldclip', 'slow', VIDEO_MAX_AGE_MS + 1000);
      t.clip('try_oldboom', 'boom', VIDEO_MAX_AGE_MS + 1000);
      t.clip('try_young', 'slow', 60_000);
      await pollVideosOnce(t.local.ctx);
      assert.equal(t.row('try_oldclip').videoStatus, 'failed');
      assert.equal(t.row('try_oldboom').videoStatus, 'failed');
      assert.equal(t.requestId('try_oldclip'), null);
      assert.equal(t.row('try_young').videoStatus, 'processing');
      assert.equal(t.used(), 1);
    } finally {
      t.close();
    }
  });
});

describe('startup sweep of lost jobs', () => {
  test('stale processing rows fail and their reservations are refunded; fresh ones stay', async () => {
    const local = await localApp();
    try {
      const auth = await local.account();
      const image = local.media.saveDataUrl(auth.userId, PNG_1PX);
      const OLD = 11 * 60 * 1000;
      const reserve = (kind: UsageKind, ref: string, ageMs: number) => backdateReservation(local.db, local.usage.reserve(auth.userId, 'pro', kind, ref), ageMs);

      // Try-ons: one lost render, one fresh.
      reserve('images', 'tryon:key_old', OLD);
      upsertRow(local.db, 'tryons', auth.userId, tryon('try_lost', image.url, { status: 'processing', imageUrl: null }), { extra: { cache_key: 'key_old' } });
      backdate(local.db, 'tryons', 'try_lost', OLD);
      reserve('images', 'tryon:key_new', 1000);
      upsertRow(local.db, 'tryons', auth.userId, tryon('try_fresh', image.url, { status: 'processing', imageUrl: null }), { extra: { cache_key: 'key_new' } });

      // Garment with lost tagging and packshot.
      reserve('taggings', 'tag:g_lostitem', OLD);
      reserve('images', 'packshot:g_lostitem', OLD);
      upsertRow(local.db, 'garments', auth.userId, garment('g_lostitem', { imageUrl: image.url, taggingStatus: 'processing', packshotStatus: 'processing' }));
      backdate(local.db, 'garments', 'g_lostitem', OLD);

      // A clip that was claimed but never got a provider job id.
      reserve('videos', 'clip:try_unsubmitted', OLD);
      upsertRow(local.db, 'tryons', auth.userId, tryon('try_unsubmitted', image.url, { videoStatus: 'processing' }));
      backdate(local.db, 'tryons', 'try_unsubmitted', OLD);

      const before = local.usage.snapshot(auth.userId, 'pro');
      assert.deepEqual([before.images.used, before.taggings.used, before.videos.used], [3, 1, 1]);
      assert.equal(sweepStaleJobs(local.ctx), 3);

      assert.equal(getRow(local.db, 'tryons', auth.userId, 'try_lost')!.status, 'failed');
      assert.equal(getRow(local.db, 'tryons', auth.userId, 'try_fresh')!.status, 'processing');
      const g = getRow(local.db, 'garments', auth.userId, 'g_lostitem')!;
      assert.equal(g.taggingStatus, 'failed');
      assert.equal(g.packshotStatus, 'failed');
      assert.equal(getRow(local.db, 'tryons', auth.userId, 'try_unsubmitted')!.videoStatus, 'failed');
      const snap = local.usage.snapshot(auth.userId, 'pro');
      assert.equal(snap.images.used, 1); // only the fresh try-on is still reserved
      assert.equal(snap.taggings.used, 0);
      assert.equal(snap.videos.used, 0);
      // Idempotent: nothing left to sweep.
      assert.equal(sweepStaleJobs(local.ctx), 0);
    } finally {
      local.close();
    }
  });
});

describe('live mirror settlement', () => {
  test('stop records max(client, server-measured) seconds, capped at the reservation', async () => {
    // The live mirror is switched off by default; this covers the code kept for when it returns.
    const local = await localApp({ liveMirrorEnabled: true });
    try {
      const auth = await local.account();
      // Inserted directly: plan quotas are not what this test is about.
      let sessions = 0;
      const session = (ageSeconds: number, reserved = 120) => {
        const id = `live_session_${(sessions += 1)}`;
        local.db
          .prepare("INSERT INTO usage_events (id, user_id, kind, units, ref, created_at) VALUES (?, ?, 'videos', ?, 'live:g', ?)")
          .run(id, auth.userId, reserved, ago(ageSeconds * 1000));
        return id;
      };
      const units = (id: string) => (local.db.prepare('SELECT units FROM usage_events WHERE id = ?').get(id) as { units: number }).units;

      const underReported = session(60);
      assert.equal((await local.call('POST', '/api/live/stop', auth.token, { sessionId: underReported, usedSeconds: 5 })).status, 200);
      assert.ok(units(underReported) >= 60 && units(underReported) <= 62, String(units(underReported)));

      const honest = session(10);
      await local.call('POST', '/api/live/stop', auth.token, { sessionId: honest, usedSeconds: 40 });
      assert.equal(units(honest), 40);

      const overran = session(500);
      await local.call('POST', '/api/live/stop', auth.token, { sessionId: overran, usedSeconds: 0 });
      assert.equal(units(overran), 120);

      // A second stop never raises the recorded seconds.
      await local.call('POST', '/api/live/stop', auth.token, { sessionId: honest, usedSeconds: 100 });
      assert.equal(units(honest), 40);
      // Ended: no more tokens for it.
      assert.equal((await local.call('POST', '/api/live/token', auth.token, { sessionId: honest })).body.code, 'LIVE_SESSION_REQUIRED');
      // Seconds are recorded, but each session counts as one video.
      assert.equal(local.usage.snapshot(auth.userId, 'pro').videos.used, 3);
    } finally {
      local.close();
    }
  });
});

describe('sync pull pagination', () => {
  test('one table with more rows than the page still reports hasMore', async () => {
    const local = await localApp();
    try {
      const auth = await local.account();
      for (const id of ['g_page1xx', 'g_page2xx', 'g_page3xx']) upsertRow(local.db, 'garments', auth.userId, garment(id));
      const first = await local.call('GET', '/api/sync/pull?since=0&limit=3', auth.token);
      assert.equal(first.body.changes.garments.length, 3);
      assert.equal(first.body.hasMore, false);
      const paged = await local.call('GET', '/api/sync/pull?since=0&limit=2', auth.token);
      assert.equal(paged.body.changes.garments.length, 2);
      assert.equal(paged.body.hasMore, true);
      const rest = await local.call('GET', `/api/sync/pull?since=${paged.body.cursor}&limit=2`, auth.token);
      assert.equal(rest.body.changes.garments.length, 1);
      assert.equal(rest.body.hasMore, false);
    } finally {
      local.close();
    }
  });
});
