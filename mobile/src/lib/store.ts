import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import { router, useSegments, type Href } from 'expo-router';
import {
  AI_CONSENT_REQUIRED,
  normalizePlanId,
  type AiReportInput,
  PLANS,
  USER_NOTICE_KINDS,
  type AuthResponse,
  type MeResponse,
  type UserNotice,
  type StylistChatMessage,
  type StylistChatResponse,
  type AvatarRow,
  type GarmentRow,
  type LookRow,
  type StylistDecision,
  type SyncRowMap,
  type SyncTable,
  type TryOnRow,
  type UsageKind,
  type UsageSnapshot,
} from '@mirobe/shared';
import { api, ApiError, setAuthRequiredHandler, setAuthToken, setUnauthorizedHandler } from './api';
import { deviceLang, dictionaries, type Lang, type Strings } from './i18n';
import { localDb } from './localDb';
import { toStoredPath } from './localPath';
import { clearLocalMedia, isLocalUri, MissingLocalPhotoError, uploadLocalPhoto } from './media';
import { noteAppOpened, noteHappyMoment, REVIEW_KEYS } from './review';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface AppState_ {
  ready: boolean;
  lang: Lang;
  userId: string | null;
  /** Signed-in email; null while the device runs on an anonymous account. */
  email: string | null;
  /** AI features need a registered account; browsing and local edits do not. */
  isAnonymous: boolean;
  online: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  onboarded: boolean;
  usage: UsageSnapshot | null;
  garments: GarmentRow[];
  looks: LookRow[];
  avatars: AvatarRow[];
  tryons: TryOnRow[];
  /** Garment ids whose AI analysis is currently running. */
  analyzing: string[];
  /** In-app notices from the server still to be shown on this device, newest first (see refreshUsage). */
  notices: UserNotice[];
  /**
   * The account allowed AI processing (App Store 5.1.2(i)): the server's answer from /api/me,
   * or this device's own record while the server predates consent (see adoptAiConsent).
   */
  aiConsent: boolean;
  /**
   * An account was just created or signed in without consent: the tabs ask once, by
   * themselves (useAiConsentAfterSignIn). Any answer, or any consent sheet, clears it.
   */
  consentPromptDue: boolean;
  /** Garments waiting for their automatic studio image (asked for on the scan screen), oldest first. */
  autoStudio: string[];
  /** Garment ids whose studio image request is running on this device. */
  packshotting: string[];
}

let state: AppState_ = {
  ready: false,
  lang: 'tr',
  userId: null,
  email: null,
  isAnonymous: true,
  online: true,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
  onboarded: false,
  usage: null,
  garments: [],
  looks: [],
  avatars: [],
  tryons: [],
  analyzing: [],
  notices: [],
  aiConsent: false,
  consentPromptDue: false,
  autoStudio: [],
  packshotting: [],
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function setState(patch: Partial<AppState_>) {
  state = { ...state, ...patch };
  emit();
}

export function getState() {
  return state;
}

/** `selector` must return existing state (or a primitive): a fresh array/object on every call makes React re-render forever. */
export function useStore<T>(selector: (s: AppState_) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => selector(state)
  );
}

export const useStrings = () => dictionaries[useStore((s) => s.lang)];

const visible = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((row) => !row.deletedAt);
const byNewest = <T extends { createdAt: string }>(rows: T[]) => [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
/** Try-ons: last touched first, so re-opening a cached render or finishing its clip brings it back to the top. */
const byLastUsed = <T extends { updatedAt: string }>(rows: T[]) => [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const selectGarments = (s: AppState_) => s.garments;
export const selectActiveAvatar = (s: AppState_) => s.avatars.find((a) => a.isActive) ?? null;

function reloadFromDisk() {
  const all = localDb.loadAll();
  setState({
    garments: byNewest(visible(all.garments)),
    looks: byNewest(visible(all.looks)),
    avatars: byNewest(visible(all.avatars)),
    tryons: byLastUsed(visible(all.tryons)),
  });
}

// ---------------------------------------------------------------------------
// Local writes (always succeed offline, then sync)
// ---------------------------------------------------------------------------

const now = () => new Date().toISOString();
export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

function writeLocal<T extends Exclude<SyncTable, 'tryons'>>(table: T, row: SyncRowMap[T]) {
  const stamped = { ...row, updatedAt: now() };
  localDb.put(table, stamped, true);
  reloadFromDisk();
  scheduleSync();
  return stamped;
}

export function addGarment(input: { imageUri: string; cutoutUri?: string | null; source: GarmentRow['source'] }): GarmentRow {
  const ts = now();
  return writeLocal('garments', {
    id: newId('g'),
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
    name: '',
    category: null,
    subcategory: '',
    colors: [],
    material: '',
    pattern: '',
    seasons: [],
    formality: 0,
    occasions: [],
    styleTags: [],
    extraTags: [],
    description: '',
    confidence: 0,
    // Relative to the documents folder: the absolute path changes with the app container.
    imageUrl: toStoredPath(input.imageUri),
    cutoutUrl: toStoredPath(input.cutoutUri ?? null),
    packshotUrl: null,
    taggingStatus: 'pending',
    packshotStatus: 'none',
    source: input.source,
    favorite: false,
    wornCount: 0,
    lastWornAt: null,
  });
}

export function updateGarment(id: string, patch: Partial<GarmentRow>) {
  const current = state.garments.find((g) => g.id === id);
  if (current) writeLocal('garments', { ...current, ...patch });
}

export function deleteGarment(id: string) {
  updateGarment(id, { deletedAt: now() });
}

export function retagGarment(id: string) {
  updateGarment(id, { taggingStatus: 'pending' });
}

export function saveLook(input: Pick<LookRow, 'title' | 'occasion' | 'style' | 'garmentIds' | 'source'> & Partial<LookRow>): LookRow {
  const ts = now();
  const look = writeLocal('looks', {
    id: newId('look'),
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
    tryonId: null,
    coverUrl: null,
    note: '',
    saved: true,
    ...input,
  });
  noteHappyMoment('look', errorOnScreen());
  return look;
}

export function updateLook(id: string, patch: Partial<LookRow>) {
  const current = state.looks.find((l) => l.id === id);
  if (current) writeLocal('looks', { ...current, ...patch });
}

export function deleteLook(id: string) {
  updateLook(id, { deletedAt: now() });
}

export function setAvatar(imageUri: string): AvatarRow {
  for (const avatar of state.avatars.filter((a) => a.isActive)) {
    writeLocal('avatars', { ...avatar, isActive: false });
  }
  const ts = now();
  return writeLocal('avatars', { id: newId('av'), createdAt: ts, updatedAt: ts, deletedAt: null, imageUrl: toStoredPath(imageUri), isActive: true });
}

export function setLang(lang: Lang) {
  localDb.setKv('lang', lang);
  setState({ lang });
}

export function completeOnboarding() {
  localDb.setKv('onboarded', '1');
  setState({ onboarded: true });
}

function adoptServerRow(table: SyncTable, row: SyncRowMap[SyncTable]) {
  const local = localDb.get(table, row.id);
  // A local edit that has not been pushed yet and is newer wins; it will be pushed next.
  if (local?.dirty && local.row.updatedAt > row.updatedAt) return;
  localDb.put(table, row, false);
}

// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'mirobe.token';
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncInFlight: Promise<void> | null = null;
let syncAgain = false;
/** True while the device switches accounts (sign in/up/out); sync waits for it. */
let switchingAccount = false;

export function scheduleSync(delayMs = 400) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncNow();
  }, delayMs);
}

