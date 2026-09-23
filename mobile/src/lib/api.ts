import Constants from 'expo-constants';
import type {
  AiConsentResponse,
  AnalyzeGarmentResponse,
  AuthResponse,
  GarmentRow,
  LiveStartResponse,
  MediaUploadResponse,
  MeResponse,
  NotificationSettings,
  PushTokenInput,
  StylistChatMessage,
  StylistChatResponse,
  StylistResponse,
  SyncPullResult,
  SyncPush,
  SyncPushResult,
  TryOnResponse,
  TryOnRow,
  UsageSnapshot,
} from '@mirobe/shared';
import { resolveLocalUri } from './localPath';

/**
 * API base URL. Production builds set EXPO_PUBLIC_API_URL. In development we
 * reuse the Metro host (the Mac's LAN IP) so a phone on the same Wi-Fi reaches
 * the local server without any configuration.
 */
function resolveBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:3000`;
}

export const API_BASE_URL = resolveBaseUrl();

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
let onAuthRequired: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

/** Called when the server refuses an AI feature to an anonymous account (403 AUTH_REQUIRED). */
export function setAuthRequiredHandler(handler: () => void) {
  onAuthRequired = handler;
}

/** Stored media paths are relative (`/media/…`) so the same row works on any host. */
export function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^(file:|local:)/.test(path)) return resolveLocalUri(path);
  if (/^(https?:|data:)/.test(path)) return path;
  return `${API_BASE_URL}${path}`;
}

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  const sentToken = authToken;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(sentToken ? { Authorization: `Bearer ${sentToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ApiError(0, (error as Error).message || 'Network error', 'NETWORK');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Credential endpoints answer 401 for a wrong password; that is not a lost session (nor is a
    // wrong password when confirming an account deletion). A request sent with a token that has
    // since been replaced (sign-in/out) is stale too.
    const wrongPassword = payload?.code === 'INVALID_CREDENTIALS';
    if (response.status === 401 && !path.startsWith('/api/auth/') && !wrongPassword && sentToken === authToken) onUnauthorized?.();
    if (response.status === 403 && payload?.code === 'AUTH_REQUIRED') onAuthRequired?.();
    throw new ApiError(response.status, payload?.error || `HTTP ${response.status}`, payload?.code);
  }
  return payload as T;
}

export const api = {
  health: () => request<{ ok: boolean; providers: Record<string, boolean> }>('GET', '/api/health', undefined, 5000),
  anonymous: () => request<AuthResponse>('POST', '/api/auth/anonymous'),
  register: (email: string, password: string) => request<AuthResponse>('POST', '/api/auth/register', { email, password }),
  login: (email: string, password: string) => request<AuthResponse>('POST', '/api/auth/login', { email, password }),
  logout: () => request<{ ok: boolean }>('POST', '/api/auth/logout', {}, 10_000),
  /** Deletes the account and everything it owns on the server. Registered accounts send their current password. */
  deleteAccount: (password?: string) => request<{ ok: boolean }>('DELETE', '/api/me', password ? { password } : {}, 30_000),
  me: (refresh = false) => request<MeResponse>('GET', `/api/me${refresh ? '?refresh=1' : ''}`),
  /** Gives (true) or withdraws (false) consent to AI processing. A server that predates it answers 404. */
  setAiConsent: (granted: boolean) => request<AiConsentResponse>('POST', '/api/me/ai-consent', { granted }, 15_000),
  /** Marks an in-app notice from `me().notices` as shown, so the server stops listing it. */
  seenNotice: (id: string) => request<{ ok: boolean }>('POST', `/api/notices/${encodeURIComponent(id)}/seen`, {}, 15_000),
  /** After a purchase or restore: the server re-reads the plan from RevenueCat, bypassing its cache. */
  billingSync: () => request<MeResponse>('POST', '/api/billing/sync', {}, 15_000),
  uploadImage: (dataUrl: string) => request<MediaUploadResponse>('POST', '/api/media', { dataUrl }, 60_000),
  push: (body: SyncPush) => request<SyncPushResult>('POST', '/api/sync/push', body),
  pull: (since: number) => request<SyncPullResult>('GET', `/api/sync/pull?since=${since}&limit=300`),
  // AI calls: the server keeps each under ~95 s (Cloudflare cuts proxied requests at 100 s).
  analyzeGarment: (id: string, lang: string) =>
    request<AnalyzeGarmentResponse & { warning?: string }>('POST', `/api/garments/${id}/analyze`, { lang }, 100_000),
  packshot: (id: string) => request<{ garment: GarmentRow; usage?: UsageSnapshot }>('POST', `/api/garments/${id}/packshot`, {}, 100_000),
  decide: (query: string, lang: string, exclude: string[] = []) =>
    request<StylistResponse>('POST', '/api/stylist/decide', { query, lang, exclude }),
  stylistChat: (messages: StylistChatMessage[], lang: string) =>
    request<StylistChatResponse>('POST', '/api/stylist/chat', { messages, lang }, 90_000),
  tryOn: (garmentIds: string[], personImageUrl?: string) =>
    request<TryOnResponse>('POST', '/api/tryons', { garmentIds, personImageUrl }, 100_000),
  getTryOn: (id: string) => request<{ tryon: TryOnRow }>('GET', `/api/tryons/${id}`),
  deleteTryOn: (id: string) => request<{ tryon: TryOnRow }>('DELETE', `/api/tryons/${id}`),
  requestVideo: (id: string) => request<{ tryon: TryOnRow; usage?: UsageSnapshot }>('POST', `/api/tryons/${id}/video`, {}),
  liveStart: (garmentId: string) => request<LiveStartResponse>('POST', '/api/live/start', { garmentId }),
  liveToken: (sessionId: string) => request<{ token: string }>('POST', '/api/live/token', { sessionId }),
  liveStop: (sessionId: string, usedSeconds: number) => request<{ ok: boolean }>('POST', '/api/live/stop', { sessionId, usedSeconds }),
  /** Registers this device's native push token (APNs on iOS) for the signed-in user; a known token moves to them. */
  registerPushToken: (input: PushTokenInput) => request<{ ok: boolean }>('POST', '/api/push/tokens', input, 15_000),
  /** Short timeout: it runs while signing out. */
  removePushToken: (token: string) => request<{ ok: boolean; removed: number }>('DELETE', '/api/push/tokens', { token }, 5_000),
  notificationSettings: () => request<NotificationSettings>('GET', '/api/me/notification-settings', undefined, 15_000),
  setNotificationSettings: (settings: NotificationSettings) =>
    request<NotificationSettings>('PUT', '/api/me/notification-settings', settings, 15_000),
};
