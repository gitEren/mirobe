import { PLANS, REVENUECAT_PRODUCTS, type PlanId, type PushEnvironment, type UserNoticeKind } from '@mirobe/shared';
import type { Db } from '../db/index';
import type { PushLang, PushMessage } from './push';

type PaidPlan = Exclude<PlanId, 'free'>;

const RANK: Record<PlanId, number> = { free: 0, plus: 1, pro: 2 };

/** The RevenueCat webhook event fields the notices read. */
export interface SubscriptionEvent {
  type?: string;
  /** SANDBOX for store sandbox purchases (dev builds, TestFlight, sandbox accounts), else PRODUCTION. */
  environment?: string;
  product_id?: string;
  /** PRODUCT_CHANGE only: the product switched to (`product_id` is the one switched from). */
  new_product_id?: string | null;
  period_type?: string;
  /** USD; 0 for a free trial. */
  price?: number | null;
  /** When the transaction (a purchase, a renewal) was made, ms since the epoch. */
  purchased_at_ms?: number | null;
  /** When the transaction's period ends, ms since the epoch; null for non-expiring products. */
  expiration_at_ms?: number | null;
  /** BILLING_ISSUE only: the end of the store's grace period, null without one. */
  grace_period_expiration_at_ms?: number | null;
}

export type NoticeKind = 'purchase' | 'renewal' | 'upgrade' | 'billing_issue';

export interface SubscriptionNotice {
  kind: NoticeKind;
  /** Null for a product this app does not know: the text then leaves the plan name out. */
  plan: PaidPlan | null;
}

/** Store product id (Play reports "productId:basePlanId") → plan. */
export function planOfProduct(productId: string | null | undefined): PaidPlan | null {
  const id = productId?.split(':')[0];
  if (!id) return null;
  for (const plan of Object.keys(REVENUECAT_PRODUCTS) as PaidPlan[]) {
    if ((Object.values(REVENUECAT_PRODUCTS[plan]) as string[]).includes(id)) return plan;
  }
  return null;
}

/** Nothing was charged: a free trial starting, or a free offer period. */
const nothingCharged = (event: SubscriptionEvent) => event.period_type === 'TRIAL' || event.price === 0;

// ---------------------------------------------------------------------------
// Renewals the user bought: what earlier webhook events said about the subscription
// ---------------------------------------------------------------------------

/** What the webhooks have said about a user's subscription so far. */
export interface SubscriptionHistory {
  /** End of the last known period (ms), pushed out to the end of a billing grace period; null: unknown. */
  expiresAt: number | null;
  /** An EXPIRATION came in after the last purchase or renewal. */
  lapsed: boolean;
}

/** A renewal whose period starts more than this long after the last known one ended followed a lapse. */
export const LAPSE_GAP_MS = 24 * 60 * 60 * 1000;

/** A webhook timestamp (ms since the epoch), or null when missing or not a usable date. */
export function eventTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < Date.UTC(10000, 0, 1) ? Math.trunc(value) : null;
}

/**
 * Whether a RENEWAL was the user's own doing: they bought the subscription again after it
 * had lapsed. Either an EXPIRATION came in since the last purchase or renewal, or the new
 * period started more than a day after the last known one ended (a lapse whose EXPIRATION
 * we never saw). Automatic renewals are charged around the end of the period (up to a day
 * before it, sometimes a little after); a billing retry that succeeds within the grace
 * period counts as automatic too, as the grace period extends the known end (see
 * recordSubscriptionEvent). Without any history a renewal is taken as automatic.
 */
export function renewedByUser(event: SubscriptionEvent, history: SubscriptionHistory): boolean {
  if (history.lapsed) return true;
  const purchasedAt = eventTime(event.purchased_at_ms);
  return purchasedAt !== null && history.expiresAt !== null && purchasedAt - history.expiresAt > LAPSE_GAP_MS;
}