async function ensureAccount(): Promise<boolean> {
  if (state.userId) return true;
  let token = await SecureStore.getItemAsync(TOKEN_KEY);
  let userId = localDb.getKv('userId') || null;
  if (!token || !userId) {
    const created = await api.anonymous();
    token = created.token;
    userId = created.userId;
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    localDb.setKv('userId', userId);
  }
  setAuthToken(token);
  setState({ userId });
  return true;
}

const QUARANTINE_KEY = 'quarantine';

/** Rows whose photo can never be uploaded (file gone, refused by the server): skipped by sync, kept on the device. */
function quarantined(): Record<string, string> {
  try {
    return JSON.parse(localDb.getKv(QUARANTINE_KEY) || '{}');
  } catch {
    return {};
  }
}

function quarantine(table: SyncTable, id: string, reason: string) {
  console.warn(`[mirobe] sync skips ${table}/${id}: ${reason}`);
  localDb.setKv(QUARANTINE_KEY, JSON.stringify({ ...quarantined(), [`${table}:${id}`]: reason }));
}

/** Upload failures that would hit every row alike (offline, signed out, server down): stop and retry the whole sync later. */
const isSyncWideFailure = (error: unknown) =>
  error instanceof ApiError && (error.isNetwork || error.status === 401 || error.status === 429 || error.status >= 500);

/**
 * Uploads local photos referenced by dirty rows so the pushed rows point at
 * server media. Each row is handled on its own: one missing or refused photo
 * never blocks the rest of the wardrobe from syncing.
 */
async function uploadPendingMedia() {
  const skip = quarantined();
  for (const { table, row } of localDb.dirty()) {
    if ((table !== 'garments' && table !== 'avatars') || skip[`${table}:${row.id}`]) continue;
    const media = row as GarmentRow | AvatarRow;
    const cutoutUrl = 'cutoutUrl' in media ? media.cutoutUrl : null;
    if (!isLocalUri(media.imageUrl) && !isLocalUri(cutoutUrl)) continue;
    try {
      const uploaded: { imageUrl?: string; cutoutUrl?: string | null } = {};
      if (isLocalUri(media.imageUrl)) uploaded.imageUrl = await uploadLocalPhoto(media.imageUrl);
      if (isLocalUri(cutoutUrl)) {
        // The cutout is optional: without it the garment still syncs with its photo.
        uploaded.cutoutUrl = await uploadLocalPhoto(cutoutUrl).catch((error) => {
          if (error instanceof MissingLocalPhotoError) return null;
          throw error;
        });
      }
      writeBackUploads(table, row.id, media, uploaded);
    } catch (error) {
      if (isSyncWideFailure(error)) throw error;
      quarantine(table, row.id, (error as Error).message);
    }
  }
}

/**
 * Stores the uploaded media paths on the row as it is *now*: an edit made while
 * the upload ran (rename, delete, another photo) is kept, and only a field that
 * still points at the file that was uploaded is replaced. The updatedAt stays,
 * so a concurrent edit on another device still wins LWW.
 */
function writeBackUploads(
  table: SyncTable,
  id: string,
  uploadedFrom: GarmentRow | AvatarRow,
  uploaded: { imageUrl?: string; cutoutUrl?: string | null }
) {
  localDb.transaction(() => {
    const current = localDb.get(table, id);
    if (!current) return;
    const row = { ...(current.row as GarmentRow | AvatarRow) };
    let changed = false;
    if (uploaded.imageUrl !== undefined && row.imageUrl === uploadedFrom.imageUrl) {
      row.imageUrl = uploaded.imageUrl;
      changed = true;
    }
    if (uploaded.cutoutUrl !== undefined && 'cutoutUrl' in row && row.cutoutUrl === (uploadedFrom as GarmentRow).cutoutUrl) {
      row.cutoutUrl = uploaded.cutoutUrl;
      changed = true;
    }
    if (changed) localDb.put(table, row, current.dirty);
  });
}

