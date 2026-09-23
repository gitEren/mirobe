import path from 'node:path';
import { normalizePlanId, type PlanId, type VideoResolution } from '@mirobe/shared';

const env = process.env;

export interface Config {
  port: number;
  dataDir: string;
  isProduction: boolean;
  appUrl: string;
  openRouterKey?: string;
  /** Overridable for tests. */
  openRouterBase: string;
  visionModel: string;
  textModel: string;
  /** Fast conversational model around Jev (understanding + stylist replies). */
  chatModel: string;
  /** Packshot renderer. */
  imageModel: string;
  /** Photo try-on renderer (Gemini via chat, or an Images API editor such as Seedream). */
  tryonModel: string;
  jevModel: string;
  falKey?: string;
  videoProvider: 'openrouter' | 'fal';
  /** OpenRouter video model (or fal endpoint when videoProvider is 'fal'). */
  videoModel: string;
  videoResolution: VideoResolution;
  /** Live mirror switch (LIVE_MIRROR_ENABLED). Off: every /api/live route answers 404 FEATURE_DISABLED. */
  liveMirrorEnabled: boolean;
  liveApp: string;
  revenueCatSecret?: string;
  /** Set for RevenueCat API v2 secret keys (they are project scoped); unset means a legacy v1 key. */
  revenueCatProjectId?: string;
  /** Exact Authorization header value RevenueCat sends with every webhook. */
  revenueCatWebhookAuth?: string;
  /** Local testing only: forces a paid plan when RevenueCat is not configured. */
  devPlanOverride?: PlanId;
  /** Login/register attempts allowed per client IP and per email in each window. */
  authRateLimit: number;
  authRateWindowMs: number;
  /** APNs token auth. Push notifications are off while the key or its id is missing. */
  apnsKeyId?: string;
  apnsTeamId: string;
  /** The .p8 key, base64 encoded on one line (a PEM with literal \n escapes is accepted too). */
  apnsKey?: string;
  /** apns-topic: the app's bundle id. */
  apnsTopic: string;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  // "premium" is the legacy name of Plus.
  const devPlan = env.DEV_PLAN_OVERRIDE ? normalizePlanId(env.DEV_PLAN_OVERRIDE) : 'free';
  return {
    port: Number(env.PORT || 3000),
    dataDir: path.resolve(env.DATA_DIR || path.join(import.meta.dirname, '..', 'data')),
    isProduction: env.NODE_ENV === 'production',
    appUrl: env.APP_URL || 'http://localhost:3000',
    openRouterKey: env.OPENROUTER_API_KEY || undefined,
    openRouterBase: env.OPENROUTER_BASE_URL || 'https://openrouter.ai',
    visionModel: env.OPENROUTER_VISION_MODEL || 'google/gemini-3.1-flash-lite',
    textModel: env.OPENROUTER_TEXT_MODEL || 'google/gemini-2.5-flash',
    chatModel: env.OPENROUTER_CHAT_MODEL || 'google/gemini-3.1-flash-lite',
    imageModel: env.OPENROUTER_IMAGE_MODEL || 'google/gemini-3.1-flash-lite-image',
    tryonModel: env.OPENROUTER_TRYON_MODEL || env.OPENROUTER_IMAGE_MODEL || 'google/gemini-3.1-flash-lite-image',
    jevModel: env.JEV_MODEL && env.JEV_MODEL !== 'typesafe/jev' ? env.JEV_MODEL : 'typesafe/jev-1.13',
    falKey: env.FAL_KEY || undefined,
    videoProvider: env.VIDEO_PROVIDER === 'fal' ? 'fal' : 'openrouter',
    videoModel:
      env.VIDEO_PROVIDER === 'fal'
        ? env.FAL_VIDEO_MODEL || 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video'
        : env.OPENROUTER_VIDEO_MODEL || 'bytedance/seedance-1-5-pro',
    videoResolution: env.VIDEO_RESOLUTION === '720p' ? '720p' : '480p',
    liveMirrorEnabled: env.LIVE_MIRROR_ENABLED === 'true' || env.LIVE_MIRROR_ENABLED === '1',
    liveApp: 'decart/lucy2-vton/realtime',
    revenueCatSecret: env.REVENUECAT_SECRET_KEY || undefined,
    revenueCatProjectId: env.REVENUECAT_PROJECT_ID || undefined,
    revenueCatWebhookAuth: env.REVENUECAT_WEBHOOK_AUTH || undefined,
    devPlanOverride: env.NODE_ENV !== 'production' && devPlan !== 'free' ? devPlan : undefined,
    authRateLimit: Number(env.AUTH_RATE_LIMIT) || 10,
    authRateWindowMs: 15 * 60 * 1000,
    apnsKeyId: env.APNS_KEY_ID || undefined,
    apnsTeamId: env.APNS_TEAM_ID || 'F293R6XW2Y',
    apnsKey: env.APNS_KEY_BASE64 || undefined,
    apnsTopic: env.APNS_TOPIC || 'com.orbexastudio.mirobe',
    ...overrides,
  };
}
