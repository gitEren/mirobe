export const MIROBE_PLANS = {
  free: {
    id: 'free',
    priceUsd: 0,
    annualPriceUsd: 0,
    label: 'Free',
    photoTokens: 100,
    jevDecisions: 45,
    videoSeconds: 0,
  },
  premium: {
    id: 'mirobe_premium',
    priceUsd: 9.99,
    annualPriceUsd: 95.99,
    label: 'Premium',
    photoTokens: 1000,
    jevDecisions: 450,
    videoSeconds: 120,
  },
  pro: {
    id: 'mirobe_pro',
    priceUsd: 19.99,
    annualPriceUsd: 191.99,
    label: 'Pro',
    photoTokens: 2500,
    jevDecisions: 1200,
    videoSeconds: 360,
  },
} as const;

export const MIROBE_LIMITS = {
  freeJevDecisions: 45,
  freePhotoTokens: 100,
  freeVideoSeconds: 0,
  dailyJevDecisions: 45,
  monthlyAiMirrorSeconds: 120,
  maxAiMirrorSessionSeconds: 30,
  garmentPrepTokens: 10,
  photoTryOnTokens: 20,
} as const;

export interface EntitlementSnapshot {
  planId: keyof typeof MIROBE_PLANS;
  active: boolean;
  source: 'revenuecat' | 'storekit' | 'local-demo';
  photoTokens: number;
  jevDecisions: number;
  videoSeconds: number;
}

/**
 * StoreKit/Google Play/RevenueCat can replace this adapter without changing
 * Mirror or Jev. Until a store entitlement is configured, local demo limits
 * keep the app usable and never unlock an untracked paid session.
 */
export function getLocalEntitlement(): EntitlementSnapshot {
  let planId: keyof typeof MIROBE_PLANS = 'free';
  if (typeof window !== 'undefined') {
    const storedPlan = window.localStorage.getItem('mirobe_plan');
    if (storedPlan === 'premium' || storedPlan === 'pro') planId = storedPlan;
  }
  const plan = MIROBE_PLANS[planId];
  return {
    planId,
    active: false,
    source: 'local-demo',
    photoTokens: plan.photoTokens,
    jevDecisions: plan.jevDecisions,
    videoSeconds: plan.videoSeconds,
  };
}

export type UsageKind = 'garment_prep' | 'photo_try_on' | 'jev_decision' | 'video_seconds';

export const PLAN_COPY = {
  free: '100 fotoğraf tokenı · 45 Jev kombini · video yok',
  premium: '1000 fotoğraf tokenı · 450 Jev kombini · 120 sn video',
  pro: '2500 fotoğraf tokenı · 1200 Jev kombini · 360 sn video',
} as const;