async function push() {
  for (let round = 0; round < 10; round += 1) {
    // Rows still pointing at local photos wait for their upload (or sit in quarantine).
    const dirty = localDb.dirty().filter(({ row }) => !isLocalUri((row as GarmentRow).imageUrl) && !isLocalUri((row as GarmentRow).cutoutUrl));
    if (dirty.length === 0) return;
    const result = await api.push({ changes: dirty.map(({ table, row }) => ({ table: table as never, row: row as never })) });
    localDb.transaction(() => {
      for (const { table, row } of dirty) localDb.markClean(table, row.id, row.updatedAt);
      for (const rejected of result.rejected) localDb.put(rejected.table, rejected.row, false);
    });
  }
}

async function pull() {
  let cursor = Number(localDb.getKv('cursor') || 0);
  for (let page = 0; page < 20; page += 1) {
    const result = await api.pull(cursor);
    localDb.transaction(() => {
      for (const table of Object.keys(result.changes) as SyncTable[]) {
        for (const row of result.changes[table]) adoptServerRow(table, row);
      }
      localDb.setKv('cursor', String(result.cursor));
    });
    cursor = result.cursor;
    if (!result.hasMore) return;
  }
}

/** Runs AI tagging for garments that were synced but not analysed yet. */
async function analyzePending() {
  // Tagging is a paid AI call that sends the photo to the AI models: garments stay pending
  // until the user signs in and the account allows AI processing.
  if (state.isAnonymous || !state.aiConsent) return;
  const pending = state.garments.filter(
    (g) => g.taggingStatus === 'pending' && !isLocalUri(g.imageUrl) && !state.analyzing.includes(g.id) && !localDb.get('garments', g.id)?.dirty
  );
  let tagged = 0;
  for (const garment of pending.slice(0, 3)) {
    setState({ analyzing: [...state.analyzing, garment.id] });
    try {
      const result = await api.analyzeGarment(garment.id, state.lang);
      tagged += 1;
      adoptServerRow('garments', result.garment);
      setState({ usage: countedUsage(result.usage), lastError: result.warning === 'PROVIDER_CREDITS' ? 'PROVIDER_CREDITS' : null });
      reloadFromDisk();
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      if (code === AI_CONSENT_REQUIRED) {
        // The server has no consent on record (withdrawn on another device, …): /api/me decides
        // what this device keeps. The pieces wait; nothing is asked without a tap.
        void refreshUsage();
        break;
      }
      setState({ lastError: code ?? (error as Error).message });
      if (code === 'QUOTA_EXCEEDED' || code === 'PROVIDER_CREDITS') {
        localDb.put('garments', { ...garment, taggingStatus: 'failed' }, false);
        reloadFromDisk();
      }
    } finally {
      setState({ analyzing: state.analyzing.filter((id) => id !== garment.id) });
    }
  }
  // A wardrobe added before signing in can be longer than one batch: keep going while tagging works.
  if (tagged > 0 && pending.length > 3) scheduleSync(0);
  // Pieces tagged just now may be waiting for their studio image.
  if (tagged > 0) void runAutoStudio();
}

export function syncNow(): Promise<void> {
  if (switchingAccount) {
    scheduleSync(300);
    return Promise.resolve();
  }
  if (syncInFlight) {
    syncAgain = true;
    return syncInFlight;
  }
  syncInFlight = (async () => {
    setState({ syncing: true });
    try {
      await ensureAccount();
      await uploadPendingMedia();
      await push();
      await pull();
      reloadFromDisk();
      setState({ lastSyncAt: now(), online: true });
      void refreshUsage();
      void analyzePending();
      // Tagging may also have finished on the server meanwhile (another device, a 202).
      void runAutoStudio();
    } catch (error) {
      const offline = error instanceof ApiError && error.isNetwork;
      setState({ online: !offline, lastError: offline ? null : (error as Error).message });
    } finally {
      setState({ syncing: false });
      syncInFlight = null;
      if (syncAgain) {
        syncAgain = false;
        scheduleSync(100);
      }
    }
  })();
  return syncInFlight;
}

/**
 * The usage snapshot with every bucket filled in. A server from before count-based
 * quotas reports photoTokens / jevDecisions / videoSeconds instead: a bucket it did
 * not report shows the plan's limit with nothing used (the server enforces either way).
 */
function countedUsage(usage: UsageSnapshot): UsageSnapshot {
  const planId = normalizePlanId(usage.planId);
  const count = (kind: UsageKind) => usage[kind] ?? { used: 0, limit: PLANS[planId][kind] };
  return { ...usage, planId, images: count('images'), videos: count('videos'), stylist: count('stylist'), taggings: count('taggings') };
}

export async function refreshUsage(force = false) {
  try {
    const consentBefore = consentChanges;
    const me = await api.me(force);
    if (me.userId !== state.userId) return; // answered for an account we already left
    if (me.email !== state.email) localDb.setKv('email', me.email ?? '');
    setState({ usage: countedUsage(me.usage), email: me.email ?? null, isAnonymous: !me.email });
    adoptNotices(me.notices);
    // An answer that left before the user changed their consent here must not undo the change.
    if (consentBefore === consentChanges) adoptAiConsent(me.aiConsent);
  } catch {
    // Usage is informational; the server enforces limits anyway.
  }
}

