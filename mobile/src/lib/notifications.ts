import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { router, type Href } from 'expo-router';
import type * as ExpoNotifications from 'expo-notifications';
import type { PushEnvironment } from '@mirobe/shared';
import { api } from './api';
import { dictionaries } from './i18n';
import { localDb } from './localDb';
import { buildDailyReminders, REMINDER_HOUR, REMINDER_ID_PREFIX } from './reminders';
import { getState, refreshUsage, setAccountExitHandler } from './store';

type Notifications = typeof ExpoNotifications;

/**
 * expo-notifications is native code that older dev builds do not contain, so it is never
 * imported at the top level: it is required on first use, and only when its native side
 * is in the binary. Without it every function here does nothing and the profile hides
 * the notification settings.
 */
export const notificationsAvailable = Platform.OS !== 'web' && requireOptionalNativeModule('ExpoPushTokenManager') !== null;

let loaded: Notifications | null | undefined;

function native(): Notifications | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  if (!notificationsAvailable) return null;
  try {
    // Inside try, Metro bundles it as an optional dependency; it is evaluated only here.
    loaded = require('expo-notifications') as Notifications;
  } catch (error) {
    console.warn('[mirobe] notifications unavailable:', (error as Error).message);
  }
  return loaded;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

export interface NotificationState {
  /** False until the OS permission was read once at start. */
  ready: boolean;
  permission: NotificationPermission;
  /** This device's switch for the daily 15:00 reminder (on by default). */
  daily: boolean;
  /** The account's switch for payment notices, kept on the server; null until loaded. */
  subscription: boolean | null;
}

let state: NotificationState = { ready: false, permission: 'undetermined', daily: true, subscription: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<NotificationState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

/** `selector` must return existing state or a primitive (see useStore). */
export function useNotificationState<T>(selector: (s: NotificationState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => selector(state)
  );
}

const DAILY_KEY = 'notif.daily';
/** "count|ISO date" of the in-app explanation shown before the system prompt. */
const ASKED_KEY = 'notif.asked';
const DAILY_CHANNEL = 'daily';
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Payment notices sent by the server (see server/src/lib/subscriptionNotices.ts). Servers
 * before in-app notices also push `uncancellation` (auto-renew switched back on).
 */
const SUBSCRIPTION_KINDS = new Set(['purchase', 'renewal', 'upgrade', 'uncancellation', 'billing_issue']);
/** The APNs environment of this build's token: development builds are signed for the sandbox. */
const PUSH_ENVIRONMENT: PushEnvironment = __DEV__ ? 'sandbox' : 'production';

/** Local switches live in the device database, which a sign-out clears: read them again for the new session. */
export function reloadLocalPreferences() {
  setState({ daily: localDb.getKv(DAILY_KEY) !== '0', subscription: null });
}

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

function toPermission(response: { granted: boolean; status: string }): NotificationPermission {
  if (response.granted) return 'granted';
  return response.status === 'undetermined' ? 'undetermined' : 'denied';
}

/** Reads the OS permission (it may have changed in Settings while the app was away). */
export async function refreshPermission(): Promise<NotificationPermission> {
  const N = native();
  if (!N) return 'denied';
  try {
    const permission = toPermission(await N.getPermissionsAsync());
    if (permission !== state.permission || !state.ready) setState({ permission, ready: true });
    return permission;
  } catch {
    if (!state.ready) setState({ ready: true });
    return state.permission;
  }
}

async function ensureAndroidChannel(N: Notifications) {
  if (Platform.OS !== 'android') return;
  await N.setNotificationChannelAsync(DAILY_CHANNEL, {
    name: dictionaries[getState().lang].notifications.channelDaily,
    importance: N.AndroidImportance.DEFAULT,
  }).catch(() => undefined);
}

/**
 * Shows the system prompt when it has not been answered yet; after that iOS only reports
 * the stored answer. Always called from a user action (the in-app explanation or a switch).
 */
export async function requestPermission(): Promise<NotificationPermission> {
  const N = native();
  if (!N) return 'denied';
  await ensureAndroidChannel(N);
  try {
    const permission = toPermission(await N.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }));
    setState({ permission, ready: true });
    if (permission === 'granted') {
      void registerDevice();
      scheduleReminders();
    }
    return permission;
  } catch (error) {
    console.warn('[mirobe] notification permission:', (error as Error).message);
    return state.permission;
  }
}

