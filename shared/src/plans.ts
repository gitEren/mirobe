export const PLAN_IDS = ['free', 'plus', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Monthly allowances are counts: every action counts one, whatever it costs us. */
export interface PlanLimits {
  label: string;
  /** Static fallback prices. The paywall prefers the store-localized price from RevenueCat. */
  priceUsd: number;
  annualPriceUsd: number;
  priceTry: number;
  annualPriceTry: number;
  /** Images per month: each photo try-on and each AI studio packshot counts one. */
  images: number;
  /** 5 s motion clips per month, at any VIDEO_RESOLUTION. 0 = locked (Pro upsell). */
  videos: number;
  /** Jev turns per month: each outfit decision and each stylist chat message counts one. */
  stylist: number;
  /** AI garment taggings per month, shown on the paywall and in the profile. */
  taggings: number;
}

// TODO: one-off top-ups (extra images/videos as consumables) once store products exist.
export const PLANS: Record<PlanId, PlanLimits> = {
  free: { label: 'Free', priceUsd: 0, annualPriceUsd: 0, priceTry: 0, annualPriceTry: 0, images: 3, videos: 0, stylist: 30, taggings: 20 },
  plus: { label: 'Plus', priceUsd: 9.99, annualPriceUsd: 99.99, priceTry: 499.99, annualPriceTry: 4999.99, images: 100, videos: 0, stylist: 300, taggings: 200 },
  pro: { label: 'Pro', priceUsd: 19.99, annualPriceUsd: 199.99, priceTry: 1199.99, annualPriceTry: 11999.99, images: 200, videos: 8, stylist: 750, taggings: 450 },
};

/** Plan ids stored before the premium → plus rename. */
export function normalizePlanId(value: string | null | undefined): PlanId {
  if (value === 'premium') return 'plus';
  return (PLAN_IDS as readonly string[]).includes(value ?? '') ? (value as PlanId) : 'free';
}

/** The monthly buckets usage is counted in; each one is a PlanLimits field. */
export type UsageKind = 'images' | 'videos' | 'stylist' | 'taggings';

/** Motion clip render resolution (VIDEO_RESOLUTION). A clip counts as one video at either. */
export type VideoResolution = '480p' | '720p';

/** Longest live-mirror session, while the live mirror is switched on (see LIVE_MIRROR_ENABLED). */
export const LIVE_MAX_SESSION_SECONDS = 30;

export interface UsageCount {
  used: number;
  limit: number;
}

export interface UsageSnapshot {
  planId: PlanId;
  periodStart: string;
  images: UsageCount;
  videos: UsageCount;
  stylist: UsageCount;
  taggings: UsageCount;
}

/** RevenueCat store product ids (App Store and Play). */
export const REVENUECAT_PRODUCTS = {
  plus: { monthly: 'mirobe_plus_monthly', annual: 'mirobe_plus_annual' },
  pro: { monthly: 'mirobe_pro_monthly', annual: 'mirobe_pro_annual' },
} as const satisfies Record<Exclude<PlanId, 'free'>, { monthly: string; annual: string }>;

/** RevenueCat entitlement ids map to plans. Legacy premium ids stay mapped to Plus. */
export const REVENUECAT_ENTITLEMENTS: Record<string, PlanId> = {
  mirobe_pro: 'pro',
  pro: 'pro',
  mirobe_plus: 'plus',
  plus: 'plus',
  mirobe_premium: 'plus',
  premium: 'plus',
};
