import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, test } from 'node:test';
import { loadConfig } from '../src/config';
import { openDb, type Db } from '../src/db/index';
import type { ApnsNotification, PushSender } from '../src/lib/apns';
import { createFcmSender, FCM_SCOPE, isDeadFcmToken, type FcmNotification, type FcmOptions, type FcmResult, type FcmSender } from '../src/lib/fcm';
import { pushToUser, savePushToken, type PushMessage } from '../src/lib/push';

const TOKEN_URL = 'https://oauth.test/token';
const SEND_BASE = 'https://fcm.test';

function serviceAccount(extra: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const json = {
    type: 'service_account',
    project_id: 'mirobe-test',
    private_key_id: 'kid1',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    client_email: 'push@mirobe-test.iam.gserviceaccount.com',
    token_uri: 'https://oauth2.googleapis.com/token',
    ...extra,
  };
  return { publicKey, json, base64: Buffer.from(JSON.stringify(json)).toString('base64') };
}

interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * A fetch standing in for Google: the token endpoint hands out at-1, at-2, …; the send endpoint
 * answers per device token (200 unless told otherwise) or through `onSend`.
 */
function fakeGoogle(options: { expiresIn?: number; answers?: Record<string, () => Response>; onSend?: (request: Recorded) => Response | undefined } = {}) {
  const tokenRequests: Recorded[] = [];
  const sendRequests: Recorded[] = [];
  let issued = 0;
  const fetchStub: typeof fetch = async (input, init) => {
    const url = String(input);
    const request: Recorded = { url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: String(init?.body ?? '') };
    if (url === TOKEN_URL) {
      tokenRequests.push(request);
      await new Promise((resolve) => setTimeout(resolve, 5));
      issued += 1;
      return json(200, { access_token: `at-${issued}`, expires_in: options.expiresIn ?? 3599, token_type: 'Bearer' });
    }
    sendRequests.push(request);
    const custom = options.onSend?.(request);
    if (custom) return custom;
    const token = (JSON.parse(request.body) as { message: { token: string } }).message.token;
    return options.answers?.[token]?.() ?? json(200, { name: `projects/mirobe-test/messages/${sendRequests.length}` });
  };
  return { fetch: fetchStub, tokenRequests, sendRequests };
}

const options = (fetchStub: typeof fetch, extra: FcmOptions = {}): FcmOptions => ({ fetch: fetchStub, tokenUrl: TOKEN_URL, sendBase: SEND_BASE, ...extra });
const note = (token: string, extra: Partial<FcmNotification> = {}): FcmNotification => ({ token, title: 'T', body: 'B', data: { kind: 'purchase', url: 'mirobe:///profile' }, ...extra });

const unregistered = () =>
  json(404, {
    error: {
      code: 404,
      message: 'Requested entity was not found.',
      status: 'NOT_FOUND',
      details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }],
    },
  });