// ---------------------------------------------------------------------------
// In-app notices (auto-renew switched back on, …): listed by /api/me, shown once
// ---------------------------------------------------------------------------

/** Notices already shown this session: if marking one seen failed, it only comes back after a relaunch. */
const shownNotices = new Set<string>();

/** Queues the server's unseen notices this app can show. An older server sends none; a newer one may send kinds this app does not know. */
function adoptNotices(notices: MeResponse['notices']) {
  const next: UserNotice[] = [];
  for (const notice of Array.isArray(notices) ? notices : []) {
    if (typeof notice?.id !== 'string' || !(USER_NOTICE_KINDS as readonly string[]).includes(notice.kind) || shownNotices.has(notice.id)) continue;
    const plan = normalizePlanId(notice.plan);
    next.push(plan === 'free' ? { id: notice.id, kind: notice.kind } : { id: notice.id, kind: notice.kind, plan });
  }
  const ids = (list: UserNotice[]) => list.map((notice) => notice.id).join('|');
  if (ids(next) !== ids(state.notices)) setState({ notices: next });
}

/** A notice is on screen: it leaves the queue, and the server stops listing it. */
export function noticeShown(id: string) {
  shownNotices.add(id);
  setState({ notices: state.notices.filter((notice) => notice.id !== id) });
  api.seenNotice(id).catch(() => {
    // Offline: the server lists it again and it is shown once more after the next launch.
  });
}

// ---------------------------------------------------------------------------
// Consent to AI processing (App Store 5.1.2(i)): garment photos, the mirror photo and
// messages to Jev reach the AI models only once the account allowed it. The consent sheet
// (app/ai-consent) asks when an AI action first starts; Profile withdraws or gives it again.
// ---------------------------------------------------------------------------

/**
 * This account's answer on this device (a sign-out clears it with the rest): 'server' once the
 * server recorded the consent, 'local' when it was given against a server that predates consent
 * (its POST answered 404) and still has to be recorded there; empty when not given.
 */
const CONSENT_KEY = 'ai.consent';

const consentOnDevice = () => ['server', 'local'].includes(localDb.getKv(CONSENT_KEY) ?? '');
/** Counts the answers given on this device (see refreshUsage). */
let consentChanges = 0;

function storeAiConsent(recorded: 'server' | 'local' | null) {
  localDb.setKv(CONSENT_KEY, recorded ?? '');
  if (recorded) clearConsentPrompt();
  if (state.aiConsent !== Boolean(recorded)) setState({ aiConsent: Boolean(recorded) });
}

/**
 * 'due' while the automatic ask after sign-up / sign-in has not been shown yet. It is
 * the account's, on this device (a sign-out clears it with the rest), so "Not now" is
 * not asked again on every launch; the per-action gate (ensureAiConsent) still asks.
 */
const CONSENT_PROMPT_KEY = 'ai.consent.prompt';

function clearConsentPrompt() {
  if (localDb.getKv(CONSENT_PROMPT_KEY)) localDb.setKv(CONSENT_PROMPT_KEY, '');
  if (state.consentPromptDue) setState({ consentPromptDue: false });
}

/** After sign-up / sign-in (and /api/me): an account without consent gets the sheet once, on the tabs. */
function markConsentPromptDue() {
  if (state.isAnonymous || state.aiConsent) return clearConsentPrompt();
  localDb.setKv(CONSENT_PROMPT_KEY, 'due');
  setState({ consentPromptDue: true });
}

/**
 * Mounted by the tabs layout: right after an account was created or signed in without
 * consent, opens the consent sheet once the app is back on the tabs (the login screen
 * closed, nothing else over them). "Not now" is remembered; the first AI action still
 * asks through ensureAiConsent.
 */
export function useAiConsentAfterSignIn() {
  const onTabs = useSegments()[0] === '(tabs)';
  const due = useStore((s) => s.consentPromptDue && !s.isAnonymous && !s.aiConsent);
  useEffect(() => {
    if (!onTabs || !due) return;
    // Let the login sheet finish closing first.
    const timer = setTimeout(() => {
      if (!state.consentPromptDue || state.isAnonymous || state.aiConsent || accountScreens > 0 || consentRequest) return;
      clearConsentPrompt();
      void ensureAiConsent();
    }, 700);
    return () => clearTimeout(timer);
  }, [onTabs, due]);
}

/**
 * The server's answer from /api/me wins. A server without the field (it predates consent)
 * leaves this device's own record, and consent given while the server could not record it
 * is sent as soon as it can.
 */
function adoptAiConsent(server: MeResponse['aiConsent']) {
  if (typeof server !== 'boolean') return;
  if (server) storeAiConsent('server');
  else if (localDb.getKv(CONSENT_KEY) === 'local') void setAiConsent(true).catch(() => undefined);
  else storeAiConsent(null);
}

/**
 * Gives or withdraws consent on the server. A server that predates consent answers 404: the
 * answer is then kept on this device, so the app keeps working against it. Consent starts the
 * tagging that waited for it. Throws when the answer could not be saved (offline, …).
 */
export async function setAiConsent(granted: boolean): Promise<void> {
  await ensureAccount();
  const { userId } = state;
  let recorded: 'server' | 'local' | null;
  try {
    recorded = (await api.setAiConsent(granted)).aiConsent ? 'server' : null;
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
    recorded = granted ? 'local' : null;
  }
  if (state.userId !== userId) return; // answered for an account we already left
  consentChanges += 1;
  storeAiConsent(recorded);
  if (recorded) scheduleSync(0);
}

