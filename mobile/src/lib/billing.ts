import { Linking, Platform } from 'react-native';
import { getLocales } from 'expo-localization';
import Purchases, { LOG_LEVEL, type CustomerInfo, type PurchasesPackage, type StoreProductChangeInfo } from 'react-native-purchases';
import { PLANS, REVENUECAT_ENTITLEMENTS, REVENUECAT_PRODUCTS, type PlanId } from '@mirobe/shared';
import { api, ApiError } from './api';
import { getState, refreshUsage, requireAccount } from './store';

export type PaidPlanId = Exclude<PlanId, 'free'>;
export type BillingPeriod = 'monthly' | 'annual';
export type StorePackages = Partial<Record<PaidPlanId, Partial<Record<BillingPeriod, PurchasesPackage>>>>;

const apiKey = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
export const billingAvailable = Boolean(apiKey);

// ---------------------------------------------------------------------------
// Legal links shown on the paywall (required by App Store review guideline 3.1.2).
// Served under /api: the Cloudflare rule in front of the server only passes /api paths.
// ---------------------------------------------------------------------------
const LEGAL_ORIGIN = 'https://mirobe.orbexastudio.com.tr';
export const PRIVACY_URL = `${LEGAL_ORIGIN}/api/legal/privacy`;
export const TERMS_URL = `${LEGAL_ORIGIN}/api/legal/terms`;
export const APPLE_EULA_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
/** "Terms of Use (EULA)": Apple's standard EULA on iOS, our terms on Android. */
export const TERMS_OF_USE_URL = Platform.OS === 'ios' ? APPLE_EULA_URL : TERMS_URL;

const ANDROID_PACKAGE = 'com.orbexastudio.mirobe';
const RANK: Record<PlanId, number> = { free: 0, plus: 1, pro: 2 };

// ---------------------------------------------------------------------------
// Identity: the RevenueCat app user id is our server user id, so the server can
// look the subscriber up (and webhooks name our users). Every identity change runs
// through one queue so a quick sign-out/sign-in cannot interleave logIn/logOut.
// ---------------------------------------------------------------------------
let configured = false;
/** The app user id RevenueCat is logged in as; null while logged out (RevenueCat anonymous). */
let identity: string | null = null;
let queue: Promise<unknown> = Promise.resolve();
/** Active entitlement ids last seen, so the listener only syncs the server on a real change. */
let lastEntitlements: string | null = null;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

const activeEntitlementKey = (info: CustomerInfo) => Object.keys(info.entitlements.active).sort().join(',');

function onCustomerInfo(info: CustomerInfo) {
  const key = activeEntitlementKey(info);
  const changed = lastEntitlements !== null && key !== lastEntitlements;
  lastEntitlements = key;
  // A renewal, expiry or an approved Ask to Buy while the app is open: let the server re-read it.
  if (changed && !getState().isAnonymous) void syncPlan();
}

/** Signs RevenueCat in as `userId` (configures the SDK on first use). Idempotent. */
export function billingLogIn(userId: string): Promise<void> {
  if (!apiKey) return Promise.resolve();
  return enqueue(async () => {
    if (!configured) {
      if (__DEV__) void Purchases.setLogLevel(LOG_LEVEL.INFO);
      Purchases.configure({ apiKey, appUserID: userId });
      Purchases.addCustomerInfoUpdateListener(onCustomerInfo);
      configured = true;
      identity = userId;
      return;
    }
    if (identity === userId) return;
    await Purchases.logIn(userId);
    identity = userId;
    lastEntitlements = null;
  });
}

/** Detaches this device from the signed-in customer (sign-out, account deletion). Idempotent. */
export function billingLogOut(): Promise<void> {
  if (!apiKey || !configured) return Promise.resolve();
  return enqueue(async () => {
    if (identity === null) return;
    // Whatever happens, the next billingLogIn must switch users explicitly.
    identity = null;
    lastEntitlements = null;
    await Purchases.logOut().catch(() => undefined); // already anonymous, or offline
  });
}

/**
 * Follows the store's userId (the root layout calls this on every change): a user id
 * logs RevenueCat in, null (signed out / account deleted) logs it out.
 */