// ---------------------------------------------------------------------------
// In-app explanation before the system prompt (App Store guideline 4.5.4)
// ---------------------------------------------------------------------------

/** Whether the explanation may be offered now: never once the system prompt was answered, at most twice, two weeks apart. */
export function softAskDue(now = Date.now()): boolean {
  if (!notificationsAvailable || !state.ready || state.permission !== 'undetermined') return false;
  const [count, at] = (localDb.getKv(ASKED_KEY) ?? '').split('|');
  const times = Number(count) || 0;
  if (times === 0) return true;
  return times < 2 && now - (Date.parse(at) || 0) > 14 * DAY_MS;
}

export function noteSoftAskShown() {
  const times = (Number((localDb.getKv(ASKED_KEY) ?? '').split('|')[0]) || 0) + 1;
  localDb.setKv(ASKED_KEY, `${times}|${new Date().toISOString()}`);
}

// ---------------------------------------------------------------------------
// Device token (native APNs token on iOS) → server, for the payment notices
// ---------------------------------------------------------------------------

/** One job at a time per queue: native scheduling and registration calls must not interleave. */
function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return (job: () => Promise<void>) => {
    const next = tail.then(job, job);
    tail = next.catch(() => undefined);
    return next;
  };
}
const registrationQueue = serial();
const reminderQueue = serial();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** The last token the server accepted, and for which session and language. */
let registered: { key: string; token: string } | null = null;

async function deviceToken(N: Notifications, timeoutMs: number): Promise<string | null> {
  const token = await withTimeout(N.getDevicePushTokenAsync(), timeoutMs);
  return typeof token.data === 'string' && token.data ? token.data : null;
}

/**
 * Sends this device's native push token to the server for the current session, in the
 * app language. Runs at launch, after signing in or out, on a language change and when
 * the OS rotates the token; the server moves a known token to whoever registers it.
 */