let consentRequest: { promise: Promise<boolean>; settle: (granted: boolean) => void; opened: boolean } | null = null;

/**
 * Gate in front of every AI action. Resolves true at once when the account allowed AI
 * processing; otherwise opens the consent sheet and resolves with the answer: false for
 * "Not now", or when the sheet closed or could not open. Calls made while it is up share
 * its answer, so a double tap never opens two.
 */
export function ensureAiConsent(): Promise<boolean> {
  if (state.aiConsent) return Promise.resolve(true);
  if (consentRequest) return consentRequest.promise;
  let settle: (granted: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((resolve) => (settle = resolve));
  const request = { promise, settle, opened: false };
  consentRequest = request;
  try {
    router.push('/ai-consent' as Href);
  } catch {
    answerConsentRequest(false);
    return promise;
  }
  // A sheet that never opened (navigation refused it) must not leave the action waiting forever.
  setTimeout(() => {
    if (consentRequest === request && !request.opened) answerConsentRequest(false);
  }, 4000);
  return promise;
}

/** The consent sheet is up (it may also have been opened without an action waiting). */
export function consentSheetOpened() {
  if (consentRequest) consentRequest.opened = true;
  // The account was asked (by an action, or after signing in): no automatic ask after this.
  clearConsentPrompt();
}

/** The sheet's answer, or false when it closed without one, goes to every action waiting for it. */
export function answerConsentRequest(granted: boolean) {
  const request = consentRequest;
  consentRequest = null;
  request?.settle(granted);
}

/** An AI action the user did not allow ("Not now"): screens treat it as cancelled, not as a failure. */
export const AI_CONSENT_DECLINED = 'AI_CONSENT_DECLINED';

/**
 * Runs an AI request once the account allowed AI processing. The server has the last word:
 * when it still answers AI_CONSENT_REQUIRED, consent given on this device while the server
 * could not record it is recorded now; consent withdrawn on another device is asked for again.
 * Either way the request is repeated once.
 */
async function withAiConsent<T>(request: () => Promise<T>): Promise<T> {
  const declined = () => new ApiError(403, 'AI processing was not allowed', AI_CONSENT_DECLINED);
  if (!(await ensureAiConsent())) throw declined();
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof ApiError && error.code === AI_CONSENT_REQUIRED)) throw error;
    if (localDb.getKv(CONSENT_KEY) === 'local') await setAiConsent(true);
    else storeAiConsent(null);
    if (!(await ensureAiConsent())) throw declined();
    return request();
  }
}

/** What a screen shows for a failed AI action; null when there is nothing to report ("Not now"). */
export function aiErrorMessage(error: unknown, t: Strings): string | null {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === AI_CONSENT_DECLINED) return null;
  if (code === 'QUOTA_EXCEEDED') return t.common.quota;
  if (code === 'PROVIDER_CREDITS') return t.common.noCredits;
  return t.common.error;
}

/** Only the out-of-credits banner is an error the app keeps on screen; the rating prompt waits while it shows. */
const errorOnScreen = () => state.lastError === 'PROVIDER_CREDITS';

// ---------------------------------------------------------------------------
// Account: email sign-up / sign-in / sign-out
// ---------------------------------------------------------------------------

/** Mounted login/register screens (a counter: switching between them briefly mounts both). */
let accountScreens = 0;

/** The login/register screens report themselves so an AI gate does not stack a second one. */
export function setAccountScreenOpen(open: boolean) {
  accountScreens = Math.max(0, accountScreens + (open ? 1 : -1));
}

/**
 * Gate for every paid AI action. Returns true when a registered account is
 * signed in; otherwise opens the login screen (returning to `next` afterwards
 * when there is no screen to go back to) and returns false.
 */
export function requireAccount(next?: string): boolean {
  if (!state.isAnonymous) return true;
  if (accountScreens === 0) router.push({ pathname: '/login', params: next ? { next } : {} });
  return false;
}

/**
 * Entry points to the camera and AI screens (scan, mirror, avatar, stylist):
 * a registered account opens `route`; an anonymous one gets the login screen
 * first, which opens `route` after signing in. Nothing is captured before that.
 */
export function openWithAccount(route: string) {
  if (!state.isAnonymous) router.push(route as Href);
  else if (accountScreens === 0) router.push({ pathname: '/login', params: { next: route, open: '1' } });
}

/**
 * The same gate on the gated screens themselves, for when one is reached while
 * anonymous anyway (deep link, back navigation, signed out underneath). The
 * screen is swapped for the login screen before it renders anything (no camera);
 * signing in opens it again. Returns whether the screen may render.
 */
export function useAccountGate(route: string): boolean {
  const allowed = useStore((s) => !s.isAnonymous);
  useEffect(() => {
    if (allowed || accountScreens > 0) return;
    router.replace({ pathname: '/login', params: { next: route, open: '1' } });
  }, [allowed, route]);
  return allowed;
}

async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  switchingAccount = true;
  try {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = null;
    await syncInFlight?.catch(() => undefined);
    return await fn();
  } finally {
    switchingAccount = false;
  }
}

/** Stores the new session. Same user (anonymous upgrade) keeps the sync cursor; another account pulls from scratch. */
async function adoptSession(auth: AuthResponse) {
  const sameUser = auth.userId === state.userId;
  await SecureStore.setItemAsync(TOKEN_KEY, auth.token);
  setAuthToken(auth.token);
  localDb.setKv('userId', auth.userId);
  localDb.setKv('email', auth.email ?? '');
  if (!sameUser) {
    localDb.setKv('cursor', '0');
    // Consent belongs to the account: another one answers for itself (/api/me brings its answer).
    localDb.setKv(CONSENT_KEY, '');
  }
  setState({
    userId: auth.userId,
    email: auth.email ?? null,
    isAnonymous: !auth.email,
    usage: null,
    lastError: null,
    notices: [],
    aiConsent: sameUser && state.aiConsent,
  });
}

