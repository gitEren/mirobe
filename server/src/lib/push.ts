import crypto from 'node:crypto';
import { ANDROID_DEFAULT_CHANNEL, type NotificationSettings, type PushEnvironment, type PushPlatform, type PushTokenInput } from '@mirobe/shared';
import { transaction, type Db } from '../db/index';
import { isDeadToken, type PushSender } from './apns';
import { isDeadFcmToken, type FcmSender } from './fcm';

/** Tokens kept per user, most recently seen first (a reinstalled phone, a second device, …). */
const MAX_TOKENS_PER_USER = 10;

export type PushLang = 'tr' | 'en';

export interface PushTokenRow {
  id: string;
  token: string;
  platform: PushPlatform;
  environment: PushEnvironment;
  lang: PushLang;
}

/**
 * Registers a device token for the user. A token the server already knows moves to
 * this user: the device signed in to another account (or signed out into a new one).
 */
export function savePushToken(db: Db, userId: string, input: PushTokenInput) {
  const now = new Date().toISOString();
  // APNs tokens are hex; one spelling keeps the UNIQUE constraint meaningful.
  const token = input.platform === 'ios' ? input.token.toLowerCase() : input.token;
  transaction(db, () => {
    db.prepare(
      `INSERT INTO push_tokens (id, user_id, token, platform, environment, lang, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform,
         environment = excluded.environment, lang = excluded.lang, last_seen_at = excluded.last_seen_at`
    ).run(`pt_${crypto.randomUUID()}`, userId, token, input.platform, input.environment, input.lang, now, now);
    db.prepare(
      `DELETE FROM push_tokens WHERE user_id = ? AND id NOT IN (
         SELECT id FROM push_tokens WHERE user_id = ? ORDER BY last_seen_at DESC, created_at DESC LIMIT ?)`
    ).run(userId, userId, MAX_TOKENS_PER_USER);
  });
}

/** Removes the caller's own token (signing out). Returns how many rows went. */
export function removePushToken(db: Db, userId: string, token: string): number {
  const result = db.prepare('DELETE FROM push_tokens WHERE user_id = ? AND token IN (?, ?)').run(userId, token, token.toLowerCase());
  return Number(result.changes);
}

export function pushTokensOf(db: Db, userId: string): PushTokenRow[] {
  return db
    .prepare('SELECT id, token, platform, environment, lang FROM push_tokens WHERE user_id = ? ORDER BY last_seen_at DESC')
    .all(userId) as unknown as PushTokenRow[];
}

export function notificationSettings(db: Db, userId: string): NotificationSettings {
  const row = db.prepare('SELECT notify_subscription FROM users WHERE id = ?').get(userId) as { notify_subscription: number } | undefined;
  return { subscription: row ? row.notify_subscription === 1 : true };
}

export function setNotificationSettings(db: Db, userId: string, settings: NotificationSettings): NotificationSettings {
  db.prepare('UPDATE users SET notify_subscription = ? WHERE id = ?').run(settings.subscription ? 1 : 0, userId);
  return notificationSettings(db, userId);
}

export interface PushMessage {
  title: string;
  body: string;
  /** Deep link the app opens on tap (mirobe:///…). */
  url: string;
  /** What the app keys its foreground behaviour on (billing_issue, renewal, …). */
  kind: string;
  /** Notifications of one thread are grouped together on the device. */
  threadId?: string;
  /** Same id: a newer notification replaces the older one on the device. */
  collapseId?: string;
  ttlSeconds?: number;
}

const warnedUnconfigured = new Set<PushPlatform>();

function warnUnconfigured(platform: PushPlatform) {
  if (warnedUnconfigured.has(platform)) return;
  warnedUnconfigured.add(platform);
  console.warn(
    platform === 'ios'
      ? '[mirobe] push skipped: APNs is not configured (APNS_KEY_ID, APNS_KEY_BASE64)'
      : '[mirobe] push skipped: FCM is not configured (FCM_SERVICE_ACCOUNT_BASE64)'
  );
}

/**
 * Sends a message to all of the user's devices, each in its own language: iOS through APNs,
 * Android through FCM. Each iOS token goes through its own APNs environment (a development
 * build's token only works on the sandbox host). The store environment of the event does not
 * filter devices: TestFlight buys in the sandbox while its builds hold production tokens, and a
 * notice only ever reaches the buyer's own devices. Tokens reported dead are deleted (APNs 410
 * Unregistered / 400 BadDeviceToken, FCM 404 / UNREGISTERED / invalid token). A platform whose
 * sender is not configured is skipped (logged once). Never throws.
 */
export async function pushToUser(
  db: Db,
  sender: PushSender | null | undefined,
  userId: string,
  compose: (lang: PushLang) => PushMessage,
  fcm?: FcmSender | null
): Promise<{ sent: number; removed: number }> {
  const tokens = pushTokensOf(db, userId).filter((row) => {
    const configured = row.platform === 'ios' ? !!sender : row.platform === 'android' ? !!fcm : false;
    if (!configured) warnUnconfigured(row.platform);
    return configured;
  });
  let sent = 0;
  let removed = 0;
  await Promise.all(
    tokens.map(async (row) => {
      const message = compose(row.lang === 'en' ? 'en' : 'tr');
      let result: { status: number; reason?: string };
      let dead: boolean;
      if (row.platform === 'android') {
        const fcmResult = await fcm!
          .send({
            token: row.token,
            title: message.title,
            body: message.body,
            // expo-notifications exposes an FCM message's `data` map as `notification.request.content.data`.
            data: { kind: message.kind, url: message.url },
            collapseId: message.collapseId,
            ttlSeconds: message.ttlSeconds,
            // The app's "Mirobe" channel (also FCM's default in the manifest); the 'daily' channel belongs
            // to the on-device outfit reminder. An app build without the channel falls back as before.
            channelId: ANDROID_DEFAULT_CHANNEL,
          })
          .catch((error: Error) => ({ status: 0, reason: error.message }));
        result = fcmResult;
        dead = isDeadFcmToken(fcmResult);
      } else {
        const apnsResult = await sender!
          .send({
            token: row.token,
            environment: row.environment,
            collapseId: message.collapseId,
            ttlSeconds: message.ttlSeconds,
            payload: {
              aps: { alert: { title: message.title, body: message.body }, sound: 'default', 'thread-id': message.threadId ?? message.kind },
              // expo-notifications exposes a remote notification's `body` key as `notification.request.content.data`.
              body: { kind: message.kind, url: message.url },
            },
          })
          .catch((error: Error) => ({ status: 0, reason: error.message }));
        result = apnsResult;
        dead = isDeadToken(apnsResult);
      }
      if (result.status === 200) {
        sent += 1;
      } else if (dead) {
        removed += Number(db.prepare('DELETE FROM push_tokens WHERE id = ?').run(row.id).changes);
      } else {
        console.warn(`[mirobe] push to ${row.id} (${row.platform}) failed: ${result.status} ${result.reason ?? ''}`.trim());
      }
    })
  );
  return { sent, removed };
}