export function subscriptionHistory(db: Db, userId: string): SubscriptionHistory {
  const row = db.prepare('SELECT subscription_expires_at, subscription_lapsed_at FROM users WHERE id = ?').get(userId) as
    | { subscription_expires_at: string | null; subscription_lapsed_at: string | null }
    | undefined;
  const expiresAt = row?.subscription_expires_at ? Date.parse(row.subscription_expires_at) : Number.NaN;
  return { expiresAt: Number.isFinite(expiresAt) ? expiresAt : null, lapsed: Boolean(row?.subscription_lapsed_at) };
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/**
 * Keeps what an event says for the next renewal to be judged by (see renewedByUser): the
 * end of the current period (INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE, EXPIRATION, and
 * SUBSCRIPTION_EXTENDED, which moves it), moved to the end of the grace period on a
 * BILLING_ISSUE (the store keeps retrying while the user keeps access), and whether the
 * subscription expired since the last purchase or renewal. A TRANSFER (a restore on another
 * account) starts over on both sides: whatever was known belonged to another subscription.
 */
export function recordSubscriptionEvent(db: Db, userId: string, event: SubscriptionEvent, now = new Date()) {
  const expiration = iso(eventTime(event.expiration_at_ms));
  switch (event.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
      // Bought or renewed: whatever had lapsed is active again.
      db.prepare('UPDATE users SET subscription_expires_at = COALESCE(?, subscription_expires_at), subscription_lapsed_at = NULL WHERE id = ?').run(
        expiration,
        userId
      );
      return;
    case 'PRODUCT_CHANGE':
    case 'SUBSCRIPTION_EXTENDED':
      db.prepare('UPDATE users SET subscription_expires_at = COALESCE(?, subscription_expires_at) WHERE id = ?').run(expiration, userId);
      return;
    case 'TRANSFER':
      db.prepare('UPDATE users SET subscription_expires_at = NULL, subscription_lapsed_at = NULL WHERE id = ?').run(userId);
      return;
    case 'EXPIRATION':
      db.prepare(
        'UPDATE users SET subscription_expires_at = COALESCE(?, subscription_expires_at), subscription_lapsed_at = COALESCE(subscription_lapsed_at, ?) WHERE id = ?'
      ).run(expiration, now.toISOString(), userId);
      return;
    case 'BILLING_ISSUE': {
      const graceEnd = eventTime(event.grace_period_expiration_at_ms);
      const known = subscriptionHistory(db, userId).expiresAt;
      if (graceEnd !== null && (known === null || graceEnd > known)) {
        db.prepare('UPDATE users SET subscription_expires_at = ? WHERE id = ?').run(iso(graceEnd), userId);
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Which notice an event gets
// ---------------------------------------------------------------------------

/**
 * The push a webhook event gets, if any, given what earlier events said (`history`, read
 * before this event is recorded). Payment received: a first purchase, a renewal the user
 * bought after the subscription had lapsed (not an automatic one, see renewedByUser) and an
 * upgrade (charged at once; downgrades and crossgrades only take effect, and are paid, at
 * the next renewal). Payment failed: a billing issue. Auto-renew switched back on is an
 * in-app notice instead (see inAppNotice). Everything else (cancellation, expiration,
 * transfers, …) sends nothing.
 */
export function subscriptionNotice(event: SubscriptionEvent, history: SubscriptionHistory): SubscriptionNotice | null {
  switch (event.type) {
    case 'INITIAL_PURCHASE':
      return nothingCharged(event) ? null : { kind: 'purchase', plan: planOfProduct(event.product_id) };
    case 'RENEWAL':
      return nothingCharged(event) || !renewedByUser(event, history) ? null : { kind: 'renewal', plan: planOfProduct(event.product_id) };
    case 'PRODUCT_CHANGE': {
      const from = planOfProduct(event.product_id);
      const to = planOfProduct(event.new_product_id);
      return from && to && RANK[to] > RANK[from] ? { kind: 'upgrade', plan: to } : null;
    }
    case 'BILLING_ISSUE':
      return { kind: 'billing_issue', plan: planOfProduct(event.product_id) };
    default:
      return null;
  }
}

/** The in-app notice an event leaves for the app (see userNotices.ts): auto-renew switched back on. */
export function inAppNotice(event: SubscriptionEvent): { kind: UserNoticeKind; plan: PaidPlan | null } | null {
  return event.type === 'UNCANCELLATION' ? { kind: 'uncancellation', plan: planOfProduct(event.product_id) } : null;
}

/** Unseen in-app notices an event makes untrue: auto-renew switched off again, or the subscription ended. */
export function outdatedNotices(event: SubscriptionEvent): UserNoticeKind[] {
  return event.type === 'CANCELLATION' || event.type === 'EXPIRATION' ? ['uncancellation'] : [];
}

/** Turkish dative of the plan names ("Pro’ya geçtin"). */
const TR_DATIVE: Record<PaidPlan, string> = { plus: 'Plus’a', pro: 'Pro’ya' };

type Texts = Record<NoticeKind, (plan: PaidPlan | null) => { title: string; body: string }>;

const TEXTS: Record<PushLang, Texts> = {
  tr: {
    purchase: (plan) => ({
      title: 'Ödemen alındı',
      body: plan ? `Mirobe ${PLANS[plan].label} planın etkin. Yeni haklarını hemen kullanabilirsin.` : 'Aboneliğin etkin. Yeni haklarını hemen kullanabilirsin.',
    }),
    // Only after a lapse (see renewedByUser), so the plan is active again rather than uninterrupted.
    renewal: (plan) => ({
      title: 'Aboneliğin yenilendi',
      body: plan ? `Ödemen alındı, Mirobe ${PLANS[plan].label} planın yeniden etkin.` : 'Ödemen alındı, aboneliğin yeniden etkin.',
    }),
    upgrade: (plan) => ({
      title: plan ? `${TR_DATIVE[plan]} geçtin` : 'Planın yükseltildi',
      body: 'Ödemen alındı, yeni planın hemen etkin.',
    }),
    billing_issue: (plan) => ({
      title: 'Ödemen alınamadı',
      body: plan ? `Mirobe ${PLANS[plan].label} aboneliğin kesilmesin diye ödeme yöntemini güncelle.` : 'Aboneliğin kesilmesin diye ödeme yöntemini güncelle.',
    }),
  },
  en: {
    purchase: (plan) => ({
      title: 'Payment received',
      body: plan ? `Your Mirobe ${PLANS[plan].label} plan is active and ready to use.` : 'Your subscription is active and ready to use.',
    }),
    renewal: (plan) => ({
      title: 'Subscription renewed',
      body: plan ? `Payment received. Your Mirobe ${PLANS[plan].label} plan is active again.` : 'Payment received. Your subscription is active again.',
    }),
    upgrade: (plan) => ({
      title: plan ? `You’re on ${PLANS[plan].label} now` : 'Your plan was upgraded',
      body: 'Payment received. Your new plan is active right away.',
    }),
    billing_issue: (plan) => ({
      title: 'We couldn’t take your payment',
      body: plan ? `Update your payment method to keep your Mirobe ${PLANS[plan].label} subscription.` : 'Update your payment method to keep your subscription.',
    }),
  },
};

/**
 * The push for a notice. A tap on "payment failed" opens the paywall straight into the
 * store's subscription management; the others open the profile (plan and allowances).
 */
export function subscriptionMessage(notice: SubscriptionNotice, lang: PushLang): PushMessage {
  const failed = notice.kind === 'billing_issue';
  return {
    ...TEXTS[lang][notice.kind](notice.plan),
    kind: notice.kind,
    url: failed ? 'mirobe:///paywall?manage=1' : 'mirobe:///profile',
    threadId: 'subscription',
    collapseId: failed ? 'mirobe-billing-issue' : 'mirobe-subscription',
    ttlSeconds: (failed ? 3 : 1) * 24 * 60 * 60,
  };
}