/**
 * Runs as a session ends: before signing out (the session is still valid, so this device's
 * push token can be removed) and after the account was deleted. Set by the notifications module.
 */
let accountExitHandler: ((reason: 'sign-out' | 'deleted') => Promise<void>) | null = null;

export function setAccountExitHandler(handler: typeof accountExitHandler) {
  accountExitHandler = handler;
}

/** Local changes made so far go up under the current (anonymous) account first. */
async function flushBeforeSwitch() {
  try {
    await ensureAccount();
    await uploadPendingMedia();
    await push();
  } catch {
    // Best effort: rows that did not make it stay dirty and push under the new session.
    // Offline, the auth request below fails the same way and reports it.
  }
}

/**
 * Sign up. On an anonymous device the server upgrades that same user in place,
 * so the wardrobe on this phone simply becomes the account's.
 */
export async function registerAccount(email: string, password: string) {
  await runExclusive(async () => {
    await flushBeforeSwitch();
    await adoptSession(await api.register(email, password));
  });
  await refreshUsage(true);
  markConsentPromptDue();
  await syncNow();
}

/**
 * Sign in to an existing account. The request carries the anonymous token, and
 * the server moves this device's anonymous wardrobe into the account (same row
 * ids, now owned by it). The local rows stay, dirty ones push under the account,
 * and a pull from cursor 0 brings in everything the account already had.
 */
export async function signIn(email: string, password: string) {
  if (!state.isAnonymous) await signOut();
  await runExclusive(async () => {
    await flushBeforeSwitch();
    await adoptSession(await api.login(email, password));
  });
  await refreshUsage(true);
  markConsentPromptDue();
  await syncNow();
}

/** Drops everything the previous account left on this device (rows, cursor, photos). */
function wipeLocalAccount() {
  const { lang, onboarded } = state;
  // The rating prompt's bookkeeping belongs to the device, not the account.
  const review = [...REVIEW_KEYS, STUDIO_AT_CAPTURE_KEY].map((key) => [key, localDb.getKv(key)] as const);
  localDb.reset();
  localDb.setKv('lang', lang);
  if (onboarded) localDb.setKv('onboarded', '1');
  for (const [key, value] of review) if (value !== null) localDb.setKv(key, value);
  clearLocalMedia();
  setAuthToken(null);
  setState({
    userId: null,
    email: null,
    isAnonymous: true,
    usage: null,
    analyzing: [],
    lastError: null,
    notices: [],
    aiConsent: false,
    consentPromptDue: false,
    autoStudio: [],
    packshotting: [],
  });
  reloadFromDisk();
}

/**
 * Sign out: push pending edits, revoke this device's token, wipe the local
 * mirror so the next person does not see this account, then continue on a
 * fresh anonymous account.
 */
export async function signOut() {
  await runExclusive(async () => {
    try {
      await uploadPendingMedia();
      await push();
    } catch {
      // Unsynced edits are lost when offline; signing out must still work.
    }
    await accountExitHandler?.('sign-out').catch(() => undefined);
    await api.logout().catch(() => undefined);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    wipeLocalAccount();
  });
  scheduleSync(0);
}

/**
 * Deletes the account on the server (rows and photos), then clears this device
 * exactly like signing out and continues on a fresh anonymous account. Unsynced
 * local edits are dropped, not pushed: they belong to the deleted account.
 * A registered account confirms with its current password.
 */
