import { REVENUECAT_ENTITLEMENTS, normalizePlanId, type PlanId } from '@mirobe/shared';
import type { Config } from '../config';
import type { Db } from '../db/index';

const RECHECK_MS = 10 * 60 * 1000;
/** After a failed lookup the cached plan is used for this long before RevenueCat is asked again. */
const RETRY_AFTER_FAILURE_MS = 60 * 1000;
const RANK: Record<PlanId, number> = { free: 0, plus: 1, pro: 2 };

/** The parts of a RevenueCat v1 subscriber we read. */
interface RevenueCatEntitlement {
  /** null: lifetime / non-expiring. */
  expires_date?: string | null;
  grace_period_expires_date?: string | null;
  product_identifier?: string;
}
interface RevenueCatSubscription {
  expires_date?: string | null;
  grace_period_expires_date?: string | null;
}
export interface RevenueCatSubscriber {
  entitlements?: Record<string, RevenueCatEntitlement>;
  subscriptions?: Record<string, RevenueCatSubscription>;
}

const inFuture = (date: string | null | undefined, now: number) => {
  if (!date) return false;
  const time = Date.parse(date);
  return Number.isFinite(time) && time > now;
};

/**
 * An entitlement grants access while it has not expired, while the store's grace
 * period after a failed renewal (billing issue) is running, or forever when it has
 * no expiry (lifetime). The grace date may sit on the entitlement or on the
 * subscription that backs it (Play reports it as "productId:basePlanId" or bare).
 */
export function entitlementActive(entitlement: RevenueCatEntitlement, subscriber: RevenueCatSubscriber, now = Date.now()): boolean {
  if (entitlement.expires_date === null || entitlement.expires_date === undefined) return true;
  if (inFuture(entitlement.expires_date, now) || inFuture(entitlement.grace_period_expires_date, now)) return true;
  const product = entitlement.product_identifier;
  if (!product) return false;
  const subscription = subscriber.subscriptions?.[product] ?? subscriber.subscriptions?.[product.split(':')[0]];
  return Boolean(subscription && inFuture(subscription.grace_period_expires_date, now));
}

/** Highest plan among the subscriber's active entitlements; unknown entitlement ids are ignored. */
export function planFromSubscriber(subscriber: RevenueCatSubscriber | undefined, now = Date.now()): PlanId {
  let plan: PlanId = 'free';
  for (const [key, entitlement] of Object.entries(subscriber?.entitlements ?? {})) {
    const mapped = REVENUECAT_ENTITLEMENTS[key];
    if (mapped && RANK[mapped] > RANK[plan] && entitlementActive(entitlement, subscriber ?? {}, now)) plan = mapped;
  }
  return plan;
}

/** Forgets the cached plan so the next resolvePlan asks RevenueCat (webhooks, account changes). */
export function invalidatePlan(db: Db, userId: string) {
  db.prepare('UPDATE users SET plan_checked_at = NULL WHERE id = ?').run(userId);
}

const RC_V2 = 'https://api.revenuecat.com/v2';
const ENTITLEMENT_KEYS_TTL_MS = 60 * 60 * 1000;
let entitlementKeys: { projectId: string; at: number; byId: Map<string, string> } | null = null;

/** Test hook: forget the cached entitlement id → lookup key map. */
export function resetEntitlementKeyCache() {
  entitlementKeys = null;
}

async function rcV2(config: Config, path: string) {
  return fetch(`${RC_V2}/projects/${encodeURIComponent(config.revenueCatProjectId!)}${path}`, {
    headers: { Authorization: `Bearer ${config.revenueCatSecret}` },
    signal: AbortSignal.timeout(5000),
  });
}

/** v2 reports entitlements by internal id (entl…); our plan map is keyed by lookup key. */
async function entitlementLookupKeys(config: Config): Promise<Map<string, string>> {
  const projectId = config.revenueCatProjectId!;
  if (entitlementKeys && entitlementKeys.projectId === projectId && Date.now() - entitlementKeys.at < ENTITLEMENT_KEYS_TTL_MS) {
    return entitlementKeys.byId;
  }
  const response = await rcV2(config, '/entitlements?limit=100');
  if (!response.ok) throw new Error(`RevenueCat entitlements ${response.status}`);
  const payload = (await response.json()) as { items?: { id: string; lookup_key: string }[] };
  const byId = new Map((payload.items ?? []).map((e) => [e.id, e.lookup_key]));
  entitlementKeys = { projectId, at: Date.now(), byId };
  return byId;
}

/** Highest plan among a v2 customer's active entitlements. RevenueCat already counts grace periods as active. */
export function planFromActiveEntitlements(
  items: { entitlement_id: string; expires_at?: number | null }[],
  lookupKeys: Map<string, string>,
  now = Date.now()
): PlanId {
  let plan: PlanId = 'free';
  for (const item of items) {
    if (item.expires_at != null && item.expires_at <= now) continue;
    const mapped = REVENUECAT_ENTITLEMENTS[lookupKeys.get(item.entitlement_id) ?? ''];
    if (mapped && RANK[mapped] > RANK[plan]) plan = mapped;
  }
  return plan;
}

async function fetchPlan(config: Config, userId: string): Promise<PlanId> {
  if (config.revenueCatProjectId) {
    const response = await rcV2(config, `/customers/${encodeURIComponent(userId)}/active_entitlements?limit=100`);
    // A customer RevenueCat has never seen (no purchase, never opened the paywall) is simply free.
    if (response.status === 404) return 'free';
    if (!response.ok) throw new Error(`RevenueCat ${response.status}`);
    const payload = (await response.json()) as { items?: { entitlement_id: string; expires_at?: number | null }[] };
    return planFromActiveEntitlements(payload.items ?? [], await entitlementLookupKeys(config));
  }
  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${config.revenueCatSecret}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`RevenueCat ${response.status}`);
  const payload = (await response.json()) as { subscriber?: RevenueCatSubscriber };
  return planFromSubscriber(payload.subscriber);
}

/**
 * The store is the source of truth. The mobile app logs into RevenueCat with
 * our user id, so the subscriber lookup needs no extra mapping.
 */
export async function resolvePlan(db: Db, config: Config, userId: string, force = false): Promise<PlanId> {
  if (!config.revenueCatSecret) return config.devPlanOverride ?? 'free';

  const user = db.prepare('SELECT plan, plan_checked_at FROM users WHERE id = ?').get(userId) as
    | { plan: string; plan_checked_at: string | null }
    | undefined;
  if (!user) return 'free';
  const cached = normalizePlanId(user.plan);
  const fresh = user.plan_checked_at && Date.now() - Date.parse(user.plan_checked_at) < RECHECK_MS;
  if (fresh && !force) return cached;

  try {
    const plan = await fetchPlan(config, userId);
    db.prepare('UPDATE users SET plan = ?, plan_checked_at = ? WHERE id = ?').run(plan, new Date().toISOString(), userId);
    return plan;
  } catch (error) {
    console.warn('[mirobe] RevenueCat lookup failed, keeping cached plan:', (error as Error).message);
    // Back off briefly so an outage does not add a 5 s lookup to every request.
    db.prepare('UPDATE users SET plan_checked_at = ? WHERE id = ?').run(
      new Date(Date.now() - RECHECK_MS + RETRY_AFTER_FAILURE_MS).toISOString(),
      userId
    );
    return cached;
  }
}
