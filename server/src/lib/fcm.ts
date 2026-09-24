import crypto from 'node:crypto';
import type { Config } from '../config';

export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const FCM_SEND_BASE = 'https://fcm.googleapis.com';

const REQUEST_TIMEOUT_MS = 10_000;
/** Google issues access tokens for an hour; ours is renewed this long before it runs out. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** How long FCM keeps a message for an offline device, unless the notification says otherwise. */
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

export interface FcmNotification {
  /** The FCM registration token, as the app registered it. */
  token: string;
  title: string;
  body: string;
  /** Delivered as the message's `data` map; FCM accepts string values only. */
  data: Record<string, string>;
  /** Same id: a newer notification replaces the older one (collapse_key + notification tag). */
  collapseId?: string;
  ttlSeconds?: number;
  /** Android notification channel; absent means the app's default channel. */
  channelId?: string;
}

export interface FcmResult {
  /** HTTP status from FCM; 0 when there was no answer (network error, timeout, no access token). */
  status: number;
  /** The error message (or the local error). */
  reason?: string;
  /** FcmError errorCode (UNREGISTERED, INVALID_ARGUMENT, …), else the google.rpc status. */
  errorCode?: string;
  /** Fields a 400 names as invalid (google.rpc.BadRequest fieldViolations), e.g. message.token. */
  invalidFields?: string[];
}

/** Sends one notification. Never throws: every failure comes back as a status and reason. */
export interface FcmSender {
  send(notification: FcmNotification): Promise<FcmResult>;
}

/**
 * The token is gone for good: 404 / UNREGISTERED (the app was uninstalled or the token expired),
 * or a 400 INVALID_ARGUMENT that blames the registration token itself. Other 400s (a payload we
 * got wrong) and 403 SENDER_ID_MISMATCH (more likely our own project misconfiguration) keep it.
 */
export function isDeadFcmToken(result: FcmResult) {
  if (result.status === 404 || result.errorCode === 'UNREGISTERED') return true;
  if (result.status !== 400 || result.errorCode !== 'INVALID_ARGUMENT') return false;
  if (result.invalidFields?.includes('message.token')) return true;
  return /registration token/i.test(result.reason ?? '');
}

interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  key: crypto.KeyObject;
  tokenUri: string;
}

/** FCM_SERVICE_ACCOUNT_BASE64: the service-account JSON base64-encoded, or the raw JSON. */
function readServiceAccount(value: string, projectOverride?: string): ServiceAccount {
  const trimmed = value.trim();
  const text = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('not a service-account JSON');
  }
  const str = (name: string) => (typeof json[name] === 'string' && json[name] ? (json[name] as string) : undefined);
  const clientEmail = str('client_email');
  const privateKey = str('private_key');
  const projectId = projectOverride || str('project_id');
  if (!clientEmail || !privateKey || !projectId) throw new Error('client_email, private_key or project_id is missing');
  const key = crypto.createPrivateKey(privateKey.replace(/\\n/g, '\n'));
  if (key.asymmetricKeyType !== 'rsa') throw new Error('private_key is not an RSA key');
  return { projectId, clientEmail, key, tokenUri: str('token_uri') ?? GOOGLE_TOKEN_URL };
}

/** The RS256 JWT exchanged for an OAuth2 access token (service-account "JWT bearer" grant). */
export function fcmAssertion(key: crypto.KeyObject, clientEmail: string, audience: string, now = Date.now()): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const iat = Math.floor(now / 1000);
  const signingInput = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: clientEmail, scope: FCM_SCOPE, aud: audience, iat, exp: iat + 3600 })}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), key);
  return `${signingInput}.${signature.toString('base64url')}`;
}

export interface FcmOptions {
  /** Overridable for tests. */
  fetch?: typeof fetch;
  /** Overrides the service account's token_uri. */
  tokenUrl?: string;
  sendBase?: string;
  timeoutMs?: number;
}

/**
 * The FCM HTTP v1 client, or null when Android push is not configured (FCM_SERVICE_ACCOUNT_BASE64
 * missing or unreadable): the server runs as before and simply sends nothing to Android.
 */
export function createFcmSender(config: Config, options: FcmOptions = {}): FcmSender | null {
  if (!config.fcmServiceAccount) return null;
  let account: ServiceAccount;
  try {
    account = readServiceAccount(config.fcmServiceAccount, config.fcmProjectId);
  } catch (error) {
    console.error('[mirobe] FCM_SERVICE_ACCOUNT_BASE64 is not a usable service account, Android push is off:', (error as Error).message);
    return null;
  }
  return new FcmClient(account, options);
}

