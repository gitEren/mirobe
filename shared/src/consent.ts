import { z } from 'zod';

/**
 * Consent to AI processing (App Store 5.1.2(i)): garment photos, the mirror photo and
 * messages to Jev reach the third-party AI models only for an account that allowed it.
 * Every AI route answers 403 with this code otherwise, before any quota or provider work.
 */
export const AI_CONSENT_REQUIRED = 'AI_CONSENT_REQUIRED';

/** POST /api/me/ai-consent: true records the consent, false withdraws it. */
export const AiConsentSchema = z.object({ granted: z.boolean() });
export type AiConsentInput = z.infer<typeof AiConsentSchema>;

export interface AiConsentResponse {
  aiConsent: boolean;
}
