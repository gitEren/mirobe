import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http2 from 'node:http2';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { PushEnvironment } from '@mirobe/shared';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { openDb, type Db } from '../src/db/index';
import { createApnsSender, type ApnsNotification, type ApnsResult, type PushSender } from '../src/lib/apns';
import { requireAccount, requireAuth } from '../src/lib/auth';
import { errorHandler } from '../src/lib/http';
import { savePushToken, setNotificationSettings } from '../src/lib/push';
import { MediaStorage } from '../src/lib/storage';
import { eventTime, planOfProduct, renewedByUser, subscriptionHistory, subscriptionNotice } from '../src/lib/subscriptionNotices';
import { UsageLedger } from '../src/lib/usage';
import { pruneNotices, unseenNotices } from '../src/lib/userNotices';
import { billingRoutes } from '../src/routes/billing';

const SECRET = 'whsec_push_test';
const PASSWORD = 'correct horse battery';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirobe-push-'));
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

/** A 64-hex-character APNs-style device token. */
const apnsToken = (seed: string) => crypto.createHash('sha256').update(seed).digest('hex');

/** Records every notification and answers per token (200 unless told otherwise). */
function stubSender(answers: Record<string, ApnsResult> = {}) {
  const sent: ApnsNotification[] = [];
  const sender: PushSender = {
    async send(notification) {
      sent.push(notification);
      return answers[notification.token] ?? { status: 200 };
    },
  };
  return { sender, sent };
}

const tokenCount = (db: Db, token: string) => (db.prepare('SELECT COUNT(*) AS n FROM push_tokens WHERE token = ?').get(token) as { n: number }).n;
const ownerOf = (db: Db, token: string) => (db.prepare('SELECT user_id FROM push_tokens WHERE token = ?').get(token) as { user_id: string } | undefined)?.user_id;