export async function deleteAccount(password?: string) {
  await runExclusive(async () => {
    await api.deleteAccount(password);
    await accountExitHandler?.('deleted').catch(() => undefined);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    wipeLocalAccount();
  });
  scheduleSync(0);
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

type RowRef = { table: SyncTable; id: string };

/** A row the server does not have in its latest version yet (unpushed edit, or a photo not uploaded). */
function unsynced({ table, id }: RowRef): boolean {
  const local = localDb.get(table, id);
  if (!local) return false;
  const row = local.row as GarmentRow;
  return local.dirty || isLocalUri(row.imageUrl) || isLocalUri(row.cutoutUrl);
}

/**
 * Paid server actions read the server's copy of the wardrobe, so they must not
 * run against stale state: waits for the sync in flight (which may have started
 * before the latest edit), runs one more, and fails with NOT_SYNCED if a row the
 * action needs still has not reached the server.
 */
export async function syncFresh(required: RowRef[] = []): Promise<void> {
  await syncInFlight?.catch(() => undefined);
  await syncNow();
  // syncNow joins a sync that was already running again; one more pass picks up anything it missed.
  if (required.some(unsynced)) {
    await syncInFlight?.catch(() => undefined);
    await syncNow();
  }
  const pending = required.filter(unsynced);
  if (pending.length === 0) return;
  const offline = !state.online;
  throw new ApiError(
    offline ? 0 : 409,
    offline ? 'Offline: changes are not on the server yet' : `Not synced yet: ${pending.map((r) => `${r.table}/${r.id}`).join(', ')}`,
    offline ? 'NETWORK' : 'NOT_SYNCED'
  );
}

const garmentRefs = (ids: string[]): RowRef[] => ids.map((id) => ({ table: 'garments', id }));

/** Studio image requests running on this device, by garment: a second caller joins the first (one charge). */
const packshotRequests = new Map<string, Promise<GarmentRow>>();

export function requestPackshot(garmentId: string): Promise<GarmentRow> {
  const running = packshotRequests.get(garmentId);
  if (running) return running;
  const request = (async () => {
    await syncFresh(garmentRefs([garmentId]));
    const result = await withAiConsent(() => api.packshot(garmentId));
    adoptServerRow('garments', result.garment);
    reloadFromDisk();
    if (result.usage) setState({ usage: countedUsage(result.usage) });
    return result.garment;
  })().finally(() => {
    packshotRequests.delete(garmentId);
    setState({ packshotting: state.packshotting.filter((id) => id !== garmentId) });
  });
  packshotRequests.set(garmentId, request);
  setState({ packshotting: [...state.packshotting, garmentId] });
  return request;
}

// ---------------------------------------------------------------------------
// Studio image at capture time: the scan screen's switch queues each new piece, and its
// studio image is requested once the piece is tagged (the render uses the tags). The
// cost is shown on the scan screen, so there is no second confirmation.
// ---------------------------------------------------------------------------

/** The scan screen's "also create a studio image" switch; a device preference, on by default. */
const STUDIO_AT_CAPTURE_KEY = 'scan.studio';
/** The queue (state.autoStudio), kept so it survives leaving the app before tagging ends. */
const AUTO_STUDIO_KEY = 'studio.auto';

export function studioAtCapturePreferred(): boolean {
  return localDb.getKv(STUDIO_AT_CAPTURE_KEY) !== '0';
}

export function setStudioAtCapture(on: boolean) {
  localDb.setKv(STUDIO_AT_CAPTURE_KEY, on ? '1' : '0');
}

/**
 * Images this month still free for a new request: the plan's allowance minus what is used
 * and what the queue will use. null while the usage is not known yet.
 */
export const selectImagesLeft = (s: AppState_): number | null =>
  s.usage ? Math.max(0, s.usage.images.limit - s.usage.images.used - s.autoStudio.length) : null;

function setAutoStudio(ids: string[]) {
  localDb.setKv(AUTO_STUDIO_KEY, JSON.stringify(ids));
  setState({ autoStudio: ids });
}

function loadAutoStudio(): string[] {
  try {
    const ids = JSON.parse(localDb.getKv(AUTO_STUDIO_KEY) || '[]');
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Queues a just-added piece for its studio image. Returns false (and queues nothing) when
 * this month's images would not cover it, or the account cannot use AI yet.
 */
export function queueAutoStudio(garmentId: string): boolean {
  if (state.isAnonymous || state.autoStudio.includes(garmentId)) return false;
  const left = selectImagesLeft(state);
  if (left === null || left <= 0) return false;
  setAutoStudio([...state.autoStudio, garmentId]);
  return true;
}

const dropAutoStudio = (ids: string[]) => setAutoStudio(state.autoStudio.filter((id) => !ids.includes(id)));

/**
 * Requests the queued studio images whose pieces are tagged. Each piece is requested once:
 * it leaves the queue when the request ends, and a piece that already has (or is making) a
 * studio image, failed tagging or was deleted is dropped without a request. Only with
 * consent: without it tagging waits too, and so does the queue.
 */
let autoStudioRunning = false;
let autoStudioAgain = false;

/** A queued piece whose studio image can be requested now: tagged, none made, none running. */
function autoStudioDue(id: string): boolean {
  const garment = state.garments.find((g) => g.id === id);
  return Boolean(garment && garment.taggingStatus === 'ready' && garment.packshotStatus === 'none' && !garment.packshotUrl && !packshotRequests.has(id));
}

async function runAutoStudio(): Promise<void> {
  if (state.isAnonymous || !state.aiConsent || state.autoStudio.length === 0) return;
  // One pass at a time; a call meanwhile runs one more pass afterwards.
  if (autoStudioRunning) {
    autoStudioAgain = true;
    return;
  }
  autoStudioRunning = true;
  let retryLater = false;
  try {
    const drop = state.autoStudio.filter((id) => {
      const garment = state.garments.find((g) => g.id === id);
      return !garment || garment.taggingStatus === 'failed' || Boolean(garment.packshotUrl) || garment.packshotStatus === 'ready' || garment.packshotStatus === 'failed';
    });
    if (drop.length) dropAutoStudio(drop);
    for (const id of [...state.autoStudio]) {
      // Re-checked right before each request: an earlier one in this pass may have changed things.
      if (!state.autoStudio.includes(id) || !autoStudioDue(id) || !state.aiConsent) continue;
      try {
        await requestPackshot(id);
        dropAutoStudio([id]);
      } catch (error) {
        const code = error instanceof ApiError ? error.code : undefined;
        // Offline or not uploaded yet: stays queued, the next sync asks again (the server charges a claim once).
        if (error instanceof ApiError && (error.isNetwork || code === 'NOT_SYNCED')) {
          retryLater = true;
          continue;
        }
        if (code === 'QUOTA_EXCEEDED') {
          setAutoStudio([]);
          return;
        }
        dropAutoStudio([id]);
        if (code === 'PROVIDER_CREDITS') setState({ lastError: 'PROVIDER_CREDITS' });
      }
    }
  } finally {
    autoStudioRunning = false;
    // After a failed request the next sync retries, not this loop (no retry storm offline).
    const again = autoStudioAgain && !retryLater;
    autoStudioAgain = false;
    if (again) void runAutoStudio();
  }
}

export async function askStylist(query: string, exclude: string[] = []): Promise<StylistDecision> {
  // The stylist reads the whole wardrobe; a garment that is not synced yet is simply not considered.
  await syncFresh();
  const result = await withAiConsent(() => api.decide(query, state.lang, exclude));
  setState({ usage: countedUsage(result.usage) });
  return result.decision;
}

export async function chatWithStylist(messages: StylistChatMessage[]): Promise<StylistChatResponse> {
  await syncFresh();
  const result = await withAiConsent(() => api.stylistChat(messages.slice(-12), state.lang));
  setState({ usage: countedUsage(result.usage) });
  return result;
}

/** Dresses the saved mirror photo, or `personImageUrl` (a just-captured camera frame) when given. */
export async function tryOnOutfit(garmentIds: string[], personImageUrl?: string): Promise<{ tryon: TryOnRow; cached: boolean }> {
  const avatar = personImageUrl ? null : selectActiveAvatar(state);
  await syncFresh([...garmentRefs(garmentIds), ...(avatar ? [{ table: 'avatars' as const, id: avatar.id }] : [])]);
  const result = await withAiConsent(() => api.tryOn(garmentIds, personImageUrl));
  adoptServerRow('tryons', result.tryon);
  reloadFromDisk();
  setState({ usage: countedUsage(result.usage) });
  // A fresh render is a moment worth a rating prompt; a cached one is not.
  if (!result.cached) noteHappyMoment('tryon', errorOnScreen());
  return result;
}

export async function requestMotionClip(tryonId: string): Promise<TryOnRow> {
  const result = await withAiConsent(() => api.requestVideo(tryonId));
  adoptServerRow('tryons', result.tryon);
  reloadFromDisk();
  if (result.usage) setState({ usage: countedUsage(result.usage) });
  return result.tryon;
}

export async function deleteTryOn(tryonId: string) {
  const { tryon } = await api.deleteTryOn(tryonId);
  adoptServerRow('tryons', tryon);
  reloadFromDisk();
}

export async function refreshTryOn(tryonId: string): Promise<TryOnRow> {
  const { tryon } = await api.getTryOn(tryonId);
  adoptServerRow('tryons', tryon);
  reloadFromDisk();
  return tryon;
}

/**
 * "Report AI output" (Google Play AI-generated content policy). Sent once, never queued: a server
 * that predates the endpoint (404) counts as sent, so the user is thanked either way; offline or
 * a refusal throws. An offensive or privacy report can take the image away (`hidden`): the row
 * the server changed is adopted at once, and a cleared studio image is not made again by itself.
 */
export async function reportAiOutput(input: AiReportInput): Promise<void> {
  const garmentTarget = input.targetType === 'packshot' || input.targetType === 'tagging';
  // The server checks the piece is ours: an edit still on this device goes first (best effort).
  if (garmentTarget) await syncFresh(garmentRefs([input.targetId])).catch(() => undefined);
  try {
    const { hidden } = await api.reportAiOutput(input);
    if (!hidden) return;
    adoptServerRow(hidden.table, hidden.row);
    if (hidden.table === 'garments') dropAutoStudio([hidden.row.id]);
    reloadFromDisk();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return;
    throw error;
  }
}

export function findTryOn(garmentIds: string[]): TryOnRow | undefined {
  const avatar = selectActiveAvatar(state);
  const key = [...garmentIds].sort().join(',');
  return state.tryons.find(
    (t) => t.status === 'ready' && t.avatarId === avatar?.id && [...t.garmentIds].sort().join(',') === key
  );
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

let booted = false;

export function boot() {
  if (booted) return;
  booted = true;
  const storedLang = localDb.getKv('lang') as Lang | null;
  const storedEmail = localDb.getKv('email') || null;
  setState({
    lang: storedLang ?? deviceLang(),
    onboarded: localDb.getKv('onboarded') === '1',
    userId: null,
    email: storedEmail,
    isAnonymous: !storedEmail,
    aiConsent: consentOnDevice(),
    consentPromptDue: localDb.getKv(CONSENT_PROMPT_KEY) === 'due',
    autoStudio: loadAutoStudio(),
  });
  noteAppOpened();
  reloadFromDisk();
  setState({ ready: true });

  setUnauthorizedHandler(() => {
    if (switchingAccount) return;
    void SecureStore.deleteItemAsync(TOKEN_KEY);
    if (!state.isAnonymous) {
      // A signed-in session was revoked: its data must not be re-pushed into a new
      // anonymous account. Clear it; signing in again pulls it back.
      wipeLocalAccount();
      return;
    }
    // Anonymous token lost or server reset: start a fresh anonymous account on next sync.
    localDb.setKv('cursor', '0');
    localDb.setKv('userId', '');
    localDb.markAllDirty();
    setAuthToken(null);
    setState({ userId: null });
  });

  // Defense in depth: the server refused an AI feature to an anonymous account.
  setAuthRequiredHandler(() => {
    localDb.setKv('email', '');
    setState({ email: null, isAnonymous: true });
    requireAccount();
  });

  NetInfo.addEventListener((net) => {
    const online = Boolean(net.isConnected && net.isInternetReachable !== false);
    if (online && !state.online) scheduleSync(0);
    setState({ online });
  });
  AppState.addEventListener('change', (status) => {
    if (status === 'active') scheduleSync(0);
  });
  scheduleSync(0);
  // Poll while something is processing server-side (tagging or video).
  setInterval(() => {
    const busy = state.tryons.some((t) => t.videoStatus === 'processing') || state.garments.some((g) => g.taggingStatus === 'processing');
    if (busy && state.online) scheduleSync(0);
  }, 5000);
}
