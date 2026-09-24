import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { openDb, type Db } from '../src/db/index';
import { requireAccount, requireAuth } from '../src/lib/auth';
import { entitlementActive, planFromActiveEntitlements, planFromSubscriber, resetEntitlementKeyCache, resolvePlan } from '../src/lib/entitlements';
import { errorHandler } from '../src/lib/http';
import { MediaStorage } from '../src/lib/storage';
import { UsageLedger } from '../src/lib/usage';
import { billingRoutes, webhookAuthorized } from '../src/routes/billing';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirobe-billing-'));
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const SECRET = 'whsec_test_value';
const future = () => new Date(Date.now() + 86_400_000).toISOString();
const past = () => new Date(Date.now() - 86_400_000).toISOString();

type Entitlements = Record<string, { expires_date: string | null; grace_period_expires_date?: string | null; product_identifier?: string }>;

/**
 * Stubs RevenueCat for our server and lets every other request (the test's own
 * calls to the local server) through. Records which subscribers were looked up.
 */
function stubRevenueCat(byUser: Record<string, Entitlements>) {
  const lookups: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.revenuecat.com/')) return realFetch(input, init);
    const userId = decodeURIComponent(url.split('/subscribers/')[1]);
    lookups.push(userId);
    return new Response(JSON.stringify({ subscriber: { entitlements: byUser[userId] ?? {}, subscriptions: {} } }));
  }) as typeof fetch;
  return lookups;
}

async function start(overrides: Partial<Config> = {}) {
  const config = loadConfig({ dataDir, revenueCatSecret: 'sk_test', revenueCatWebhookAuth: SECRET, devPlanOverride: undefined, authRateLimit: 1000, ...overrides });
  const db = openDb(':memory:');
  const usage = new UsageLedger(db);
  const billing = billingRoutes({ db, config, usage, auth: requireAuth(db), requireAccount });
  const app = express();
  app.use(express.json());
  app.use(billing);
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { db, config, billing, base, close: () => server.close() };
}

function addUser(db: Db, id: string, plan = 'free', checkedAt: string | null = new Date().toISOString()) {
  db.prepare('INSERT INTO users (id, created_at, plan, plan_checked_at) VALUES (?, ?, ?, ?)').run(id, '2026-01-01', plan, checkedAt);
}

const planOf = (db: Db, id: string) => db.prepare('SELECT plan, plan_checked_at FROM users WHERE id = ?').get(id) as { plan: string; plan_checked_at: string | null };