async function waitFor(check: () => boolean, ms = 2000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

let events = 0;
function webhook(base: string, event: Record<string, unknown>) {
  return fetch(`${base}/api/billing/revenuecat-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: SECRET },
    body: JSON.stringify({ api_version: '1.0', event: { id: `evt_${(events += 1)}`, environment: 'PRODUCTION', ...event } }),
  });
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const T0 = Date.parse('2026-06-01T09:00:00Z');
/** The webhook fields of a paid Pro monthly period starting at `start`. */
const period = (start: number) => ({ product_id: 'mirobe_pro_monthly', price: 19.99, period_type: 'NORMAL', purchased_at_ms: start, expiration_at_ms: start + MONTH });

describe('push tokens and notification settings', () => {
  let base = '';
  let db: Db;
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;

  before(async () => {
    const config = loadConfig({ dataDir, openRouterKey: undefined, falKey: undefined, revenueCatSecret: undefined, devPlanOverride: undefined, authRateLimit: 1000 });
    db = openDb(':memory:');
    const app = createApp({ db, config, media: new MediaStorage(db, dataDir), usage: new UsageLedger(db), push: null });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  async function call(method: string, url: string, token?: string, body?: unknown) {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json().catch(() => null)) as any };
  }
  const anonymous = async () => (await call('POST', '/api/auth/anonymous')).body as { userId: string; token: string };
  let accounts = 0;
  const register = async () =>
    (await call('POST', '/api/auth/register', undefined, { email: `push${Date.now().toString(36)}${(accounts += 1)}@example.com`, password: PASSWORD })).body as {
      userId: string;
      token: string;
      email: string;
    };
  const device = (token: string, extra: Record<string, unknown> = {}) => ({ token, platform: 'ios', environment: 'production', lang: 'tr', ...extra });

  test('need a session', async () => {
    assert.equal((await call('POST', '/api/push/tokens', undefined, device(apnsToken('x')))).status, 401);
    assert.equal((await call('DELETE', '/api/push/tokens', undefined, { token: apnsToken('x') })).status, 401);
    assert.equal((await call('GET', '/api/me/notification-settings')).status, 401);
    assert.equal((await call('PUT', '/api/me/notification-settings', undefined, { subscription: false })).status, 401);
  });

  test('anonymous and registered users register; a token registered again moves to the new user', async () => {
    const anon = await anonymous();
    const phone = apnsToken('phone-1').toUpperCase();
    assert.equal((await call('POST', '/api/push/tokens', anon.token, device(phone, { environment: 'sandbox', lang: 'en' }))).status, 200);
    const stored = db.prepare('SELECT user_id, token, platform, environment, lang FROM push_tokens WHERE token = ?').get(phone.toLowerCase()) as Record<string, string>;
    // Hex tokens are stored lower-cased so the same device never gets two rows.
    assert.deepEqual({ ...stored }, { user_id: anon.userId, token: phone.toLowerCase(), platform: 'ios', environment: 'sandbox', lang: 'en' });

    const account = await register();
    assert.equal((await call('POST', '/api/push/tokens', account.token, device(phone.toLowerCase()))).status, 200);
    assert.equal(tokenCount(db, phone.toLowerCase()), 1);
    assert.equal(ownerOf(db, phone.toLowerCase()), account.userId);
    const moved = db.prepare('SELECT environment, lang FROM push_tokens WHERE token = ?').get(phone.toLowerCase()) as Record<string, string>;
    assert.deepEqual({ ...moved }, { environment: 'production', lang: 'tr' });
  });

  test('rejects malformed tokens and fields', async () => {
    const user = await anonymous();
    for (const body of [
      device('not-a-hex-token-at-all-0123456789'),
      device(apnsToken('a').slice(0, 20)),
      device(apnsToken('b'), { environment: 'staging' }),
      device(apnsToken('c'), { platform: 'web' }),
      device(apnsToken('d'), { lang: 'de' }),
      { token: apnsToken('e') },
    ]) {
      const response = await call('POST', '/api/push/tokens', user.token, body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(response.body.code, 'VALIDATION');
    }
    // FCM tokens (Android) are not hex.
    assert.equal((await call('POST', '/api/push/tokens', user.token, device('dKq3:APA91bH-x_y.z0123456789', { platform: 'android' }))).status, 200);
  });

  test('keeps the ten most recently seen tokens per user', async () => {
    const user = await anonymous();
    for (let index = 0; index < 12; index += 1) {
      assert.equal((await call('POST', '/api/push/tokens', user.token, device(apnsToken(`many-${index}`)))).status, 200);
    }
    const rows = db.prepare('SELECT token FROM push_tokens WHERE user_id = ?').all(user.userId) as { token: string }[];
    assert.equal(rows.length, 10);
    assert.equal(tokenCount(db, apnsToken('many-0')), 0);
    assert.equal(tokenCount(db, apnsToken('many-11')), 1);
  });

  test('a user removes only their own token', async () => {
    const owner = await anonymous();
    const other = await anonymous();
    const phone = apnsToken('phone-2');
    await call('POST', '/api/push/tokens', owner.token, device(phone));
    const foreign = await call('DELETE', '/api/push/tokens', other.token, { token: phone });
    assert.deepEqual(foreign.body, { ok: true, removed: 0 });
    assert.equal(tokenCount(db, phone), 1);
    const own = await call('DELETE', '/api/push/tokens', owner.token, { token: phone.toUpperCase() });
    assert.deepEqual(own.body, { ok: true, removed: 1 });
    assert.equal(tokenCount(db, phone), 0);
    assert.equal((await call('DELETE', '/api/push/tokens', owner.token, {})).status, 400);
  });

  test('subscription notifications are on by default and can be switched off', async () => {
    const account = await register();
    assert.deepEqual((await call('GET', '/api/me/notification-settings', account.token)).body, { subscription: true });
    assert.deepEqual((await call('PUT', '/api/me/notification-settings', account.token, { subscription: false })).body, { subscription: false });
    assert.deepEqual((await call('GET', '/api/me/notification-settings', account.token)).body, { subscription: false });
    assert.equal((await call('PUT', '/api/me/notification-settings', account.token, { subscription: 'no' })).status, 400);
    assert.deepEqual((await call('PUT', '/api/me/notification-settings', account.token, { subscription: true })).body, { subscription: true });
    // Anonymous sessions have the switch too (it simply has nothing to send).
    assert.deepEqual((await call('GET', '/api/me/notification-settings', (await anonymous()).token)).body, { subscription: true });
  });

  test('deleting the account deletes its push tokens', async () => {
    const account = await register();
    const phone = apnsToken('phone-3');
    await call('POST', '/api/push/tokens', account.token, device(phone));
    assert.equal(tokenCount(db, phone), 1);
    assert.equal((await call('DELETE', '/api/me', account.token, { password: PASSWORD })).status, 200);
    assert.equal(tokenCount(db, phone), 0);
  });

  test('signing in on an anonymous device takes its push token along', async () => {
    const account = await register();
    const anon = await anonymous();
    const phone = apnsToken('phone-4');
    await call('POST', '/api/push/tokens', anon.token, device(phone));
    const login = await call('POST', '/api/auth/login', anon.token, { email: account.email, password: PASSWORD });
    assert.equal(login.status, 200);
    assert.equal(ownerOf(db, phone), account.userId);
  });
});

describe('payment notices from the RevenueCat webhook', () => {
  async function start(push: PushSender | null) {
    const config = loadConfig({ dataDir, revenueCatSecret: undefined, revenueCatWebhookAuth: SECRET, devPlanOverride: undefined, authRateLimit: 1000 });
    const db = openDb(':memory:');
    const billing = billingRoutes({ db, config, usage: new UsageLedger(db), auth: requireAuth(db), requireAccount, push });
    const app = express();
    app.use(express.json());
    app.use(billing);
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { db, billing, base, close: () => server.close() };
  }

  const addUser = (db: Db, id: string) => db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(id, '2026-01-01');
  const addDevice = (db: Db, userId: string, token: string, environment: PushEnvironment, lang: 'tr' | 'en', platform: 'ios' | 'android' = 'ios') =>
    savePushToken(db, userId, { token, platform, environment, lang });

  /** u_buyer: a Turkish and an English production device, a sandbox device and an Android phone. */
  const TR_PHONE = apnsToken('tr-phone');
  const EN_TABLET = apnsToken('en-tablet');
  const DEV_BUILD = apnsToken('dev-build');
  function buyer(db: Db) {
    addUser(db, 'u_buyer');
    addDevice(db, 'u_buyer', TR_PHONE, 'production', 'tr');
    addDevice(db, 'u_buyer', EN_TABLET, 'production', 'en');
    addDevice(db, 'u_buyer', 'fcm:android-token-123', 'production', 'tr', 'android');
  }
  const to = (sent: ApnsNotification[], token: string) => sent.find((n) => n.token === token);
  const alert = (n: ApnsNotification | undefined) => (n?.payload.aps as { alert: { title: string; body: string } }).alert;
  const data = (n: ApnsNotification | undefined) => n?.payload.body as { kind: string; url: string };
  const kinds = (sent: ApnsNotification[]) => sent.map((n) => data(n).kind);

  test('payment received: purchase, a renewal the user bought and an upgrade, each in the device language', async () => {
    const { sender, sent } = stubSender();
    const server = await start(sender);
    try {
      buyer(server.db);
      const purchase = await webhook(server.base, { type: 'INITIAL_PURCHASE', app_user_id: 'u_buyer', product_id: 'mirobe_plus_monthly', period_type: 'NORMAL', price: 9.99 });
      assert.equal(purchase.status, 200);
      await server.billing.settled();
      // Production devices only (the event is a production purchase); Android waits for FCM.
      assert.deepEqual(sent.map((n) => n.token).sort(), [TR_PHONE, EN_TABLET].sort());
      assert.deepEqual(alert(to(sent, TR_PHONE)), { title: 'Ödemen alındı', body: 'Mirobe Plus planın etkin. Yeni haklarını hemen kullanabilirsin.' });
      assert.deepEqual(alert(to(sent, EN_TABLET)), { title: 'Payment received', body: 'Your Mirobe Plus plan is active and ready to use.' });
      assert.deepEqual(data(to(sent, TR_PHONE)), { kind: 'purchase', url: 'mirobe:///profile' });
      const first = to(sent, TR_PHONE)!;
      assert.equal(first.environment, 'production');
      assert.equal(first.collapseId, 'mirobe-subscription');
      assert.equal((first.payload.aps as { sound: string }).sound, 'default');

      // It lapsed, then the user subscribed again.
      await webhook(server.base, { type: 'EXPIRATION', app_user_id: 'u_buyer', product_id: 'mirobe_plus_monthly' });
      sent.length = 0;
      await webhook(server.base, { type: 'RENEWAL', app_user_id: 'u_buyer', product_id: 'mirobe_pro_annual', price: 199.99 });
      await server.billing.settled();
      assert.equal(sent.length, 2);
      assert.deepEqual(alert(to(sent, TR_PHONE)), { title: 'Aboneliğin yenilendi', body: 'Ödemen alındı, Mirobe Pro planın yeniden etkin.' });
      assert.deepEqual(alert(to(sent, EN_TABLET)), { title: 'Subscription renewed', body: 'Payment received. Your Mirobe Pro plan is active again.' });
      assert.deepEqual(data(to(sent, EN_TABLET)), { kind: 'renewal', url: 'mirobe:///profile' });

      sent.length = 0;
      await webhook(server.base, { type: 'PRODUCT_CHANGE', app_user_id: 'u_buyer', product_id: 'mirobe_plus_monthly', new_product_id: 'mirobe_pro_monthly' });
      await server.billing.settled();
      assert.deepEqual(alert(to(sent, TR_PHONE)), { title: 'Pro’ya geçtin', body: 'Ödemen alındı, yeni planın hemen etkin.' });
      assert.deepEqual(alert(to(sent, EN_TABLET)), { title: 'You’re on Pro now', body: 'Payment received. Your new plan is active right away.' });
      assert.equal(data(to(sent, TR_PHONE))?.kind, 'upgrade');
    } finally {
      server.close();
    }
  });

  test('automatic renewals send nothing, whether charged before the period ended or a little after', async () => {
    const { sender, sent } = stubSender();
    const server = await start(sender);
    try {
      buyer(server.db);
      await webhook(server.base, { type: 'INITIAL_PURCHASE', app_user_id: 'u_buyer', ...period(T0) });
      await server.billing.settled();
      assert.deepEqual(kinds(sent), ['purchase', 'purchase']);
      sent.length = 0;
      // Stores charge up to a day before the period ends; a renewal can also land some hours after it.
      const early = T0 + MONTH - 20 * HOUR;
      await webhook(server.base, { type: 'RENEWAL', app_user_id: 'u_buyer', ...period(early) });
      await webhook(server.base, { type: 'RENEWAL', app_user_id: 'u_buyer', ...period(early + MONTH + 23 * HOUR) });
      // A period the store extended (e.g. for an outage) renews at its new end.
      const extended = early + MONTH + 23 * HOUR + MONTH + 10 * DAY;
      await webhook(server.base, { type: 'SUBSCRIPTION_EXTENDED', app_user_id: 'u_buyer', product_id: 'mirobe_pro_monthly', expiration_at_ms: extended });
      await webhook(server.base, { type: 'RENEWAL', app_user_id: 'u_buyer', ...period(extended - HOUR) });
      // A trial turning into a paid period renews by itself too.
      addUser(server.db, 'u_trial');
      addDevice(server.db, 'u_trial', apnsToken('trial-phone'), 'production', 'tr');
      await webhook(server.base, { type: 'INITIAL_PURCHASE', app_user_id: 'u_trial', ...period(T0), period_type: 'TRIAL', price: 0, expiration_at_ms: T0 + 7 * DAY });
      await webhook(server.base, { type: 'RENEWAL', app_user_id: 'u_trial', ...period(T0 + 7 * DAY), is_trial_conversion: true });
      await server.billing.settled();
      assert.deepEqual(sent, []);
    } finally {
      server.close();
    }
  });

  test('a renewal after the subscription expired is announced, and the one after it is automatic again', async () => {
    const { sender, sent } = stubSender();
    const server = await start(sender);
    try {
      buyer(server.db);
      await webhook(server.base, { type: 'INITIAL_PURCHASE', app_user_id: 'u_buyer', ...period(T0) });
      await webhook(server.base, { type: 'CANCELLATION', app_user_id: 'u_buyer', product_id: 'mirobe_pro_monthly', expiration_at_ms: T0 + MONTH });
      await webhook(server.base, { type: 'EXPIRATION', app_user_id: 'u_buyer', product_id: 'mirobe_pro_monthly', expiration_at_ms: T0 + MONTH });
      await server.billing.settled();
      sent.length = 0;
      // Bought again an hour after it expired: within a day of the old period's end, but it had lapsed.
      await webhook(server.base, { type: 'RENEWAL', app_user_id: 'u_buyer', ...period(T0 + MONTH + HOUR) });
      await server.billing.settled();
      assert.deepEqual(kinds(sent), ['renewal', 'renewal']);
      sent.length = 0;
      await webhook(server.base, { type: 'RENEWAL', app_user_id: 'u_buyer', ...period(T0 + 2 * MONTH + HOUR - 2 * HOUR) });
      await server.billing.settled();
      assert.deepEqual(sent, []);
    } finally {
      server.close();
    }
  });

  test('a subscription restored onto an account whose own one had lapsed renews automatically there', async () => {
    const { sender, sent } = stubSender();
    const server = await start(sender);
    try {
      buyer(server.db);
      addUser(server.db, 'u_first');
      await webhook(server.base, { type: 'EXPIRATION', app_user_id: 'u_buyer', product_id: 'mirobe_pro_monthly', expiration_at_ms: T0 });
      await webhook(server.base, { type: 'TRANSFER', transferred_from: ['u_first'], transferred_to: ['u_buyer'] });
      await webhook(server.base, { type: 'RENEWAL', app_user_id: 'u_buyer', ...period(T0 + 3 * MONTH) });
      await server.billing.settled();
      assert.deepEqual(sent, []);
      assert.deepEqual(subscriptionHistory(server.db, 'u_buyer'), { expiresAt: T0 + 4 * MONTH, lapsed: false });
    } finally {
      server.close();
    }
  });

  test('a renewal more than a day after the last known period ended is announced, even without an EXPIRATION', async () => {
    const { sender, sent } = stubSender();
    const server = await start(sender);
    try {
      buyer(server.db);
      // The first renewal the server hears of has nothing to compare with: taken as automatic.
      await webhook(server.base, { type: 'RENEWAL', app_user_id: 'u_buyer', ...period(T0) });
      await webhook(server.base, { type: 'RENEWAL', app_user_id: 'u_buyer', ...period(T0 + MONTH + 24 * HOUR) });
      await server.billing.settled();
      assert.deepEqual(sent, []);
      await webhook(server.base, { type: 'RENEWAL', app_user_id: 'u_buyer', ...period(T0 + 2 * MONTH + 24 * HOUR + 25 * HOUR) });
      await server.billing.settled();
      assert.deepEqual(kinds(sent), ['renewal', 'renewal']);
    } finally {
      server.close();
    }
  });

  test('a billing retry that succeeds within the grace period sends only the billing issue', async () => {
    const { sender, sent } = stubSender();
    const server = await start(sender);
    try {
      buyer(server.db);
      await webhook(server.base, { type: 'RENEWAL', app_user_id: 'u_buyer', ...period(T0) });
      await webhook(server.base, {
        type: 'BILLING_ISSUE',
        app_user_id: 'u_buyer',
        product_id: 'mirobe_pro_monthly',
        expiration_at_ms: T0 + MONTH,
        grace_period_expiration_at_ms: T0 + MONTH + 16 * DAY,
      });
      // The store's retry goes through ten days into the grace period.
      await webhook(server.base, { type: 'RENEWAL', app_user_id: 'u_buyer', ...period(T0 + MONTH + 10 * DAY) });
      await server.billing.settled();
      assert.deepEqual(kinds(sent), ['billing_issue', 'billing_issue']);

      // Without a grace period the subscription expires at once: a later recovery brings it back.
      sent.length = 0;
      const next = T0 + 2 * MONTH + 10 * DAY;
      await webhook(server.base, { type: 'BILLING_ISSUE', app_user_id: 'u_buyer', product_id: 'mirobe_pro_monthly', expiration_at_ms: next, grace_period_expiration_at_ms: null });
      await webhook(server.base, { type: 'EXPIRATION', app_user_id: 'u_buyer', product_id: 'mirobe_pro_monthly', expiration_at_ms: next, expiration_reason: 'BILLING_ERROR' });
      await webhook(server.base, { type: 'RENEWAL', app_user_id: 'u_buyer', ...period(next + 3 * DAY) });
      await server.billing.settled();
      assert.deepEqual(kinds(sent), ['billing_issue', 'billing_issue', 'renewal', 'renewal']);
    } finally {
      server.close();
    }
  });

  test('auto-renew switched back on leaves an in-app notice instead of a push', async () => {
    const { sender, sent } = stubSender();
    const server = await start(sender);
    try {
      buyer(server.db);
      await webhook(server.base, { type: 'UNCANCELLATION', app_user_id: 'u_buyer', product_id: 'mirobe_pro_monthly' });
      await server.billing.settled();
      assert.deepEqual(sent, []);
      const notices = unseenNotices(server.db, 'u_buyer');
      assert.deepEqual(
        notices.map(({ kind, plan }) => ({ kind, plan })),
        [{ kind: 'uncancellation', plan: 'pro' }]
      );
      // Switched off again before the app showed it: the notice no longer holds.
      await webhook(server.base, { type: 'CANCELLATION', app_user_id: 'u_buyer', product_id: 'mirobe_pro_monthly' });
      assert.deepEqual(unseenNotices(server.db, 'u_buyer'), []);
      // The notification switch covers in-app notices too.
      setNotificationSettings(server.db, 'u_buyer', { subscription: false });
      await webhook(server.base, { type: 'UNCANCELLATION', app_user_id: 'u_buyer', product_id: 'mirobe_pro_monthly' });
      assert.deepEqual(unseenNotices(server.db, 'u_buyer'), []);
    } finally {
      server.close();
    }
  });

  test('payment failed: a billing issue opens subscription management', async () => {
    const { sender, sent } = stubSender();
    const server = await start(sender);
    try {
      buyer(server.db);
      await webhook(server.base, { type: 'BILLING_ISSUE', app_user_id: 'u_buyer', product_id: 'mirobe_pro_monthly' });
      await server.billing.settled();
      assert.equal(sent.length, 2);
      assert.deepEqual(alert(to(sent, TR_PHONE)), { title: 'Ödemen alınamadı', body: 'Mirobe Pro aboneliğin kesilmesin diye ödeme yöntemini güncelle.' });
      assert.deepEqual(alert(to(sent, EN_TABLET)), { title: 'We couldn’t take your payment', body: 'Update your payment method to keep your Mirobe Pro subscription.' });
      assert.deepEqual(data(to(sent, TR_PHONE)), { kind: 'billing_issue', url: 'mirobe:///paywall?manage=1' });
      assert.equal(to(sent, TR_PHONE)?.collapseId, 'mirobe-billing-issue');
      assert.equal(to(sent, TR_PHONE)?.ttlSeconds, 3 * 24 * 60 * 60);
    } finally {
      server.close();
    }
  });

  test('nothing for trials, automatic renewals, auto-renew back on, downgrades, crossgrades, cancellations, expirations, transfers and tests', async () => {
    const { sender, sent } = stubSender();
    const server = await start(sender);
    try {
      buyer(server.db);
      addUser(server.db, 'u_other');
      for (const event of [
        { type: 'INITIAL_PURCHASE', product_id: 'mirobe_pro_monthly', period_type: 'TRIAL', price: 0 },
        { type: 'RENEWAL', product_id: 'mirobe_pro_monthly', price: 19.99 },
        { type: 'UNCANCELLATION', product_id: 'mirobe_pro_monthly' },
        { type: 'PRODUCT_CHANGE', product_id: 'mirobe_pro_monthly', new_product_id: 'mirobe_plus_monthly' },
        { type: 'PRODUCT_CHANGE', product_id: 'mirobe_plus_monthly', new_product_id: 'mirobe_plus_annual' },
        { type: 'CANCELLATION', product_id: 'mirobe_pro_monthly' },
        { type: 'EXPIRATION', product_id: 'mirobe_pro_monthly' },
        { type: 'SUBSCRIPTION_PAUSED', product_id: 'mirobe_pro_monthly' },
        { type: 'TEST' },
      ]) {
        assert.equal((await webhook(server.base, { app_user_id: 'u_buyer', ...event })).status, 200);
      }
      await webhook(server.base, { type: 'TRANSFER', transferred_from: ['u_buyer'], transferred_to: ['u_other'] });
      await server.billing.settled();
      assert.deepEqual(sent, []);
    } finally {
      server.close();
    }
  });

  test('a sandbox purchase (TestFlight) reaches every device of the buyer, each through its own APNs host', async () => {
    const { sender, sent } = stubSender();
    const server = await start(sender);
    try {
      buyer(server.db);
      addDevice(server.db, 'u_buyer', DEV_BUILD, 'sandbox', 'tr');
      await webhook(server.base, { type: 'INITIAL_PURCHASE', environment: 'SANDBOX', app_user_id: 'u_buyer', product_id: 'mirobe_pro_monthly', price: 19.99 });
      await server.billing.settled();
      assert.deepEqual(
        sent.map((n) => [n.token, n.environment]).sort(),
        [[TR_PHONE, 'production'], [EN_TABLET, 'production'], [DEV_BUILD, 'sandbox']].sort()
      );
    } finally {
      server.close();
    }
  });

  test('respects the subscription notification switch', async () => {
    const { sender, sent } = stubSender();
    const server = await start(sender);
    try {
      buyer(server.db);
      setNotificationSettings(server.db, 'u_buyer', { subscription: false });
      await webhook(server.base, { type: 'BILLING_ISSUE', app_user_id: 'u_buyer', product_id: 'mirobe_pro_monthly' });
      await server.billing.settled();
      assert.equal(sent.length, 0);
      setNotificationSettings(server.db, 'u_buyer', { subscription: true });
      await webhook(server.base, { type: 'BILLING_ISSUE', app_user_id: 'u_buyer', product_id: 'mirobe_pro_monthly' });
      await server.billing.settled();
      assert.equal(sent.length, 2);
    } finally {
      server.close();
    }
  });

  test('an event RevenueCat delivers twice notifies once', async () => {
    const { sender, sent } = stubSender();
    const server = await start(sender);
    try {
      buyer(server.db);
      await webhook(server.base, { type: 'EXPIRATION', app_user_id: 'u_buyer', product_id: 'mirobe_plus_annual' });
      // Bought again after it lapsed; the repeat must not be judged again either.
      const event = { id: 'evt_twice', type: 'RENEWAL', app_user_id: 'u_buyer', product_id: 'mirobe_plus_annual', price: 99.99 };
      assert.deepEqual(await (await webhook(server.base, event)).json(), { ok: true, users: 1 });
      await server.billing.settled();
      assert.deepEqual(await (await webhook(server.base, event)).json(), { ok: true, duplicate: true });
      await server.billing.settled();
      assert.equal(sent.length, 2);
    } finally {
      server.close();
    }
  });

  test('only the current owner is notified, not a previous owner still named in the event', async () => {
    const { sender, sent } = stubSender();
    const server = await start(sender);
    try {
      buyer(server.db);
      addUser(server.db, 'u_previous');
      addDevice(server.db, 'u_previous', apnsToken('previous-phone'), 'production', 'tr');
      await webhook(server.base, {
        type: 'INITIAL_PURCHASE',
        app_user_id: 'u_buyer',
        original_app_user_id: 'u_previous',
        aliases: ['u_previous', 'u_buyer'],
        product_id: 'mirobe_pro_monthly',
        price: 19.99,
      });
      await server.billing.settled();
      assert.deepEqual(sent.map((n) => n.token).sort(), [TR_PHONE, EN_TABLET].sort());
    } finally {
      server.close();
    }
  });

  test('tokens APNs calls dead are deleted (410, 400 BadDeviceToken); other failures keep them', async () => {
    const throttled = apnsToken('throttled');
    const flaky = apnsToken('flaky');
    const { sender, sent } = stubSender({
      [TR_PHONE]: { status: 410, reason: 'Unregistered' },
      [EN_TABLET]: { status: 400, reason: 'BadDeviceToken' },
      [throttled]: { status: 429, reason: 'TooManyRequests' },
      [flaky]: { status: 0, reason: 'Timeout' },
    });
    const server = await start(sender);
    try {
      buyer(server.db);
      addDevice(server.db, 'u_buyer', throttled, 'production', 'tr');
      addDevice(server.db, 'u_buyer', flaky, 'production', 'en');
      await webhook(server.base, { type: 'INITIAL_PURCHASE', app_user_id: 'u_buyer', product_id: 'mirobe_plus_monthly', price: 9.99 });
      await server.billing.settled();
      assert.equal(sent.length, 4);
      assert.equal(tokenCount(server.db, TR_PHONE), 0);
      assert.equal(tokenCount(server.db, EN_TABLET), 0);
      assert.equal(tokenCount(server.db, throttled), 1);
      assert.equal(tokenCount(server.db, flaky), 1);
    } finally {
      server.close();
    }
  });

  test('the webhook answers without waiting for APNs', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let delivered = 0;
    const server = await start({
      async send() {
        await gate;
        delivered += 1;
        return { status: 200 };
      },
    });
    try {
      buyer(server.db);
      const response = await webhook(server.base, { type: 'BILLING_ISSUE', app_user_id: 'u_buyer', product_id: 'mirobe_plus_monthly' });
      assert.equal(response.status, 200);
      assert.equal(delivered, 0);
      release();
      await server.billing.settled();
      assert.equal(delivered, 2);
    } finally {
      server.close();
    }
  });

  test('an unknown product still notifies, without a plan name; no APNs key sends nothing and breaks nothing', async () => {
    const { sender, sent } = stubSender();
    const server = await start(sender);
    const unconfigured = await start(null);
    try {
      buyer(server.db);
      await webhook(server.base, { type: 'INITIAL_PURCHASE', app_user_id: 'u_buyer', product_id: 'legacy_product', price: 4.99 });
      await server.billing.settled();
      assert.deepEqual(alert(to(sent, TR_PHONE)), { title: 'Ödemen alındı', body: 'Aboneliğin etkin. Yeni haklarını hemen kullanabilirsin.' });

      buyer(unconfigured.db);
      assert.equal((await webhook(unconfigured.base, { type: 'BILLING_ISSUE', app_user_id: 'u_buyer', product_id: 'mirobe_pro_monthly' })).status, 200);
      await unconfigured.billing.settled();
      assert.equal(tokenCount(unconfigured.db, TR_PHONE), 1);
    } finally {
      server.close();
      unconfigured.close();
    }
  });

  test('the app wires its sender into the webhook', async () => {
    const { sender, sent } = stubSender();
    const config = loadConfig({ dataDir, revenueCatSecret: undefined, revenueCatWebhookAuth: SECRET, devPlanOverride: undefined, authRateLimit: 1000 });
    const db = openDb(':memory:');
    const app = createApp({ db, config, media: new MediaStorage(db, dataDir), usage: new UsageLedger(db), push: sender });
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const account = (await (
        await fetch(`${base}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'wired@example.com', password: PASSWORD }),
        })
      ).json()) as { userId: string; token: string };
      const phone = apnsToken('wired');
      const registered = await fetch(`${base}/api/push/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.token}` },
        body: JSON.stringify({ token: phone, platform: 'ios', environment: 'production', lang: 'en' }),
      });
      assert.equal(registered.status, 200);
      assert.equal((await webhook(base, { type: 'INITIAL_PURCHASE', app_user_id: account.userId, product_id: 'mirobe_pro_annual', price: 199.99 })).status, 200);
      await waitFor(() => sent.length === 1);
      assert.equal(sent[0].token, phone);
      assert.equal(alert(sent[0]).title, 'Payment received');
    } finally {
      server.close();
    }
  });

  test('product ids map to plans, Play base plans included', () => {
    assert.equal(planOfProduct('mirobe_pro_annual'), 'pro');
    assert.equal(planOfProduct('mirobe_plus_monthly:monthly'), 'plus');
    assert.equal(planOfProduct('something_else'), null);
    assert.equal(planOfProduct(undefined), null);
    const lapsed = { expiresAt: null, lapsed: true };
    assert.deepEqual(subscriptionNotice({ type: 'RENEWAL', product_id: 'mirobe_pro_monthly', price: 0 }, lapsed), null);
    assert.deepEqual(subscriptionNotice({ type: 'RENEWAL', product_id: 'mirobe_pro_monthly', price: null }, lapsed), { kind: 'renewal', plan: 'pro' });
  });

  test('a renewal is the user’s own after an expiration or when it starts more than a day after the known end', () => {
    const known = { expiresAt: T0, lapsed: false };
    assert.equal(renewedByUser({ purchased_at_ms: T0 - 20 * HOUR }, known), false);
    assert.equal(renewedByUser({ purchased_at_ms: T0 + 24 * HOUR }, known), false);
    assert.equal(renewedByUser({ purchased_at_ms: T0 + 24 * HOUR + 1 }, known), true);
    assert.equal(renewedByUser({ purchased_at_ms: null }, known), false);
    assert.equal(renewedByUser({ purchased_at_ms: T0 + 90 * DAY }, { expiresAt: null, lapsed: false }), false);
    assert.equal(renewedByUser({ purchased_at_ms: T0 - DAY }, { expiresAt: T0, lapsed: true }), true);
    // Only numeric epoch milliseconds count as a time.
    for (const value of ['1780000000000', Number.NaN, -1, 0, 1e20, undefined]) assert.equal(eventTime(value), null, String(value));
    assert.equal(eventTime(T0 + 0.5), T0);
  });
});

