import crypto from 'node:crypto';
import express, { type RequestHandler } from 'express';
import type { MeResponse } from '@mirobe/shared';
import type { Config } from '../config';
import { transaction, type Db } from '../db/index';
import type { PushSender } from '../lib/apns';
import { invalidatePlan, resolvePlan } from '../lib/entitlements';
import { HttpError, route } from '../lib/http';
import { notificationSettings, pushToUser } from '../lib/push';
import { RateLimiter } from '../lib/rateLimit';
import {
  inAppNotice,
  outdatedNotices,
  recordSubscriptionEvent,
  subscriptionHistory,
  subscriptionMessage,
  subscriptionNotice,
  type SubscriptionEvent,
  type SubscriptionNotice,
} from '../lib/subscriptionNotices';
import type { UsageLedger } from '../lib/usage';
import { addNotice, withdrawNotices } from '../lib/userNotices';

/** Event types that can change what a subscriber is entitled to. Others (TEST, …) are acknowledged only. */
export const PLAN_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'CANCELLATION',
  'UNCANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
  'SUBSCRIPTION_PAUSED',
  'SUBSCRIPTION_EXTENDED',
  'NON_RENEWING_PURCHASE',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'REFUND_REVERSED',
  'TRANSFER',
]);

/** Processed webhook event ids are kept this long; RevenueCat retries for far less. */
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_USERS_PER_EVENT = 20;

interface WebhookEvent extends SubscriptionEvent {
  id?: string;
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  transferred_from?: string[];
  transferred_to?: string[];
}

/** Constant-time equality: both sides are hashed first so their lengths never leak. */
function safeEqual(a: string, b: string) {
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/** RevenueCat sends the configured Authorization value verbatim; "Bearer <secret>" is accepted too. */
export function webhookAuthorized(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const exact = safeEqual(header, secret);
  const bearer = safeEqual(header, `Bearer ${secret}`);
  return exact || bearer;
}

/** Our user ids named in an event (RevenueCat anonymous ids and unknown ids are skipped). */
export function eventUserIds(db: Db, event: WebhookEvent): string[] {
  const candidates = [
    event.app_user_id,
    event.original_app_user_id,
    ...(event.aliases ?? []),
    ...(event.transferred_from ?? []),
    ...(event.transferred_to ?? []),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200 && !id.startsWith('$RCAnonymousID'));
  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?');
  return [...new Set(candidates)].filter((id) => exists.get(id)).slice(0, MAX_USERS_PER_EVENT);
}

/**
 * Applies an event to one subscriber: records it in the subscription history, updates the
 * in-app notices and returns the push it calls for, if any. Whether a renewal was the user's
 * own doing depends on what earlier events said, so the history is read before recording.
 * Users who switched subscription notifications off get neither pushes nor in-app notices.
 */
function applyEvent(db: Db, userId: string, event: WebhookEvent): SubscriptionNotice | null {
  const history = subscriptionHistory(db, userId);
  recordSubscriptionEvent(db, userId, event);
  const wanted = notificationSettings(db, userId).subscription;
  for (const kind of outdatedNotices(event)) withdrawNotices(db, userId, kind);
  const notice = inAppNotice(event);
  if (notice && wanted) addNotice(db, userId, notice.kind, notice.plan);
  return wanted ? subscriptionNotice(event, history) : null;
}

interface BillingDeps {
  db: Db;
  config: Config;
  usage: UsageLedger;
  auth: RequestHandler;
  requireAccount: RequestHandler;
  /** APNs client for payment notices; null or absent: nothing is sent. */
  push?: PushSender | null;
}

/**
 * Store billing: the app's post-purchase sync and RevenueCat webhooks. Neither
 * trusts a plan sent by a client or in an event body: both re-read the subscriber
 * from RevenueCat's REST API (see resolvePlan). Webhooks also send the payment
 * notices and leave in-app notices (see subscriptionNotice, inAppNotice); only
 * their wording and timing come from the event.
 */
export function billingRoutes({ db, config, usage, auth, requireAccount, push }: BillingDeps) {
  db.exec(`CREATE TABLE IF NOT EXISTS billing_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    received_at TEXT NOT NULL
  )`);
  const router = express.Router();
  const syncs = new RateLimiter(20, 15 * 60 * 1000);
  /** Background refreshes and pushes in flight, exposed for tests. */
  const pending = new Set<Promise<unknown>>();
  const track = (job: Promise<unknown>) => {
    const tracked = job.finally(() => pending.delete(tracked));
    pending.add(tracked);
  };

  // After a purchase or restore the app asks for its plan straight from RevenueCat.
  router.post(
    '/api/billing/sync',
    auth,
    requireAccount,
    route(async (req, res) => {
      if (!syncs.attempt(req.userId)) throw new HttpError(429, 'Too many attempts. Try again later.', 'RATE_LIMITED');
      const plan = await resolvePlan(db, config, req.userId, true);
      const me: MeResponse = { userId: req.userId, email: req.userEmail, isAnonymous: !req.userEmail, usage: usage.snapshot(req.userId, plan) };
      res.json(me);
    })
  );

  router.post('/api/billing/revenuecat-webhook', (req, res) => {
    if (!config.revenueCatWebhookAuth) console.warn('[mirobe] RevenueCat webhook refused: REVENUECAT_WEBHOOK_AUTH is not set');
    if (!webhookAuthorized(req.get('authorization'), config.revenueCatWebhookAuth)) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    const event = (req.body?.event ?? null) as WebhookEvent | null;
    if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
      return res.status(400).json({ error: 'Invalid event', code: 'VALIDATION' });
    }

    const now = new Date();
    const id = event.id.slice(0, 200);
    const type = event.type.slice(0, 64);
    db.prepare('DELETE FROM billing_events WHERE received_at < ?').run(new Date(now.getTime() - EVENT_RETENTION_MS).toISOString());
    const users = PLAN_EVENTS.has(event.type) ? eventUserIds(db, event) : [];
    // Notices concern the subscription's current owner only: after a transfer the previous
    // owner can still be named as original_app_user_id or an alias.
    const owner = event.app_user_id && users.includes(event.app_user_id) ? [event.app_user_id] : users;
    // The event id is stored together with what the event changes, so a failure leaves nothing
    // half-done and RevenueCat's retry is processed again instead of being taken as a duplicate.
    const pushes = transaction(db, () => {
      const inserted = db.prepare('INSERT OR IGNORE INTO billing_events (id, type, received_at) VALUES (?, ?, ?)').run(id, type, now.toISOString());
      if (inserted.changes === 0) return null;
      return owner.map((userId) => ({ userId, notice: applyEvent(db, userId, event) }));
    });
    if (!pushes) return res.json({ ok: true, duplicate: true });

    // The cache is dropped before answering, so even if the refresh below fails
    // the next request from these users asks RevenueCat again.
    for (const userId of users) invalidatePlan(db, userId);
    res.json({ ok: true, users: users.length });

    for (const userId of users) {
      track(resolvePlan(db, config, userId, true).catch((error) => console.warn('[mirobe] webhook plan refresh failed:', (error as Error).message)));
    }

    // Payment notices go out after the answer, so a slow APNs never delays RevenueCat.
    // A duplicate event returned above, so each event notifies at most once.
    for (const { userId, notice } of pushes) {
      if (!notice) continue;
      track(
        pushToUser(db, push, userId, (lang) => subscriptionMessage(notice, lang)).catch((error) =>
          console.warn('[mirobe] payment notice failed:', (error as Error).message)
        )
      );
    }
  });

  return Object.assign(router, { settled: () => Promise.all([...pending]) });
}
