import { z } from 'zod';

export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** The APNs environment a token was issued for: development builds get sandbox tokens. */
export const PUSH_ENVIRONMENTS = ['production', 'sandbox'] as const;
export type PushEnvironment = (typeof PUSH_ENVIRONMENTS)[number];

/**
 * A device push token: the raw APNs token (hex) on iOS, the FCM token on Android.
 * `lang` is the app language, so pushes arrive in the language the device uses.
 */
export const PushTokenSchema = z
  .object({
    token: z.string().trim().min(16).max(512),
    platform: z.enum(PUSH_PLATFORMS),
    environment: z.enum(PUSH_ENVIRONMENTS),
    lang: z.enum(['tr', 'en']).default('tr'),
  })
  .refine((input) => (input.platform === 'ios' ? /^[0-9a-fA-F]{32,200}$/.test(input.token) : /^[\w:.-]+$/.test(input.token)), {
    message: 'Invalid push token',
    path: ['token'],
  });
export type PushTokenInput = z.infer<typeof PushTokenSchema>;

export const RemovePushTokenSchema = z.object({ token: z.string().trim().min(1).max(512) });

/** Per-account notification switches. The daily outfit reminder is scheduled on the device and not stored here. */
export const NotificationSettingsSchema = z.object({
  /** Payment received / payment failed notices. On by default. */
  subscription: z.boolean(),
});
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;