describe('in-app notices', () => {
  let base = '';
  let db: Db;
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  const { sender, sent } = stubSender();

  before(async () => {
    const config = loadConfig({ dataDir, revenueCatSecret: undefined, revenueCatWebhookAuth: SECRET, devPlanOverride: undefined, authRateLimit: 1000 });
    db = openDb(':memory:');
    const app = createApp({ db, config, media: new MediaStorage(db, dataDir), usage: new UsageLedger(db), push: sender });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  async function call(method: string, url: string, token?: string, body?: unknown) {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json().catch(() => null)) as any };
  }
  let accounts = 0;
  const register = async () =>
    (await call('POST', '/api/auth/register', undefined, { email: `notice${Date.now().toString(36)}${(accounts += 1)}@example.com`, password: PASSWORD }))
      .body as { userId: string; token: string };
  const notices = async (token: string) => {
    const me = await call('GET', '/api/me', token);
    assert.equal(me.status, 200);
    return me.body.notices as { id: string; kind: string; plan?: string }[];
  };
  const uncancel = (userId: string, product = 'mirobe_pro_monthly') => webhook(base, { type: 'UNCANCELLATION', app_user_id: userId, product_id: product });

  test('auto-renew switched back on is listed by /api/me, not pushed, until the app marks it seen', async () => {
    const account = await register();
    const phone = apnsToken('notice-phone');
    assert.equal((await call('POST', '/api/push/tokens', account.token, { token: phone, platform: 'ios', environment: 'production', lang: 'tr' })).status, 200);
    assert.deepEqual(await notices(account.token), []);
    assert.equal((await uncancel(account.userId)).status, 200);
    const [notice, ...rest] = await notices(account.token);
    assert.deepEqual(rest, []);
    assert.match(notice.id, /^ntc_/);
    assert.deepEqual(notice, { id: notice.id, kind: 'uncancellation', plan: 'pro' });
    // Pushes still flow for this device, and the first one is the billing issue, not the notice.
    await webhook(base, { type: 'BILLING_ISSUE', app_user_id: account.userId, product_id: 'mirobe_pro_monthly' });
    await waitFor(() => sent.length === 1);
    assert.deepEqual(sent.map((n) => [n.token, (n.payload.body as { kind: string }).kind]), [[phone, 'billing_issue']]);

    // Only the owner can mark it; anyone else is told it does not exist.
    const other = await register();
    assert.equal((await call('POST', `/api/notices/${notice.id}/seen`)).status, 401);
    assert.equal((await call('POST', `/api/notices/${notice.id}/seen`, other.token)).status, 404);
    assert.equal((await notices(account.token)).length, 1);
    assert.deepEqual((await call('POST', `/api/notices/${notice.id}/seen`, account.token)).body, { ok: true });
    assert.deepEqual(await notices(account.token), []);
    // Marking it again is harmless; an unknown id is not found.
    assert.equal((await call('POST', `/api/notices/${notice.id}/seen`, account.token)).status, 200);
    assert.equal((await call('POST', '/api/notices/ntc_missing/seen', account.token)).status, 404);
  });

  test('a newer notice replaces an unseen one; switching auto-renew off again withdraws it', async () => {
    const account = await register();
    await uncancel(account.userId);
    // An unknown product leaves the plan out.
    await uncancel(account.userId, 'legacy_product');
    const [notice, ...rest] = await notices(account.token);
    assert.deepEqual(rest, []);
    assert.deepEqual(notice, { id: notice.id, kind: 'uncancellation' });
    await webhook(base, { type: 'CANCELLATION', app_user_id: account.userId, product_id: 'mirobe_pro_monthly' });
    assert.deepEqual(await notices(account.token), []);
    await uncancel(account.userId);
    await webhook(base, { type: 'EXPIRATION', app_user_id: account.userId, product_id: 'mirobe_pro_monthly' });
    assert.deepEqual(await notices(account.token), []);
  });

  test('at most five, newest first; a notice older than 30 days is no longer listed', async () => {
    const account = await register();
    const insert = db.prepare("INSERT INTO user_notices (id, user_id, kind, plan, created_at) VALUES (?, ?, 'uncancellation', 'plus', ?)");
    for (let index = 0; index < 7; index += 1) insert.run(`ntc_many_${index}`, account.userId, new Date(Date.now() - (index + 1) * HOUR).toISOString());
    insert.run('ntc_stale', account.userId, new Date(Date.now() - 31 * DAY).toISOString());
    assert.deepEqual(
      (await notices(account.token)).map((notice) => notice.id),
      ['ntc_many_0', 'ntc_many_1', 'ntc_many_2', 'ntc_many_3', 'ntc_many_4']
    );
  });

  test('the periodic prune deletes notices older than 30 days, seen or not', async () => {
    const account = await register();
    const insert = db.prepare("INSERT INTO user_notices (id, user_id, kind, plan, created_at, seen_at) VALUES (?, ?, 'uncancellation', 'plus', ?, ?)");
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    insert.run('ntc_old_seen', account.userId, ago(31 * DAY), ago(30 * DAY));
    insert.run('ntc_old_unseen', account.userId, ago(31 * DAY), null);
    insert.run('ntc_recent_seen', account.userId, ago(DAY), ago(HOUR));
    insert.run('ntc_recent_unseen', account.userId, ago(HOUR), null);
    pruneNotices(db);
    const left = db.prepare('SELECT id FROM user_notices WHERE user_id = ? ORDER BY id').all(account.userId) as { id: string }[];
    assert.deepEqual(left.map((row) => row.id), ['ntc_recent_seen', 'ntc_recent_unseen']);
  });

  test('deleting the account deletes its notices and subscription history', async () => {
    const account = await register();
    await webhook(base, { type: 'EXPIRATION', app_user_id: account.userId, product_id: 'mirobe_pro_monthly', expiration_at_ms: T0 });
    await uncancel(account.userId);
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM user_notices WHERE user_id = ?').get(account.userId) as { n: number }).n;
    assert.equal(count(), 1);
    assert.deepEqual(subscriptionHistory(db, account.userId), { expiresAt: T0, lapsed: true });
    assert.equal((await call('DELETE', '/api/me', account.token, { password: PASSWORD })).status, 200);
    assert.equal(count(), 0);
    assert.equal(db.prepare('SELECT 1 FROM users WHERE id = ?').get(account.userId), undefined);
  });
});