const invalidToken = () =>
  json(400, {
    error: {
      code: 400,
      message: 'The registration token is not a valid FCM registration token',
      status: 'INVALID_ARGUMENT',
      details: [
        { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'INVALID_ARGUMENT' },
        { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.token', description: 'Invalid registration token' }] },
      ],
    },
  });

describe('FCM client', () => {
  test('signs an RS256 assertion the service account key verifies and exchanges it for an access token', async () => {
    const account = serviceAccount();
    const google = fakeGoogle();
    const sender = createFcmSender(loadConfig({ fcmServiceAccount: account.base64 }), options(google.fetch));
    assert.ok(sender);
    assert.deepEqual(await sender.send(note('fcm-token-1')), { status: 200 });

    assert.equal(google.tokenRequests.length, 1);
    const [tokenRequest] = google.tokenRequests;
    assert.equal(tokenRequest.headers['content-type'], 'application/x-www-form-urlencoded');
    const form = new URLSearchParams(tokenRequest.body);
    assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header, claims, signature] = form.get('assertion')!.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
    const parsed = JSON.parse(Buffer.from(claims, 'base64url').toString()) as Record<string, unknown>;
    assert.equal(parsed.iss, account.json.client_email);
    assert.equal(parsed.scope, FCM_SCOPE);
    assert.equal(parsed.aud, 'https://oauth2.googleapis.com/token');
    assert.ok(Math.abs((parsed.iat as number) - Date.now() / 1000) < 60);
    assert.equal(parsed.exp, (parsed.iat as number) + 3600);
    assert.ok(crypto.verify('sha256', Buffer.from(`${header}.${claims}`), account.publicKey, Buffer.from(signature, 'base64url')));
  });

  test('posts the v1 message to the project with the bearer token', async () => {
    const google = fakeGoogle();
    const sender = createFcmSender(loadConfig({ fcmServiceAccount: serviceAccount().base64 }), options(google.fetch))!;
    await sender.send(note('fcm-token-1', { collapseId: 'mirobe-subscription', ttlSeconds: 3600, channelId: 'payments' }));
    await sender.send(note('fcm-token-2'));

    const [first, second] = google.sendRequests;
    assert.equal(first.url, `${SEND_BASE}/v1/projects/mirobe-test/messages:send`);
    assert.equal(first.headers.authorization, 'Bearer at-1');
    assert.equal(first.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(first.body), {
      message: {
        token: 'fcm-token-1',
        notification: { title: 'T', body: 'B' },
        data: { kind: 'purchase', url: 'mirobe:///profile' },
        android: {
          priority: 'HIGH',
          ttl: '3600s',
          collapse_key: 'mirobe-subscription',
          notification: { channel_id: 'payments', tag: 'mirobe-subscription', sound: 'default' },
        },
      },
    });
    // No collapse id or channel: neither is sent; the TTL defaults to a day.
    assert.deepEqual(JSON.parse(second.body).message.android, { priority: 'HIGH', ttl: '86400s', notification: { sound: 'default' } });
  });

  test('FCM_PROJECT_ID overrides the project, raw JSON is accepted too', async () => {
    const google = fakeGoogle();
    const account = serviceAccount();
    const sender = createFcmSender(loadConfig({ fcmServiceAccount: JSON.stringify(account.json), fcmProjectId: 'other-project' }), options(google.fetch))!;
    await sender.send(note('fcm-token-1'));
    assert.equal(google.sendRequests[0].url, `${SEND_BASE}/v1/projects/other-project/messages:send`);
  });

  test('the access token is cached, shared by concurrent sends and refreshed near its expiry', async () => {
    const google = fakeGoogle();
    const sender = createFcmSender(loadConfig({ fcmServiceAccount: serviceAccount().base64 }), options(google.fetch))!;
    await Promise.all([sender.send(note('a-token')), sender.send(note('b-token')), sender.send(note('c-token'))]);
    await sender.send(note('d-token'));
    assert.equal(google.tokenRequests.length, 1);
    assert.deepEqual(new Set(google.sendRequests.map((r) => r.headers.authorization)), new Set(['Bearer at-1']));

    // A token that lives only five minutes is already due for renewal on the next send.
    const shortLived = fakeGoogle({ expiresIn: 300 });
    const renewing = createFcmSender(loadConfig({ fcmServiceAccount: serviceAccount().base64 }), options(shortLived.fetch))!;
    await renewing.send(note('a-token'));
    await renewing.send(note('b-token'));
    assert.equal(shortLived.tokenRequests.length, 2);
    assert.deepEqual(shortLived.sendRequests.map((r) => r.headers.authorization), ['Bearer at-1', 'Bearer at-2']);
  });

  test('a 401 drops the access token and retries once with a new one', async () => {
    let rejectFirst = true;
    const google = fakeGoogle({
      onSend: () => {
        if (!rejectFirst) return undefined;
        rejectFirst = false;
        return json(401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } });
      },
    });
    const sender = createFcmSender(loadConfig({ fcmServiceAccount: serviceAccount().base64 }), options(google.fetch))!;
    assert.deepEqual(await sender.send(note('a-token')), { status: 200 });
    assert.deepEqual(google.sendRequests.map((r) => r.headers.authorization), ['Bearer at-1', 'Bearer at-2']);
    await sender.send(note('b-token'));
    assert.equal(google.tokenRequests.length, 2);
  });

  test('reads FCM errors: dead tokens and the rest', async () => {
    const google = fakeGoogle({
      answers: {
        gone: unregistered,
        invalid: invalidToken,
        throttled: () => json(429, { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'QUOTA_EXCEEDED' }] } }),
        broken: () => new Response('<html>oops</html>', { status: 500 }),
        payload: () => json(400, { error: { code: 400, message: 'Invalid value at message.android.ttl', status: 'INVALID_ARGUMENT' } }),
      },
    });
    const sender = createFcmSender(loadConfig({ fcmServiceAccount: serviceAccount().base64 }), options(google.fetch))!;
    const gone = await sender.send(note('gone'));
    assert.equal(gone.status, 404);
    assert.equal(gone.errorCode, 'UNREGISTERED');
    assert.ok(isDeadFcmToken(gone));
    const invalid = await sender.send(note('invalid'));
    assert.deepEqual(invalid, { status: 400, reason: 'The registration token is not a valid FCM registration token', errorCode: 'INVALID_ARGUMENT', invalidFields: ['message.token'] });
    assert.ok(isDeadFcmToken(invalid));
    for (const token of ['throttled', 'broken', 'payload']) assert.equal(isDeadFcmToken(await sender.send(note(token))), false, token);
    assert.deepEqual(await sender.send(note('broken')), { status: 500, reason: '<html>oops</html>' });
    assert.equal(isDeadFcmToken({ status: 200, errorCode: 'UNREGISTERED' }), true);
    assert.equal(isDeadFcmToken({ status: 403, errorCode: 'SENDER_ID_MISMATCH' }), false);
  });

  test('a rejected or hanging fetch comes back as status 0, never a throw', async () => {
    const account = serviceAccount().base64;
    const failing = createFcmSender(loadConfig({ fcmServiceAccount: account }), options(async () => Promise.reject(new TypeError('fetch failed'))))!;
    assert.deepEqual(await failing.send(note('a-token')), { status: 0, reason: 'fetch failed' });

    // The token endpoint answers, the send never does.
    const google = fakeGoogle();
    const hanging: typeof fetch = (input, init) =>
      String(input) === TOKEN_URL
        ? google.fetch(input, init)
        : new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    const slow = createFcmSender(loadConfig({ fcmServiceAccount: account }), options(hanging, { timeoutMs: 100 }))!;
    assert.deepEqual(await slow.send(note('a-token')), { status: 0, reason: 'Timeout' });

    // A token endpoint that refuses the assertion.
    const refused = createFcmSender(loadConfig({ fcmServiceAccount: account }), options(async () => json(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' })))!;
    assert.deepEqual(await refused.send(note('a-token')), { status: 0, reason: 'OAuth token 400: Invalid JWT Signature.' });
  });

  test('stays off without a service account, or with an unusable one', () => {
    const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const b64 = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');
    const { json: valid } = serviceAccount();
    assert.equal(createFcmSender(loadConfig({ fcmServiceAccount: undefined })), null);
    assert.equal(createFcmSender(loadConfig({ fcmServiceAccount: 'bm90IGpzb24=' })), null);
    assert.equal(createFcmSender(loadConfig({ fcmServiceAccount: '%%% garbage %%%' })), null);
    assert.equal(createFcmSender(loadConfig({ fcmServiceAccount: b64({ ...valid, private_key: 'nope' }) })), null);
    assert.equal(createFcmSender(loadConfig({ fcmServiceAccount: b64({ ...valid, private_key: ec }) })), null);
    assert.equal(createFcmSender(loadConfig({ fcmServiceAccount: b64({ ...valid, client_email: undefined }) })), null);
    assert.equal(createFcmSender(loadConfig({ fcmServiceAccount: b64({ ...valid, project_id: undefined }) })), null);
    assert.ok(createFcmSender(loadConfig({ fcmServiceAccount: b64({ ...valid, project_id: undefined }), fcmProjectId: 'set-here' })));
  });
});

describe('pushToUser across platforms', () => {
  const IOS = 'a'.repeat(64);
  const ANDROID_TR = 'fcm:android-tr';
  const ANDROID_EN = 'fcm:android-en';
  const tokenCount = (db: Db, token: string) => (db.prepare('SELECT COUNT(*) AS n FROM push_tokens WHERE token = ?').get(token) as { n: number }).n;
  const compose = (lang: 'tr' | 'en'): PushMessage => ({
    title: lang === 'en' ? 'Payment received' : 'Ödemen alındı',
    body: lang,
    url: 'mirobe:///profile',
    kind: 'purchase',
    collapseId: 'mirobe-subscription',
    ttlSeconds: 60,
  });

  function setup() {
    const db = openDb(':memory:');
    db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('u1', '2026-01-01');
    savePushToken(db, 'u1', { token: IOS, platform: 'ios', environment: 'production', lang: 'tr' });
    savePushToken(db, 'u1', { token: ANDROID_TR, platform: 'android', environment: 'production', lang: 'tr' });
    savePushToken(db, 'u1', { token: ANDROID_EN, platform: 'android', environment: 'production', lang: 'en' });
    return db;
  }
  function stubApns() {
    const sent: ApnsNotification[] = [];
    const sender: PushSender = {
      async send(notification) {
        sent.push(notification);
        return { status: 200 };
      },
    };
    return { sender, sent };
  }
  function stubFcm(answers: Record<string, FcmResult | Error> = {}) {
    const sent: FcmNotification[] = [];
    const sender: FcmSender = {
      async send(notification) {
        sent.push(notification);
        const answer = answers[notification.token];
        if (answer instanceof Error) throw answer;
        return answer ?? { status: 200 };
      },
    };
    return { sender, sent };
  }

  test('iOS goes through APNs, Android through FCM, each in its own language', async () => {
    const db = setup();
    const apns = stubApns();
    const fcm = stubFcm();
    assert.deepEqual(await pushToUser(db, apns.sender, 'u1', compose, fcm.sender), { sent: 3, removed: 0 });
    assert.deepEqual(apns.sent.map((n) => n.token), [IOS]);
    assert.deepEqual(
      fcm.sent.map((n) => [n.token, n.title]).sort(),
      [[ANDROID_EN, 'Payment received'], [ANDROID_TR, 'Ödemen alındı']].sort()
    );
    const en = fcm.sent.find((n) => n.token === ANDROID_EN)!;
    assert.deepEqual(en, { token: ANDROID_EN, title: 'Payment received', body: 'en', data: { kind: 'purchase', url: 'mirobe:///profile' }, collapseId: 'mirobe-subscription', ttlSeconds: 60, channelId: 'mirobe' });
  });

  test('dead Android tokens are deleted; throttling, server errors and throws keep them', async () => {
    const db = setup();
    savePushToken(db, 'u1', { token: 'fcm:throttled', platform: 'android', environment: 'production', lang: 'tr' });
    savePushToken(db, 'u1', { token: 'fcm:server-error', platform: 'android', environment: 'production', lang: 'tr' });
    savePushToken(db, 'u1', { token: 'fcm:throws', platform: 'android', environment: 'production', lang: 'tr' });
    const fcm = stubFcm({
      [ANDROID_TR]: { status: 404, reason: 'Requested entity was not found.', errorCode: 'UNREGISTERED' },
      [ANDROID_EN]: { status: 400, reason: 'The registration token is not a valid FCM registration token', errorCode: 'INVALID_ARGUMENT', invalidFields: ['message.token'] },
      'fcm:throttled': { status: 429, errorCode: 'QUOTA_EXCEEDED' },
      'fcm:server-error': { status: 500, errorCode: 'INTERNAL' },
      'fcm:throws': new Error('boom'),
    });
    const apns = stubApns();
    assert.deepEqual(await pushToUser(db, apns.sender, 'u1', compose, fcm.sender), { sent: 1, removed: 2 });
    assert.equal(tokenCount(db, ANDROID_TR), 0);
    assert.equal(tokenCount(db, ANDROID_EN), 0);
    for (const token of ['fcm:throttled', 'fcm:server-error', 'fcm:throws', IOS]) assert.equal(tokenCount(db, token), 1, token);
  });

  test('end to end with the real FCM client: a 404 deletes the token, a timeout keeps it', async () => {
    const db = setup();
    const google = fakeGoogle({ answers: { [ANDROID_TR]: unregistered } });
    const hangingFor = (token: string): typeof fetch => (input, init) =>
      String(input) !== TOKEN_URL && String(init?.body).includes(token)
        ? new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
        : google.fetch(input, init);
    const fcm = createFcmSender(loadConfig({ fcmServiceAccount: serviceAccount().base64 }), options(hangingFor(ANDROID_EN), { timeoutMs: 100 }))!;
    assert.deepEqual(await pushToUser(db, null, 'u1', compose, fcm), { sent: 0, removed: 1 });
    assert.equal(tokenCount(db, ANDROID_TR), 0);
    assert.equal(tokenCount(db, ANDROID_EN), 1);
    assert.equal(tokenCount(db, IOS), 1);
  });

  test('a platform without a sender is skipped, the other still receives', async () => {
    const db = setup();
    const apns = stubApns();
    assert.deepEqual(await pushToUser(db, apns.sender, 'u1', compose, createFcmSender(loadConfig({ fcmServiceAccount: 'garbage' }))), { sent: 1, removed: 0 });
    assert.deepEqual(apns.sent.map((n) => n.token), [IOS]);
    const fcm = stubFcm();
    assert.deepEqual(await pushToUser(db, null, 'u1', compose, fcm.sender), { sent: 2, removed: 0 });
    assert.deepEqual(await pushToUser(db, undefined, 'u1', compose), { sent: 0, removed: 0 });
    for (const token of [IOS, ANDROID_TR, ANDROID_EN]) assert.equal(tokenCount(db, token), 1);
  });
});