const describe = (error: unknown) => {
  const err = error as Error;
  return err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'Timeout' : err?.message || String(error);
};

class FcmClient implements FcmSender {
  private accessToken: { value: string; refreshAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;
  private fetch: typeof fetch;
  private tokenUrl: string;
  private sendUrl: string;
  private timeoutMs: number;

  constructor(
    private account: ServiceAccount,
    options: FcmOptions
  ) {
    this.fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.tokenUrl = options.tokenUrl ?? account.tokenUri;
    this.sendUrl = `${options.sendBase ?? FCM_SEND_BASE}/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /** Cached until shortly before it expires; concurrent sends share one token request. */
  private bearer(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessToken.refreshAt) return Promise.resolve(this.accessToken.value);
    if (!this.pendingToken) {
      this.pendingToken = this.requestToken().finally(() => {
        this.pendingToken = null;
      });
    }
    return this.pendingToken;
  }

  private async requestToken(): Promise<string> {
    const assertion = fcmAssertion(this.account.key, this.account.clientEmail, this.account.tokenUri);
    const response = await this.fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    let json: { access_token?: string; expires_in?: number; error?: string; error_description?: string } = {};
    try {
      json = JSON.parse(text);
    } catch {
      // Reported below.
    }
    if (!response.ok || !json.access_token) {
      throw new Error(`OAuth token ${response.status}: ${json.error_description ?? json.error ?? text.slice(0, 200)}`);
    }
    const lifetimeMs = (Number(json.expires_in) || 3600) * 1000;
    this.accessToken = { value: json.access_token, refreshAt: Date.now() + Math.max(lifetimeMs - TOKEN_REFRESH_MARGIN_MS, 0) };
    return json.access_token;
  }

  private body(notification: FcmNotification) {
    const ttl = notification.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    return {
      message: {
        token: notification.token,
        notification: { title: notification.title, body: notification.body },
        data: Object.fromEntries(Object.entries(notification.data).map(([key, value]) => [key, String(value)])),
        android: {
          priority: 'HIGH',
          ttl: `${ttl}s`,
          ...(notification.collapseId ? { collapse_key: notification.collapseId } : {}),
          notification: {
            ...(notification.channelId ? { channel_id: notification.channelId } : {}),
            ...(notification.collapseId ? { tag: notification.collapseId } : {}),
            sound: 'default',
          },
        },
      },
    };
  }

  private async attempt(notification: FcmNotification): Promise<FcmResult> {
    let token: string;
    try {
      token = await this.bearer();
    } catch (error) {
      return { status: 0, reason: describe(error) };
    }
    try {
      const response = await this.fetch(this.sendUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(this.body(notification)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await response.text();
      if (response.ok) return { status: response.status };
      return { status: response.status, ...parseError(text) };
    } catch (error) {
      return { status: 0, reason: describe(error) };
    }
  }

  async send(notification: FcmNotification): Promise<FcmResult> {
    const first = await this.attempt(notification);
    if (first.status !== 401) return first;
    // The access token was revoked or expired early: fetch a new one and try once more.
    this.accessToken = null;
    const second = await this.attempt(notification);
    if (second.status === 401) this.accessToken = null;
    return second;
  }
}

interface GoogleErrorBody {
  error?: {
    message?: string;
    status?: string;
    details?: { '@type'?: string; errorCode?: string; fieldViolations?: { field?: string }[] }[];
  };
}

function parseError(text: string): Omit<FcmResult, 'status'> {
  let parsed: GoogleErrorBody;
  try {
    parsed = JSON.parse(text) as GoogleErrorBody;
  } catch {
    return { reason: text.slice(0, 200) || undefined };
  }
  const error = parsed.error ?? {};
  const details = Array.isArray(error.details) ? error.details : [];
  const fcmError = details.find((detail) => detail?.['@type']?.endsWith('google.firebase.fcm.v1.FcmError'));
  const invalidFields = details.flatMap((detail) => (Array.isArray(detail?.fieldViolations) ? detail.fieldViolations.map((v) => v?.field).filter((f): f is string => !!f) : []));
  return {
    reason: error.message,
    errorCode: fcmError?.errorCode ?? error.status,
    ...(invalidFields.length ? { invalidFields } : {}),
  };
}