describe('APNs client', () => {
  const LIVE = apnsToken('live-device');
  const DEAD = apnsToken('dead-device');

  function keyPair() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    return { publicKey, p8: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()).toString('base64') };
  }

  /** A local cleartext HTTP/2 server standing in for APNs. */
  async function fakeApns(respond: (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders, body: string) => void) {
    const server = http2.createServer();
    const sessions = new Set<http2.ServerHttp2Session>();
    server.on('session', (session) => sessions.add(session));
    server.on('stream', (stream: http2.ServerHttp2Stream, headers) => {
      let body = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        body += chunk;
      });
      stream.on('end', () => respond(stream, headers, body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return {
      hosts: { production: url, sandbox: url },
      close: () => {
        for (const session of sessions) session.destroy();
        server.close();
      },
    };
  }

  test('signs an ES256 provider token, sends the APNs headers and reads the answer', async () => {
    const { publicKey, p8 } = keyPair();
    const requests: { headers: http2.IncomingHttpHeaders; body: string }[] = [];
    const apns = await fakeApns((stream, headers, body) => {
      requests.push({ headers, body });
      if (String(headers[':path']).endsWith(DEAD)) {
        stream.respond({ ':status': 410, 'content-type': 'application/json' });
        stream.end(JSON.stringify({ reason: 'Unregistered', timestamp: 1 }));
      } else {
        stream.respond({ ':status': 200, 'apns-id': 'A1' });
        stream.end();
      }
    });
    try {
      const config = loadConfig({ apnsKeyId: 'ABC123DEFG', apnsTeamId: 'TEAM123456', apnsKey: p8, apnsTopic: 'com.example.app' });
      const sender = createApnsSender(config, { hosts: apns.hosts });
      assert.ok(sender);
      const payload = { aps: { alert: { title: 'T', body: 'B' }, sound: 'default' }, body: { kind: 'renewal', url: 'mirobe:///profile' } };
      assert.deepEqual(await sender.send({ token: LIVE, environment: 'production', payload, collapseId: 'c-1', ttlSeconds: 60 }), { status: 200 });
      assert.deepEqual(await sender.send({ token: DEAD, environment: 'sandbox', payload }), { status: 410, reason: 'Unregistered' });

      const [first, second] = requests;
      assert.equal(first.headers[':method'], 'POST');
      assert.equal(first.headers[':path'], `/3/device/${LIVE}`);
      assert.equal(first.headers['apns-topic'], 'com.example.app');
      assert.equal(first.headers['apns-push-type'], 'alert');
      assert.equal(first.headers['apns-priority'], '10');
      assert.equal(first.headers['apns-collapse-id'], 'c-1');
      const expiration = Number(first.headers['apns-expiration']);
      assert.ok(Math.abs(expiration - (Date.now() / 1000 + 60)) < 5, `expiration ${expiration}`);
      assert.deepEqual(JSON.parse(first.body), payload);

      const jwt = String(first.headers.authorization).replace(/^bearer /, '');
      const [header, claims, signature] = jwt.split('.');
      assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'ES256', kid: 'ABC123DEFG' });
      const parsed = JSON.parse(Buffer.from(claims, 'base64url').toString()) as { iss: string; iat: number };
      assert.equal(parsed.iss, 'TEAM123456');
      assert.ok(Math.abs(parsed.iat - Date.now() / 1000) < 60);
      assert.ok(crypto.verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
      // Reused, not re-signed per request (APNs throttles provider token refreshes).
      assert.equal(second.headers.authorization, first.headers.authorization);
    } finally {
      apns.close();
    }
  });

  test('an APNs that never answers times out, an unreachable one fails; neither throws', async () => {
    const { p8 } = keyPair();
    const config = loadConfig({ apnsKeyId: 'ABC123DEFG', apnsKey: p8 });
    const silent = await fakeApns(() => {
      // Never answers.
    });
    try {
      const sender = createApnsSender(config, { hosts: silent.hosts, timeoutMs: 200 });
      assert.deepEqual(await sender!.send({ token: LIVE, environment: 'production', payload: { aps: {} } }), { status: 0, reason: 'Timeout' });
    } finally {
      silent.close();
    }
    const nowhere = createApnsSender(config, { hosts: { production: 'http://127.0.0.1:1', sandbox: 'http://127.0.0.1:1' }, timeoutMs: 2000 });
    const result = await nowhere!.send({ token: LIVE, environment: 'production', payload: { aps: {} } });
    assert.equal(result.status, 0);
    assert.ok(result.reason);
  });

  test('push stays off without a key id and key, or with an unusable key', () => {
    const { p8 } = keyPair();
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    assert.equal(createApnsSender(loadConfig({ apnsKeyId: undefined, apnsKey: undefined })), null);
    assert.equal(createApnsSender(loadConfig({ apnsKeyId: undefined, apnsKey: p8 })), null);
    assert.equal(createApnsSender(loadConfig({ apnsKeyId: 'ABC123DEFG', apnsKey: Buffer.from('not a key').toString('base64') })), null);
    assert.equal(createApnsSender(loadConfig({ apnsKeyId: 'ABC123DEFG', apnsKey: Buffer.from(rsa).toString('base64') })), null);
    // A PEM pasted with literal \n escapes works too.
    const pem = Buffer.from(p8, 'base64').toString().replace(/\n/g, '\\n');
    assert.ok(createApnsSender(loadConfig({ apnsKeyId: 'ABC123DEFG', apnsKey: pem })));
  });
});