function webhook(base: string, event: Record<string, unknown>, authorization: string | null = SECRET) {
  return realFetch(`${base}/api/billing/revenuecat-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify({ api_version: '1.0', event }),
  });
}

describe('entitlement activity', () => {
  test('active while unexpired, in a grace period, or lifetime', () => {
    const now = Date.now();
    assert.equal(entitlementActive({ expires_date: null }, {}, now), true);
    assert.equal(entitlementActive({ expires_date: future() }, {}, now), true);
    assert.equal(entitlementActive({ expires_date: past() }, {}, now), false);
    assert.equal(entitlementActive({ expires_date: past(), grace_period_expires_date: future() }, {}, now), true);
    assert.equal(entitlementActive({ expires_date: past(), grace_period_expires_date: past() }, {}, now), false);
    // Grace period reported on the backing (Play) subscription only.
    assert.equal(
      entitlementActive({ expires_date: past(), product_identifier: 'mirobe_pro_monthly:monthly' }, { subscriptions: { mirobe_pro_monthly: { grace_period_expires_date: future() } } }, now),
      true
    );
    assert.equal(entitlementActive({ expires_date: 'not a date' }, {}, now), false);
  });

  test('a Pro subscriber in a billing-issue grace period keeps Pro', () => {
    const plan = planFromSubscriber({
      entitlements: {
        mirobe_plus: { expires_date: past() },
        mirobe_pro: { expires_date: past(), grace_period_expires_date: future(), product_identifier: 'mirobe_pro_annual' },
      },
    });
    assert.equal(plan, 'pro');
    assert.equal(planFromSubscriber({ entitlements: { unknown: { expires_date: null } } }), 'free');
  });

  test('a failed lookup keeps the cached plan and backs off instead of retrying on every request', async () => {
    const db = openDb(':memory:');
    addUser(db, 'u_down', 'plus', null);
    const config = loadConfig({ dataDir, revenueCatSecret: 'sk_test' });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response('down', { status: 503 });
    }) as typeof fetch;
    assert.equal(await resolvePlan(db, config, 'u_down'), 'plus');
    assert.equal(await resolvePlan(db, config, 'u_down'), 'plus');
    assert.equal(calls, 1);
    // A forced refresh (purchase sync, webhook) still goes out.
    assert.equal(await resolvePlan(db, config, 'u_down', true), 'plus');
    assert.equal(calls, 2);
  });
});

describe('RevenueCat API v2 (project-scoped secret key)', () => {
  const hour = 3_600_000;
  function stubV2(active: Record<string, { entitlement_id: string; expires_at: number | null }[]>) {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push(url);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer sk_v2');
      if (url.endsWith('/projects/proj1/entitlements?limit=100')) {
        return Response.json({ items: [{ id: 'entl_plus', lookup_key: 'mirobe_plus' }, { id: 'entl_pro', lookup_key: 'mirobe_pro' }, { id: 'entl_old', lookup_key: 'mirobe_premium' }] });
      }
      const match = url.match(/\/projects\/proj1\/customers\/([^/]+)\/active_entitlements/);
      assert.ok(match, `unexpected url ${url}`);
      const items = active[decodeURIComponent(match[1])];
      if (!items) return Response.json({ type: 'resource_missing' }, { status: 404 });
      return Response.json({ object: 'list', items });
    }) as typeof fetch;
    return seen;
  }

  test('maps active entitlement ids to plans, never calls the v1 API', async () => {
    resetEntitlementKeyCache();
    const db = openDb(':memory:');
    for (const id of ['u_pro', 'u_plus', 'u_legacy', 'u_expired', 'u_new']) addUser(db, id, 'free', null);
    const config = loadConfig({ dataDir, revenueCatSecret: 'sk_v2', revenueCatProjectId: 'proj1' });
    const seen = stubV2({
      u_pro: [{ entitlement_id: 'entl_plus', expires_at: Date.now() + hour }, { entitlement_id: 'entl_pro', expires_at: Date.now() + hour }],
      u_plus: [{ entitlement_id: 'entl_plus', expires_at: null }],
      u_legacy: [{ entitlement_id: 'entl_old', expires_at: Date.now() + hour }],
      u_expired: [{ entitlement_id: 'entl_pro', expires_at: Date.now() - hour }],
    });
    assert.equal(await resolvePlan(db, config, 'u_pro'), 'pro');
    assert.equal(await resolvePlan(db, config, 'u_plus'), 'plus');
    assert.equal(await resolvePlan(db, config, 'u_legacy'), 'plus');
    assert.equal(await resolvePlan(db, config, 'u_expired'), 'free');
    // A customer RevenueCat has never seen is free, not an error that keeps a stale cached plan.
    assert.equal(await resolvePlan(db, config, 'u_new'), 'free');
    assert.equal(planOf(db, 'u_new').plan, 'free');
    assert.ok(seen.every((url) => url.startsWith('https://api.revenuecat.com/v2/')));
    // The entitlement id → lookup key map is fetched once and cached.
    assert.equal(seen.filter((url) => url.endsWith('/entitlements?limit=100')).length, 1);
  });

  test('ignores entitlements it does not know', () => {
    const keys = new Map([['entl_x', 'something_else']]);
    assert.equal(planFromActiveEntitlements([{ entitlement_id: 'entl_x', expires_at: null }, { entitlement_id: 'entl_missing', expires_at: null }], keys), 'free');
  });
});

describe('RevenueCat webhook', () => {
  test('authorization: exact value or Bearer, compared in constant time', () => {
    assert.equal(webhookAuthorized(SECRET, SECRET), true);
    assert.equal(webhookAuthorized(`Bearer ${SECRET}`, SECRET), true);
    assert.equal(webhookAuthorized('wrong', SECRET), false);
    assert.equal(webhookAuthorized(undefined, SECRET), false);
    assert.equal(webhookAuthorized(SECRET, undefined), false);
  });

  test('rejects missing or wrong secrets with 401, and every call when no secret is configured', async () => {
    const server = await start();
    const unset = await start({ revenueCatWebhookAuth: undefined });
    try {
      const event = { id: 'evt_auth', type: 'INITIAL_PURCHASE', app_user_id: 'u_x' };
      assert.equal((await webhook(server.base, event, null)).status, 401);
      assert.equal((await webhook(server.base, event, 'nope')).status, 401);
      assert.equal((await webhook(unset.base, event, SECRET)).status, 401);
      assert.equal((await webhook(unset.base, event, '')).status, 401);
    } finally {
      server.close();
      unset.close();
    }
  });

  test('re-resolves the plan from the REST API, not the event body, and is idempotent', async () => {
    const server = await start();
    try {
      addUser(server.db, 'u_buyer');
      const lookups = stubRevenueCat({ u_buyer: { mirobe_pro: { expires_date: future() } } });
      // The body claims nothing about the plan we would trust; only the user id matters.
      const event = { id: 'evt_1', type: 'INITIAL_PURCHASE', app_user_id: 'u_buyer', entitlement_ids: ['mirobe_plus'] };
      const first = await webhook(server.base, event);
      assert.equal(first.status, 200);
      assert.deepEqual(await first.json(), { ok: true, users: 1 });
      await server.billing.settled();
      assert.equal(planOf(server.db, 'u_buyer').plan, 'pro');
      assert.deepEqual(lookups, ['u_buyer']);

      const again = await webhook(server.base, event);
      assert.equal(again.status, 200);
      assert.deepEqual(await again.json(), { ok: true, duplicate: true });
      await server.billing.settled();
      assert.deepEqual(lookups, ['u_buyer']);
    } finally {
      server.close();
    }
  });

  test('expiration drops the plan; the cache is invalidated even if the refresh fails', async () => {
    const server = await start();
    try {
      addUser(server.db, 'u_lapsed', 'plus');
      stubRevenueCat({ u_lapsed: { mirobe_plus: { expires_date: past() } } });
      assert.equal((await webhook(server.base, { id: 'evt_exp', type: 'EXPIRATION', app_user_id: 'u_lapsed' })).status, 200);
      await server.billing.settled();
      assert.equal(planOf(server.db, 'u_lapsed').plan, 'free');

      addUser(server.db, 'u_outage', 'plus');
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).startsWith('https://api.revenuecat.com/') ? Promise.reject(new TypeError('fetch failed')) : realFetch(input, init)) as typeof fetch;
      assert.equal((await webhook(server.base, { id: 'evt_bi', type: 'BILLING_ISSUE', app_user_id: 'u_outage' })).status, 200);
      await server.billing.settled();
      const row = planOf(server.db, 'u_outage');
      assert.equal(row.plan, 'plus');
      // Stamped nine minutes old: the next request asks RevenueCat again within a minute.
      const age = Date.now() - Date.parse(row.plan_checked_at!);
      assert.ok(age >= 9 * 60 * 1000 - 1000 && age < 10 * 60 * 1000, `age ${age}`);
    } finally {
      server.close();
    }
  });

  test('TRANSFER refreshes both sides; unknown and anonymous ids are skipped', async () => {
    const server = await start();
    try {
      addUser(server.db, 'u_from', 'pro');
      addUser(server.db, 'u_to');
      const lookups = stubRevenueCat({ u_to: { mirobe_pro: { expires_date: future() } } });
      const response = await webhook(server.base, {
        id: 'evt_tr',
        type: 'TRANSFER',
        transferred_from: ['u_from', '$RCAnonymousID:abc'],
        transferred_to: ['u_to', 'u_missing'],
      });
      assert.deepEqual(await response.json(), { ok: true, users: 2 });
      await server.billing.settled();
      assert.deepEqual(lookups.sort(), ['u_from', 'u_to']);
      assert.equal(planOf(server.db, 'u_from').plan, 'free');
      assert.equal(planOf(server.db, 'u_to').plan, 'pro');
    } finally {
      server.close();
    }
  });

  test('TEST events are acknowledged without lookups; malformed bodies are 400', async () => {
    const server = await start();
    try {
      addUser(server.db, 'u_test');
      const lookups = stubRevenueCat({});
      assert.equal((await webhook(server.base, { id: 'evt_test', type: 'TEST', app_user_id: 'u_test' })).status, 200);
      await server.billing.settled();
      assert.deepEqual(lookups, []);
      assert.equal((await webhook(server.base, { type: 'RENEWAL' })).status, 400);
    } finally {
      server.close();
    }
  });
});

describe('billing sync', () => {
  test('needs a registered account and bypasses the plan cache', async () => {
    const config = loadConfig({ dataDir, revenueCatSecret: 'sk_test', revenueCatWebhookAuth: undefined, devPlanOverride: undefined, authRateLimit: 1000 });
    const db = openDb(':memory:');
    const app = createApp({ db, config, media: new MediaStorage(db, dataDir), usage: new UsageLedger(db) });
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (url: string, token?: string, body: unknown = {}) =>
      realFetch(`${base}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
    try {
      const anonymous = (await (await post('/api/auth/anonymous')).json()) as { token: string };
      assert.equal((await post('/api/billing/sync')).status, 401);
      assert.equal((await post('/api/billing/sync', anonymous.token)).status, 403);

      const account = (await (await post('/api/auth/register', undefined, { email: 'buyer@example.com', password: 'correct horse battery' })).json()) as {
        token: string;
        userId: string;
      };
      // A fresh cached "free" would normally be served for ten minutes.
      db.prepare('UPDATE users SET plan = ?, plan_checked_at = ? WHERE id = ?').run('free', new Date().toISOString(), account.userId);
      const lookups = stubRevenueCat({ [account.userId]: { mirobe_plus: { expires_date: future() } } });
      const response = await post('/api/billing/sync', account.token);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { userId: string; usage: { planId: string } };
      assert.equal(body.userId, account.userId);
      assert.equal(body.usage.planId, 'plus');
      assert.deepEqual(lookups, [account.userId]);

      // Webhook without a configured secret is refused through the real app too.
      assert.equal((await webhook(base, { id: 'evt_app', type: 'RENEWAL', app_user_id: account.userId }, SECRET)).status, 401);
      // Legal pages are served under /api (the only path the edge lets through).
      const privacy = await realFetch(`${base}/api/legal/privacy`);
      assert.equal(privacy.status, 200);
      assert.match(privacy.headers.get('content-type') ?? '', /text\/html/);
      assert.equal((await realFetch(`${base}/api/legal/terms`)).status, 200);
      // The account deletion page Google Play links to, in both languages.
      const deletion = await realFetch(`${base}/api/legal/delete-account?lang=en`);
      assert.equal(deletion.status, 200);
      assert.match(await deletion.text(), /Profile and tap Delete account/);
      assert.match(await (await realFetch(`${base}/api/legal/delete-account`, { headers: { 'Accept-Language': 'tr-TR' } })).text(), /Hesabı sil/);
    } finally {
      server.close();
    }
  });
});
