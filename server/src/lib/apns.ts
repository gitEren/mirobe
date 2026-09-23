import crypto from 'node:crypto';
import http2 from 'node:http2';
import type { PushEnvironment } from '@mirobe/shared';
import type { Config } from '../config';

export const APNS_HOSTS: Record<PushEnvironment, string> = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

/** Apple accepts a provider token for an hour and refuses new ones more often than every 20 minutes. */
const PROVIDER_TOKEN_TTL_MS = 50 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
/** An idle connection is closed after this long; the next push opens a new one. */
const IDLE_CLOSE_MS = 5 * 60 * 1000;
/** How long APNs keeps retrying a device that is offline, unless the notification says otherwise. */
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

export interface ApnsNotification {
  /** The device token (hex), as the app registered it. */
  token: string;
  environment: PushEnvironment;
  /** The JSON body: `aps` plus our own keys. */
  payload: Record<string, unknown>;
  /** Notifications with the same collapse id replace each other on the device. */
  collapseId?: string;
  ttlSeconds?: number;
}

export interface ApnsResult {
  /** HTTP status from APNs; 0 when there was no answer (network error, timeout). */
  status: number;
  /** APNs error reason (BadDeviceToken, Unregistered, …) or the local error. */
  reason?: string;
}

/** Sends one notification. Never throws: every failure comes back as a status and reason. */
export interface PushSender {
  send(notification: ApnsNotification): Promise<ApnsResult>;
}

/** The token is gone for good: the app was uninstalled, or it is not a token for this app. */
export function isDeadToken(result: ApnsResult) {
  return result.status === 410 || (result.status === 400 && result.reason === 'BadDeviceToken');
}

/** The .p8 key from APNS_KEY_BASE64. A pasted PEM (with literal \n escapes) is accepted as well. */
function readSigningKey(value: string): crypto.KeyObject {
  const pem = value.includes('BEGIN PRIVATE KEY') ? value.replace(/\\n/g, '\n') : Buffer.from(value.trim(), 'base64').toString('utf8');
  const key = crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('not an ES256 (P-256) key');
  }
  return key;
}

/** The ES256 JWT APNs expects in `authorization: bearer …` (token-based provider auth). */
export function apnsProviderToken(key: crypto.KeyObject, keyId: string, teamId: string, now = Date.now()): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode({ alg: 'ES256', kid: keyId })}.${encode({ iss: teamId, iat: Math.floor(now / 1000) })}`;
  // JWS wants the raw r || s signature, not DER.
  const signature = crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${signature.toString('base64url')}`;
}

export interface ApnsOptions {
  /** Overridable for tests (a local HTTP/2 server). */
  hosts?: Record<PushEnvironment, string>;
  timeoutMs?: number;
}

/**
 * The APNs client, or null when push is not configured (APNS_KEY_ID / APNS_KEY_BASE64
 * missing or unreadable): the server runs as before and simply sends nothing.
 */
export function createApnsSender(config: Config, options: ApnsOptions = {}): PushSender | null {
  if (!config.apnsKeyId || !config.apnsKey) return null;
  let key: crypto.KeyObject;
  try {
    key = readSigningKey(config.apnsKey);
  } catch (error) {
    console.error('[mirobe] APNS_KEY_BASE64 is not a usable .p8 key, push notifications are off:', (error as Error).message);
    return null;
  }
  return new ApnsClient(key, config.apnsKeyId, config.apnsTeamId, config.apnsTopic, options);
}

class ApnsClient implements PushSender {
  private sessions = new Map<PushEnvironment, http2.ClientHttp2Session>();
  private providerToken: { value: string; issuedAt: number } | null = null;
  private hosts: Record<PushEnvironment, string>;
  private timeoutMs: number;

  constructor(
    private key: crypto.KeyObject,
    private keyId: string,
    private teamId: string,
    private topic: string,
    options: ApnsOptions
  ) {
    this.hosts = options.hosts ?? APNS_HOSTS;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /** Cached for ~50 minutes: a fresh JWT per request would get us throttled (TooManyProviderTokenUpdates). */
  private bearer() {
    const now = Date.now();
    if (!this.providerToken || now - this.providerToken.issuedAt >= PROVIDER_TOKEN_TTL_MS) {
      this.providerToken = { value: apnsProviderToken(this.key, this.keyId, this.teamId, now), issuedAt: now };
    }
    return this.providerToken.value;
  }

  /** One HTTP/2 connection per environment, reused until it fails, is closed by Apple or goes idle. */
  private session(environment: PushEnvironment) {
    const existing = this.sessions.get(environment);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const session = http2.connect(this.hosts[environment]);
    const forget = () => {
      if (this.sessions.get(environment) === session) this.sessions.delete(environment);
    };
    session.on('error', (error) => {
      console.warn(`[mirobe] APNs ${environment} connection:`, error.message);
      forget();
    });
    session.on('goaway', forget);
    session.on('close', forget);
    session.setTimeout(IDLE_CLOSE_MS, () => session.close());
    // An open connection must not keep the process (or a test run) alive.
    session.unref();
    this.sessions.set(environment, session);
    return session;
  }

  send(notification: ApnsNotification): Promise<ApnsResult> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: ApnsResult) => {
        if (settled) return;
        settled = true;
        if (result.reason === 'ExpiredProviderToken' || result.reason === 'InvalidProviderToken') this.providerToken = null;
        resolve(result);
      };

      let stream: http2.ClientHttp2Stream;
      try {
        const expiration = Math.floor(Date.now() / 1000) + (notification.ttlSeconds ?? DEFAULT_TTL_SECONDS);
        stream = this.session(notification.environment).request({
          ':method': 'POST',
          ':path': `/3/device/${encodeURIComponent(notification.token)}`,
          authorization: `bearer ${this.bearer()}`,
          'apns-topic': this.topic,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-expiration': String(expiration),
          ...(notification.collapseId ? { 'apns-collapse-id': notification.collapseId } : {}),
          'content-type': 'application/json',
        });
      } catch (error) {
        finish({ status: 0, reason: (error as Error).message });
        return;
      }

      let status = 0;
      let body = '';
      const complete = () => {
        if (status === 200) return finish({ status });
        let reason: string | undefined;
        try {
          reason = (JSON.parse(body) as { reason?: string }).reason;
        } catch {
          reason = body.slice(0, 200) || undefined;
        }
        finish({ status, reason: reason ?? (status ? undefined : 'No response') });
      };
      stream.setEncoding('utf8');
      stream.setTimeout(this.timeoutMs, () => {
        finish({ status: 0, reason: 'Timeout' });
        stream.close(http2.constants.NGHTTP2_CANCEL);
      });
      stream.on('response', (headers) => {
        status = Number(headers[':status']) || 0;
      });
      stream.on('data', (chunk: string) => {
        body += chunk;
      });
      stream.on('end', complete);
      stream.on('close', complete);
      stream.on('error', (error) => finish({ status: 0, reason: error.message }));
      stream.end(JSON.stringify(notification.payload));
    });
  }
}