export function configureBilling(userId: string | null) {
  const task = userId ? billingLogIn(userId) : billingLogOut();
  task.catch((error) => console.warn('[mirobe] billing identity:', (error as Error)?.message));
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export type BillingErrorKind = 'not_configured' | 'network' | 'already_owned' | 'not_allowed' | 'unavailable' | 'unknown';

export function billingErrorKind(error: unknown): BillingErrorKind | 'cancelled' | 'pending' {
  const C = Purchases.PURCHASES_ERROR_CODE;
  const e = error as { code?: string; userCancelled?: boolean | null } | undefined;
  switch (e?.code) {
    case C.PURCHASE_CANCELLED_ERROR:
      return 'cancelled';
    case C.PAYMENT_PENDING_ERROR:
      return 'pending';
    case C.PRODUCT_ALREADY_PURCHASED_ERROR:
    case C.RECEIPT_ALREADY_IN_USE_ERROR:
    case C.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR:
      return 'already_owned';
    case C.NETWORK_ERROR:
    case C.OFFLINE_CONNECTION_ERROR:
    case C.PRODUCT_REQUEST_TIMED_OUT_ERROR:
    case C.API_ENDPOINT_BLOCKED:
      return 'network';
    case C.PURCHASE_NOT_ALLOWED_ERROR:
    case C.INSUFFICIENT_PERMISSIONS_ERROR:
      return 'not_allowed';
    case C.CONFIGURATION_ERROR:
    case C.INVALID_CREDENTIALS_ERROR:
    case C.INVALID_APPLE_SUBSCRIPTION_KEY_ERROR:
    case C.UNSUPPORTED_ERROR:
      return 'not_configured';
    case C.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR:
    case C.STORE_PROBLEM_ERROR:
    case C.PURCHASE_INVALID_ERROR:
    case C.INELIGIBLE_ERROR:
      return 'unavailable';
  }
  if (e?.userCancelled) return 'cancelled';
  if (error instanceof ApiError && error.isNetwork) return 'network';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------
const productPlan = (productId: string): { plan: PaidPlanId; period: BillingPeriod } | null => {
  // Play reports subscriptions as "productId:basePlanId".
  const id = productId.split(':')[0];
  for (const plan of Object.keys(REVENUECAT_PRODUCTS) as PaidPlanId[]) {
    for (const period of ['monthly', 'annual'] as const) {
      if (REVENUECAT_PRODUCTS[plan][period] === id) return { plan, period };
    }
  }
  return null;
};

/**
 * Store packages keyed by plan and period, matched by product id so the offering
 * layout in RevenueCat does not matter. Prices come localized from the storefront.
 * Throws the SDK error (see billingErrorKind) when the store cannot be reached or
 * the products are not set up.
 */
export async function loadPackages(): Promise<StorePackages> {
  await queue;
  if (!configured) return {};
  const offerings = await Purchases.getOfferings();
  const all = [...(offerings.current?.availablePackages ?? []), ...Object.values(offerings.all).flatMap((o) => o.availablePackages)];
  const found: StorePackages = {};
  for (const pkg of all) {
    const match = productPlan(pkg.product.identifier);
    if (match) found[match.plan] = { [match.period]: pkg, ...found[match.plan] };
  }
  return found;
}

/** Static fallback when the store is unavailable: TRY for a Turkish device region, USD elsewhere. */
export function fallbackAmount(plan: PlanId, period: BillingPeriod): { amount: number; currency: 'TRY' | 'USD' } {
  const limits = PLANS[plan];
  return getLocales()[0]?.regionCode === 'TR'
    ? { amount: period === 'annual' ? limits.annualPriceTry : limits.priceTry, currency: 'TRY' }
    : { amount: period === 'annual' ? limits.annualPriceUsd : limits.priceUsd, currency: 'USD' };
}

function formatAmount(amount: number, currency: 'TRY' | 'USD'): string {
  const [whole, cents] = amount.toFixed(2).split('.');
  return currency === 'TRY' ? `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents} TL` : `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

export function fallbackPrice(plan: PlanId, period: BillingPeriod): string {
  const { amount, currency } = fallbackAmount(plan, period);
  return formatAmount(amount, currency);
}

/** What the annual fallback price comes to per month, for the paywall's secondary price line. */
export function fallbackMonthlyEquivalent(plan: PlanId): string {
  const { amount, currency } = fallbackAmount(plan, 'annual');
  return formatAmount(Math.floor((amount / 12) * 100) / 100, currency);
}

// ---------------------------------------------------------------------------
// Current subscription (from the store, for this device's platform)
// ---------------------------------------------------------------------------
export interface StoreSubscription {
  productId: string;
  plan: PaidPlanId;
  period: BillingPeriod;
  /** Bought through this platform's store (the only one this app can change or manage). */
  thisStore: boolean;
  willRenew: boolean;
}

const THIS_STORE = Platform.OS === 'ios' ? 'APP_STORE' : 'PLAY_STORE';

/** The highest active Mirobe subscription on the RevenueCat customer, if any. */
function subscriptionFrom(info: CustomerInfo): StoreSubscription | null {
  let best: StoreSubscription | null = null;
  for (const [key, entitlement] of Object.entries(info.entitlements.active)) {
    if (!REVENUECAT_ENTITLEMENTS[key]) continue;
    const match = productPlan(entitlement.productIdentifier);
    if (!match) continue;
    const candidate: StoreSubscription = {
      productId: entitlement.productIdentifier.split(':')[0],
      ...match,
      thisStore: entitlement.store === THIS_STORE,
      willRenew: entitlement.willRenew,
    };
    const better =
      !best || RANK[candidate.plan] > RANK[best.plan] || (candidate.plan === best.plan && candidate.period === 'annual' && best.period === 'monthly');
    if (better) best = candidate;
  }
  return best;
}

export async function currentSubscription(): Promise<StoreSubscription | null> {
  await queue;
  if (!configured || getState().isAnonymous) return null;
  return subscriptionFrom(await Purchases.getCustomerInfo());
}

// ---------------------------------------------------------------------------
// Purchase, restore, manage
// ---------------------------------------------------------------------------

/** Asks the server to re-read the plan from RevenueCat, then refreshes usage. Returns the plan it reports. */
async function syncPlan(): Promise<PlanId | null> {
  try {
    await api.billingSync();
    await refreshUsage();
  } catch {
    await refreshUsage(true);
  }
  return getState().usage?.planId ?? null;
}

/** Makes sure RevenueCat is signed in as the current registered account before touching the store. */
async function ensureIdentity(): Promise<void> {
  const { userId } = getState();
  if (!userId) throw new ApiError(0, 'No session yet', 'NETWORK');
  await billingLogIn(userId);
}

export type PurchaseResult =
  | { status: 'purchased'; plan: PlanId | null; deferred: boolean }
  | { status: 'cancelled' | 'pending' | 'needs_account' }
  | { status: 'error'; error: BillingErrorKind };

const failure = (error: unknown): PurchaseResult => {
  const kind = billingErrorKind(error);
  if (kind === 'cancelled' || kind === 'pending') return { status: kind };
  return { status: 'error', error: kind };
};

/** Changing plans on Play needs the old product and how to prorate: upgrades now (time-prorated), downgrades at renewal. */
function playChange(from: StoreSubscription | null, to: { plan: PaidPlanId; period: BillingPeriod }): StoreProductChangeInfo | null {
  if (Platform.OS !== 'android' || !from || !from.thisStore) return null;
  if (from.plan === to.plan && from.period === to.period) return null;
  const upgrade = RANK[to.plan] > RANK[from.plan] || (to.plan === from.plan && to.period === 'annual');
  return {
    oldProductIdentifier: from.productId,
    replacementMode: upgrade ? Purchases.STORE_REPLACEMENT_MODE.WITH_TIME_PRORATION : Purchases.STORE_REPLACEMENT_MODE.DEFERRED,
  };
}

/**
 * Buys a package for the signed-in account. Anonymous users are sent to sign in
 * first (and come back to the paywall). Never throws: the result says what happened.
 * On iOS a plan change inside the "Mirobe" subscription group is handled by the
 * App Store (upgrade now, downgrade at renewal).
 */
export async function purchase(pkg: PurchasesPackage): Promise<PurchaseResult> {
  if (!apiKey) return { status: 'error', error: 'not_configured' };
  if (!requireAccount('/paywall')) return { status: 'needs_account' };
  const target = productPlan(pkg.product.identifier);
  try {
    await ensureIdentity();
    const from = target ? subscriptionFrom(await Purchases.getCustomerInfo()) : null;
    const change = target ? playChange(from, target) : null;
    await Purchases.purchasePackage(pkg, null, change);
    const deferred = Boolean(target && from && RANK[target.plan] < RANK[from.plan]);
    return { status: 'purchased', plan: await syncPlan(), deferred };
  } catch (error) {
    return failure(error);
  }
}

export type RestoreResult = { status: 'restored' | 'nothing' | 'needs_account' } | { status: 'error'; error: BillingErrorKind };

/** "Restore purchases" (required by App Store review). Attaches this store account's subscription to the signed-in user. */
export async function restore(): Promise<RestoreResult> {
  if (!apiKey) return { status: 'error', error: 'not_configured' };
  if (!requireAccount('/paywall')) return { status: 'needs_account' };
  try {
    await ensureIdentity();
    const info = await Purchases.restorePurchases();
    await syncPlan();
    return { status: subscriptionFrom(info) ? 'restored' : 'nothing' };
  } catch (error) {
    const kind = billingErrorKind(error);
    return { status: 'error', error: kind === 'cancelled' || kind === 'pending' ? 'unknown' : kind };
  }
}

/** Opens the store's subscription management: the App Store sheet on iOS, Play's subscriptions page on Android. */
export async function manageSubscription(): Promise<void> {
  if (Platform.OS === 'ios') {
    try {
      await queue;
      if (configured) return await Purchases.showManageSubscriptions();
    } catch {
      // Fall through to the App Store page.
    }
    await Linking.openURL('https://apps.apple.com/account/subscriptions');
    return;
  }
  const current = await currentSubscription().catch(() => null);
  const sku = current?.thisStore ? `sku=${encodeURIComponent(current.productId)}&` : '';
  await Linking.openURL(`https://play.google.com/store/account/subscriptions?${sku}package=${ANDROID_PACKAGE}`);
}
