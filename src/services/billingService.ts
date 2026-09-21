import { Capacitor } from '@capacitor/core';

export type PaidPlan = 'premium' | 'pro';
export type BillingPeriod = 'monthly' | 'annual';

const PACKAGE_IDS: Record<PaidPlan, Record<BillingPeriod, string>> = {
  premium: {
    monthly: 'mirobe_premium_monthly',
    annual: 'mirobe_premium_annual',
  },
  pro: {
    monthly: 'mirobe_pro_monthly',
    annual: 'mirobe_pro_annual',
  },
};

let configured = false;
let purchases: any = null;

function getApiKey(): string | null {
  if (typeof window === 'undefined' || Capacitor.getPlatform() === 'web') return null;
  const env = (import.meta as any).env || {};
  return Capacitor.getPlatform() === 'ios'
    ? env.VITE_REVENUECAT_IOS_API_KEY || null
    : env.VITE_REVENUECAT_ANDROID_API_KEY || null;
}

export function hasRevenueCatConfiguration(): boolean {
  return Boolean(getApiKey());
}

export async function configureRevenueCat(appUserId = 'local-demo'): Promise<boolean> {
  const apiKey = getApiKey();
  if (!apiKey) return false;
  try {
    const module = await import('@revenuecat/purchases-capacitor');
    purchases = module.Purchases;
    await purchases.configure({ apiKey, appUserID: appUserId });
    configured = true;
    return true;
  } catch (error) {
    console.warn('RevenueCat unavailable; keeping local entitlement fallback.', error);
    configured = false;
    return false;
  }
}

export async function getRevenueCatPlan(): Promise<'free' | PaidPlan | null> {
  if (!configured || !purchases) return null;
  try {
    const { customerInfo } = await purchases.getCustomerInfo();
    const active = Object.keys(customerInfo?.entitlements?.active || {});
    if (active.some((id) => id === 'mirobe_pro' || id === 'pro')) return 'pro';
    if (active.some((id) => id === 'mirobe_premium' || id === 'premium')) return 'premium';
  } catch (error) {
    console.warn('RevenueCat entitlement lookup failed.', error);
  }
  return 'free';
}

export async function purchaseSubscription(plan: PaidPlan, period: BillingPeriod): Promise<boolean> {
  if (!configured || !purchases) return false;
  try {
    const { current } = await purchases.getOfferings();
    const targetId = PACKAGE_IDS[plan][period];
    const availablePackages = current?.availablePackages || [];
    const selected = availablePackages.find((item: any) =>
      item.identifier === targetId || item?.storeProduct?.identifier === targetId
    );
    if (!selected) return false;
    await purchases.purchasePackage({ aPackage: selected });
    return (await getRevenueCatPlan()) === plan;
  } catch (error) {
    console.warn('Subscription purchase was not completed.', error);
    return false;
  }
}