export function registerDevice(force = false): Promise<void> {
  return registrationQueue(async () => {
    const N = native();
    const { userId, lang } = getState();
    if (!N || !userId || state.permission !== 'granted') return;
    try {
      const token = await deviceToken(N, 15_000);
      if (!token) return;
      const key = [userId, token, lang, PUSH_ENVIRONMENT].join('|');
      if (!force && registered?.key === key) return;
      await api.registerPushToken({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android', environment: PUSH_ENVIRONMENT, lang });
      // Only if the session did not change while the request was out.
      if (getState().userId === userId) registered = { key, token };
    } catch (error) {
      console.warn('[mirobe] push token registration:', (error as Error).message);
    }
  });
}

// ---------------------------------------------------------------------------
// Account switches
// ---------------------------------------------------------------------------

/** Loads the account's payment-notice switch (registered accounts; the default is on). */
export async function loadNotificationSettings() {
  const { userId } = getState();
  try {
    const settings = await api.notificationSettings();
    if (getState().userId === userId) setState({ subscription: settings.subscription });
  } catch {
    // Older server or offline: the switch shows its default until the next launch.
  }
}

/** Turns the daily reminder on (asking for permission if needed) or off. Returns the permission it ended with. */
export async function setDailyReminder(enabled: boolean): Promise<NotificationPermission> {
  if (enabled && state.permission !== 'granted') {
    const permission = await requestPermission();
    if (permission !== 'granted') return permission;
  }
  localDb.setKv(DAILY_KEY, enabled ? '1' : '0');
  setState({ daily: enabled });
  scheduleReminders();
  return 'granted';
}

/** Turns payment notices on (asking for permission if needed) or off, on the server. 'failed': not saved. */
export async function setSubscriptionNotices(enabled: boolean): Promise<NotificationPermission | 'failed'> {
  if (enabled && state.permission !== 'granted') {
    const permission = await requestPermission();
    if (permission !== 'granted') return permission;
  }
  const previous = state.subscription;
  setState({ subscription: enabled });
  try {
    const saved = await api.setNotificationSettings({ subscription: enabled });
    setState({ subscription: saved.subscription });
    return 'granted';
  } catch {
    setState({ subscription: previous });
    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// Daily 15:00 reminder: local notifications, so it is 15:00 wherever the phone is
// ---------------------------------------------------------------------------

/** Signed-in accounts only: the reminder leads to Jev, which needs an account. */
function remindersWanted() {
  return state.ready && state.permission === 'granted' && state.daily && !getState().isAnonymous;
}

async function scheduledReminderIds(N: Notifications): Promise<string[]> {
  const scheduled = await N.getAllScheduledNotificationsAsync();
  return scheduled.map((request) => request.identifier).filter((id) => id.startsWith(REMINDER_ID_PREFIX));
}

async function syncReminders() {
  const N = native();
  if (!N || !state.ready) return;
  try {
    const existing = await scheduledReminderIds(N);
    if (!remindersWanted()) {
      await Promise.all(existing.map((id) => N.cancelScheduledNotificationAsync(id)));
      return;
    }
    const { garments, lang } = getState();
    const reminders = buildDailyReminders({ now: new Date(), garments, lang, strings: dictionaries[lang].reminders });
    const keep = new Set(reminders.map((reminder) => reminder.id));
    // Today's reminder (the app is open, so today is covered) and anything past the window go.
    await Promise.all(existing.filter((id) => !keep.has(id)).map((id) => N.cancelScheduledNotificationAsync(id)));
    await ensureAndroidChannel(N);
    for (const reminder of reminders) {
      // The same identifier replaces the pending one. On iOS a calendar trigger without a
      // time zone follows the phone: 15:00 local time even after travelling.
      await N.scheduleNotificationAsync({
        identifier: reminder.id,
        content: { title: reminder.title, body: reminder.body, data: { kind: 'daily', url: reminder.url }, sound: 'default' },
        trigger:
          Platform.OS === 'ios'
            ? {
                type: N.SchedulableTriggerInputTypes.CALENDAR,
                year: reminder.year,
                month: reminder.month,
                day: reminder.day,
                hour: REMINDER_HOUR,
                minute: 0,
                repeats: false,
              }
            : { type: N.SchedulableTriggerInputTypes.DATE, date: reminder.date, channelId: DAILY_CHANNEL },
      });
    }
  } catch (error) {
    console.warn('[mirobe] daily reminders:', (error as Error).message);
  }
}

let reminderTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Re-plans the next two weeks of reminders (debounced): at launch and on returning to the
 * app (which also drops today's), and when the wardrobe, language, account or switches change.
 */
export function scheduleReminders(delayMs = 800) {
  if (!notificationsAvailable) return;
  if (reminderTimer) clearTimeout(reminderTimer);
  reminderTimer = setTimeout(() => {
    reminderTimer = null;
    void reminderQueue(syncReminders);
  }, delayMs);
}

async function cancelReminders() {
  const N = native();
  if (!N) return;
  if (reminderTimer) clearTimeout(reminderTimer);
  reminderTimer = null;
  await reminderQueue(async () => {
    const ids = await scheduledReminderIds(N).catch(() => [] as string[]);
    await Promise.all(ids.map((id) => N.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  });
}

// ---------------------------------------------------------------------------
// Opening a notification
// ---------------------------------------------------------------------------

/** Screens a notification may open; anything else in a payload is ignored. */
const LINK_PATHS = new Set(['', 'stylist', 'paywall', 'profile', 'wardrobe', 'looks']);
const TAB_PATHS = new Set(['', 'profile', 'wardrobe', 'looks']);

/** mirobe:///stylist?prefill=… → "/stylist?prefill=…"; null for anything outside LINK_PATHS. */
export function notificationHref(url: string): string | null {
  const match = /^mirobe:\/\/\/?([^?#]*)(\?[^#]*)?$/.exec(url.trim());
  if (!match) return null;
  const path = match[1].replace(/^\/+|\/+$/g, '');
  if (!LINK_PATHS.has(path)) return null;
  return `/${path}${match[2] ?? ''}`;
}

/** A tap can arrive (cold start) before the navigator is mounted; it waits here until then. */
let navigationReady = false;
let pendingLink: string | null = null;

function openLink(url: string) {
  const href = notificationHref(url);
  if (!href) return;
  if (!navigationReady) {
    pendingLink = url;
    return;
  }
  const path = href.slice(1).split('?')[0];
  if (TAB_PATHS.has(path)) {
    // A tab: close whatever is open over the tabs first.
    if (router.canDismiss()) router.dismissAll();
    router.navigate(href as Href);
  } else {
    router.push(href as Href);
  }
}

type Payload = { kind?: string; url?: string };

/** Our keys: `data` of a local notification; a remote one's `body` key (see server pushToUser). */
function payloadOf(notification: ExpoNotifications.Notification): Payload {
  const content = notification.request.content.data as Record<string, unknown> | null | undefined;
  const trigger = notification.request.trigger as { payload?: { body?: Record<string, unknown> } } | null;
  const data = content && Object.keys(content).length > 0 ? content : (trigger?.payload?.body ?? {});
  return { kind: typeof data.kind === 'string' ? data.kind : undefined, url: typeof data.url === 'string' ? data.url : undefined };
}

const handledResponses = new Set<string>();

/** A tap on any of our notifications, local or remote. The launch tap may arrive twice (listener and last response). */
function handleResponse(response: ExpoNotifications.NotificationResponse) {
  const key = `${response.notification.request.identifier}:${response.notification.date}`;
  if (handledResponses.has(key)) return;
  handledResponses.add(key);
  try {
    native()?.clearLastNotificationResponse();
  } catch {
    // Not on this platform.
  }
  const { kind, url } = payloadOf(response.notification);
  if (kind && SUBSCRIPTION_KINDS.has(kind)) void refreshUsage(true);
  if (url) openLink(url);
}

/** Called by the root layout once the navigator is mounted: opens a tap that arrived before it. */
export function notificationsNavigationReady() {
  navigationReady = true;
  const link = pendingLink;
  pendingLink = null;
  if (link) openLink(link);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/**
 * Installs the foreground handler and listeners and reads the permission. Called once by
 * the root layout; returns the cleanup. The daily reminder stays silent while the app is
 * open; a successful payment only goes to Notification Center (the app already shows it);
 * a failed one is shown as a banner.
 */
export function startNotifications(): () => void {
  const N = native();
  if (!N) return () => undefined;
  reloadLocalPreferences();
  N.setNotificationHandler({
    handleNotification: async (notification) => {
      const { kind } = payloadOf(notification);
      if (kind === 'daily') return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
      const quiet = kind !== undefined && kind !== 'billing_issue' && SUBSCRIPTION_KINDS.has(kind);
      return { shouldShowBanner: !quiet, shouldShowList: true, shouldPlaySound: !quiet, shouldSetBadge: false };
    },
  });
  const subscriptions = [
    N.addNotificationResponseReceivedListener(handleResponse),
    N.addNotificationReceivedListener((notification) => {
      const { kind } = payloadOf(notification);
      if (kind && SUBSCRIPTION_KINDS.has(kind)) void refreshUsage(true);
    }),
    N.addPushTokenListener(() => void registerDevice(true)),
  ];
  setAccountExitHandler(async (reason) => {
    const token = registered?.token ?? (state.permission === 'granted' ? await deviceToken(N, 3000).catch(() => null) : null);
    registered = null;
    await cancelReminders();
    // Deleting the account removed its tokens on the server; signing out removes this device's.
    if (reason === 'sign-out' && token) await api.removePushToken(token).catch(() => undefined);
  });
  // The tap that launched the app (the listener may not see it); routed once the navigator is up.
  try {
    const launch = N.getLastNotificationResponse();
    if (launch) handleResponse(launch);
  } catch {
    // Not on this platform.
  }
  void refreshPermission();
  return () => {
    subscriptions.forEach((subscription) => subscription.remove());
    N.setNotificationHandler(null);
    setAccountExitHandler(null);
  };
}
