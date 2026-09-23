import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import type * as ExpoStoreReview from 'expo-store-review';
import { localDb } from './localDb';

type StoreReview = typeof ExpoStoreReview;

/**
 * expo-store-review is native code that older dev builds do not contain, so it is loaded like
 * expo-notifications (see notifications.ts): required on first use, and only when its native
 * side is in the binary. Without it nothing is ever asked.
 */
const reviewAvailable = Platform.OS !== 'web' && requireOptionalNativeModule('ExpoStoreReview') !== null;

let loaded: StoreReview | null | undefined;

function native(): StoreReview | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  if (!reviewAvailable) return null;
  try {
    // Inside try, Metro bundles it as an optional dependency; it is evaluated only here.
    loaded = require('expo-store-review') as StoreReview;
  } catch (error) {
    console.warn('[mirobe] store review unavailable:', (error as Error).message);
  }
  return loaded;
}

// Bookkeeping in the device's key-value table. It belongs to the device, not the account:
// signing out keeps it (see REVIEW_KEYS).
const FIRST_USE_KEY = 'review.firstUse';
const TRYONS_KEY = 'review.tryons';
const LOOKS_KEY = 'review.looks';
/** The app version the prompt was last requested in. */
const ASKED_KEY = 'review.askedVersion';
export const REVIEW_KEYS = [FIRST_USE_KEY, TRYONS_KEY, LOOKS_KEY, ASKED_KEY];

/** Fresh (not cached) try-ons, or saved looks, before the prompt may appear. */
const TRYONS_BEFORE_ASKING = 3;
const LOOKS_BEFORE_ASKING = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The success itself (new photo, "Saved", haptic) lands first; the system sheet follows. */
const ASK_DELAY_MS = 1500;

const appVersion = () => Constants.expoConfig?.version ?? '1.0.0';
const count = (key: string) => Number(localDb.getKv(key)) || 0;

/** At launch: remembers when this device first used the app (its first day is never asked on). */
export function noteAppOpened(now = Date.now()) {
  if (!localDb.getKv(FIRST_USE_KEY)) localDb.setKv(FIRST_USE_KEY, new Date(now).toISOString());
}

function reviewDue(now: number): boolean {
  if (!reviewAvailable || localDb.getKv(ASKED_KEY) === appVersion()) return false;
  const firstUse = Date.parse(localDb.getKv(FIRST_USE_KEY) ?? '');
  if (!Number.isFinite(firstUse) || now - firstUse < DAY_MS) return false;
  return count(TRYONS_KEY) >= TRYONS_BEFORE_ASKING || count(LOOKS_KEY) >= LOOKS_BEFORE_ASKING;
}

let scheduled: ReturnType<typeof setTimeout> | null = null;

/**
 * A happy moment: a fresh try-on came back, or a look was saved. From the 3rd try-on or the
 * 2nd look on, asks for a rating with the system prompt only (no custom "rate us" UI: App Store
 * 1.1.7 and 5.6.1). At most once per app version, never on the first day of use and never while
 * an error or limit message is up; the system may still decide not to show it.
 */
export function noteHappyMoment(kind: 'tryon' | 'look', errorShowing: boolean, now = Date.now()) {
  const key = kind === 'tryon' ? TRYONS_KEY : LOOKS_KEY;
  localDb.setKv(key, String(count(key) + 1));
  if (errorShowing || scheduled || !reviewDue(now)) return;
  scheduled = setTimeout(() => {
    scheduled = null;
    void ask();
  }, ASK_DELAY_MS);
}

async function ask() {
  const StoreReview = native();
  // Left the app meanwhile, or another moment already asked in this version.
  if (!StoreReview || AppState.currentState !== 'active' || localDb.getKv(ASKED_KEY) === appVersion()) return;
  try {
    // False on TestFlight builds: nothing is asked there, and a later moment tries again.
    if (!(await StoreReview.isAvailableAsync())) return;
    localDb.setKv(ASKED_KEY, appVersion());
    await StoreReview.requestReview();
  } catch (error) {
    console.warn('[mirobe] store review:', (error as Error).message);
  }
}
