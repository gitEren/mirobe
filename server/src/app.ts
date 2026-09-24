import crypto from 'node:crypto';
import express, { type RequestHandler } from 'express';
import { z } from 'zod';
import {
  AiConsentSchema,
  DeleteAccountSchema,
  LIVE_MAX_SESSION_SECONDS,
  LoginSchema,
  PLANS,
  RegisterSchema,
  ROW_SCHEMAS,
  SYNC_TABLES,
  SyncPushSchema,
  type GarmentRow,
  type PlanId,
  type LiveStartResponse,
  type MeResponse,
  type SyncPullResult,
  type SyncPushResult,
  type SyncTable,
  type TryOnRow,
} from '@mirobe/shared';
import type { Config } from './config';
import { transaction, type Db } from './db/index';
import { getRow, listRows, patchRow, pullSince, upsertRow } from './db/rows';
import { createAnonymousUser, deleteAccount, loginUser, optionalAuth, registerUser, requireAccount, requireAuth, revokeToken } from './lib/auth';
import { aiConsentGiven, requireAiConsent, setAiConsent } from './lib/consent';
import { resolvePlan } from './lib/entitlements';
import { jpegOrientation } from './lib/exif';
import { errorHandler, HttpError, route } from './lib/http';
import { clientIp, RateLimiter } from './lib/rateLimit';
import { decodeDataUrl, MediaStorage } from './lib/storage';
import { UsageLedger } from './lib/usage';
import { markNoticeSeen, unseenNotices } from './lib/userNotices';
import { renderCutout, tagGarment } from './ai/tagging';
import { jevDecision } from './ai/stylist';
import { stylistChat } from './ai/stylistChat';
import { renderTryOn, tryOnCacheKey } from './ai/tryon';
import { createRealtimeToken, uploadToFal } from './ai/fal';
import { checkMotionClipJob, startMotionClip } from './ai/video';
import { createApnsSender, type PushSender } from './lib/apns';
import { createFcmSender, type FcmSender } from './lib/fcm';
import { billingRoutes } from './routes/billing';
import { legalRoutes } from './routes/legal';
import { pushRoutes } from './routes/push';
import { reportRoutes } from './routes/reports';

const LangSchema = z.enum(['tr', 'en']).default('tr');

/** A tagging/packshot claim older than this is a lost request and may be claimed again. */
export const JOB_IN_FLIGHT_MS = 3 * 60 * 1000;
/** Jobs still 'processing' after this long are failed and refunded by the sweep. */
export const STALE_JOB_MS = 10 * 60 * 1000;
/** A motion clip that has not finished after this long is failed and refunded. */
export const VIDEO_MAX_AGE_MS = 15 * 60 * 1000;

const isStale = (row: { updatedAt: string }, ageMs: number, now = Date.now()) => now - Date.parse(row.updatedAt) >= ageMs;

export interface AppContext {
  db: Db;
  config: Config;
  media: MediaStorage;
  usage: UsageLedger;
  /** Push sender; defaults to APNs from the config (null when it is not configured). Overridable for tests. */
  push?: PushSender | null;
  /** Android push sender; defaults to FCM from the config (null when it is not configured). Overridable for tests. */
  fcm?: FcmSender | null;
}

export function createApp(ctx: AppContext) {
  const { db, config, media, usage } = ctx;
  const push = ctx.push === undefined ? createApnsSender(config) : ctx.push;
  const fcm = ctx.fcm === undefined ? createFcmSender(config) : ctx.fcm;
  /** Renders in flight by cache key, so identical concurrent requests share one paid generation. */
  const rendering = new Map<string, Promise<TryOnRow>>();
  const app = express();
  const auth = requireAuth(db);
  const maybeAuth = optionalAuth(db);
  /**
   * Every paid AI endpoint: a registered account that allowed AI processing, checked in this
   * order before quota or provider calls (an anonymous user is told to sign in first).
   */
  const ai: RequestHandler[] = [auth, requireAccount, requireAiConsent(db)];
  const attemptsByIp = new RateLimiter(config.authRateLimit, config.authRateWindowMs);
  const attemptsByEmail = new RateLimiter(config.authRateLimit, config.authRateWindowMs);
  const limitAttempt = (limiter: RateLimiter, key: string) => {
    if (!limiter.attempt(key)) throw new HttpError(429, 'Too many attempts. Try again later.', 'RATE_LIMITED');
  };

  app.disable('x-powered-by');
  app.use(express.json({ limit: '20mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      providers: { openrouter: Boolean(config.openRouterKey), fal: Boolean(config.falKey), revenuecat: Boolean(config.revenueCatSecret) },
    });
  });

  app.use(
    '/media',
    express.static(media.dir, { immutable: true, maxAge: '365d', index: false, fallthrough: false })
  );

  // -------------------------------------------------------------------------
  // Auth & account
  // -------------------------------------------------------------------------
  app.post('/api/auth/anonymous', (_req, res) => {
    res.status(201).json(createAnonymousUser(db));
  });

  // Registering while signed in anonymously upgrades that same user (wardrobe kept).
  app.post(
    '/api/auth/register',
    maybeAuth,
    route(async (req, res) => {
      limitAttempt(attemptsByIp, clientIp(req));
      const input = RegisterSchema.parse(req.body);
      limitAttempt(attemptsByEmail, input.email);
      const caller = req.userId ? { userId: req.userId, email: req.userEmail } : undefined;
      res.status(201).json(await registerUser(db, input, caller));
    })
  );

  app.post(
    '/api/auth/login',
    maybeAuth,
    route(async (req, res) => {
      limitAttempt(attemptsByIp, clientIp(req));
      const input = LoginSchema.parse(req.body);
      limitAttempt(attemptsByEmail, input.email);
      const caller = req.userId ? { userId: req.userId, email: req.userEmail } : undefined;
      res.json(await loginUser(db, input, caller));
    })
  );

  app.post(
    '/api/auth/logout',
    auth,
    route((req, res) => {
      revokeToken(db, req.tokenHash);
      res.json({ ok: true });
    })
  );

  app.get(
    '/api/me',
    auth,
    route(async (req, res) => {
      const plan = await resolvePlan(db, config, req.userId, req.query.refresh === '1');
      const me: MeResponse = {
        userId: req.userId,
        email: req.userEmail,
        isAnonymous: !req.userEmail,
        usage: usage.snapshot(req.userId, plan),
        notices: unseenNotices(db, req.userId),
        aiConsent: aiConsentGiven(db, req.userId),
      };
      res.json(me);
    })
  );

  // Consent to AI processing (App Store 5.1.2(i)): the app asks before the first AI action,
  // Profile withdraws or gives it again. Until it is given every AI route answers AI_CONSENT_REQUIRED.
  app.post(
    '/api/me/ai-consent',
    auth,
    route((req, res) => {
      const { granted } = AiConsentSchema.parse(req.body ?? {});
      res.json({ aiConsent: setAiConsent(db, req.userId, granted) });
    })
  );

  // The app shows each in-app notice listed by /api/me once, then marks it seen.
  app.post(
    '/api/notices/:id/seen',
    auth,
    route((req, res) => {
      if (!markNoticeSeen(db, req.userId, String(req.params.id))) throw new HttpError(404, 'Notice not found');
      res.json({ ok: true });
    })
  );

  // In-app account deletion (App Store 5.1.1(v)): rows go in one transaction, media files after the commit.
  app.delete(
    '/api/me',
    auth,
    route(async (req, res) => {
      const { password } = DeleteAccountSchema.parse(req.body ?? {});
      if (req.userEmail) limitAttempt(attemptsByIp, clientIp(req));
      media.removeFiles(await deleteAccount(db, { userId: req.userId, email: req.userEmail }, password));
      res.json({ ok: true });
    })
  );

  // -------------------------------------------------------------------------
  // Media
  // -------------------------------------------------------------------------
  app.post(
    '/api/media',
    auth,
    route((req, res) => {
      const { dataUrl } = z.object({ dataUrl: z.string().min(32) }).parse(req.body);
      const { buffer, mimeType } = decodeDataUrl(dataUrl);
      if (!mimeType.startsWith('image/')) throw new HttpError(415, 'Only images can be uploaded');
      // The app uploads upright pixels; a rotation left in EXIF would reach the AI models sideways.
      const orientation = mimeType === 'image/jpeg' ? jpegOrientation(buffer) : null;
      if (orientation && orientation !== 1) console.warn(`[mirobe] upload with EXIF orientation ${orientation}: an app build that does not bake orientation`);
      const stored = media.save(req.userId, buffer, mimeType);
      res.status(201).json({ id: stored.id, url: stored.url });
    })
  );

  // -------------------------------------------------------------------------
  // Sync: push client rows (LWW), pull by global server sequence.
  // -------------------------------------------------------------------------
  app.post(
    '/api/sync/push',
    auth,
    route((req, res) => {
      const { changes } = SyncPushSchema.parse(req.body);
      const result: SyncPushResult = { accepted: 0, rejected: [], cursor: 0 };
      for (const change of changes) {
        const row = ROW_SCHEMAS[change.table].parse(change.row);
        const outcome = upsertRow(db, change.table, req.userId, row as never);
        if (outcome.applied) result.accepted += 1;
        else result.rejected.push({ table: change.table, row: outcome.stored });
        result.cursor = Math.max(result.cursor, outcome.seq);
      }
      res.json(result);
    })
  );

  app.get(
    '/api/sync/pull',
    auth,
    route((req, res) => {
      const since = Math.max(0, Number(req.query.since) || 0);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
      const merged = SYNC_TABLES.flatMap((table) =>
        // limit + 1 per table: a single table with more than `limit` rows must still report hasMore.
        pullSince(db, table, req.userId, since, limit + 1).map((entry) => ({ table, ...entry }))
      ).sort((a, b) => a.seq - b.seq);
      const page = merged.slice(0, limit);
      const result: SyncPullResult = {
        cursor: page.length ? page[page.length - 1].seq : since,
        hasMore: merged.length > limit,
        changes: { garments: [], looks: [], avatars: [], tryons: [] },
      };
      for (const entry of page) (result.changes[entry.table as SyncTable] as unknown[]).push(entry.row);
      res.json(result);
    })
  );

  // -------------------------------------------------------------------------
  // Garment analysis: AI tags. The cutout is made on-device (original pixels);
  // the AI packshot is a separate, optional call.
  // -------------------------------------------------------------------------
  /**
   * Claims a packshot: re-reads the garment, reserves and marks it processing in one
   * transaction (no await in between), so parallel taps or devices charge once.
   * A claim left 'processing' past the in-flight window (a lost request) can be retried.
   */
  const claimPackshot = (userId: string, plan: PlanId, id: string) =>
    transaction(db, () => {
      const current = getRow(db, 'garments', userId, id);
      if (!current || current.deletedAt) throw new HttpError(404, 'Garment not found');
      if (current.packshotStatus === 'processing' && !isStale(current, JOB_IN_FLIGHT_MS)) return { garment: current, reservation: null };
      const reservation = usage.reserve(userId, plan, 'images', `packshot:${id}`);
      return { garment: patchRow(db, 'garments', userId, id, { packshotStatus: 'processing' }), reservation };
    });

  const renderPackshot = async (userId: string, garment: GarmentRow, reservation: string) => {
    try {
      // A tagged piece brings its tags (colours with hex, pattern, details…) as hard constraints.
      const facts = garment.taggingStatus === 'ready' ? garment : undefined;
      const result = await renderCutout(config, media.readAsDataUrl(userId, garment.imageUrl), garment.source, facts);
      console.info(`[mirobe] packshot rendered, cost $${result.costUsd ?? '?'}`);
      const url = media.saveDataUrl(userId, result.dataUrl).url;
      return patchRow(db, 'garments', userId, garment.id, { packshotUrl: url, packshotStatus: 'ready' });
    } catch (error) {
      usage.refund(reservation);
      patchRow(db, 'garments', userId, garment.id, { packshotStatus: 'failed' });
      throw error;
    }
  };

  app.post(
    '/api/garments/:id/analyze',
    ...ai,
    route(async (req, res) => {
      const { lang } = z.object({ lang: LangSchema }).parse(req.body ?? {});
      const userId = req.userId;
      const id = String(req.params.id);
      const existing = getRow(db, 'garments', userId, id);
      if (!existing || existing.deletedAt) throw new HttpError(404, 'Garment not found');
      const plan = await resolvePlan(db, config, userId);
      // Re-read and claim after the await, in one transaction: another device (or a
      // retry) already analysing this garment must not be charged twice.
      const claim = transaction(db, () => {
        const current = getRow(db, 'garments', userId, id);
        if (!current || current.deletedAt) throw new HttpError(404, 'Garment not found');
        if (current.taggingStatus === 'processing' && !isStale(current, JOB_IN_FLIGHT_MS)) return { garment: current, reservation: null };
        const reservation = usage.reserve(userId, plan, 'taggings', `tag:${id}`);
        return { garment: patchRow(db, 'garments', userId, id, { taggingStatus: 'processing' }), reservation };
      });
      if (!claim.reservation) return res.status(202).json({ garment: claim.garment, usage: usage.snapshot(userId, plan) });
      const { garment, reservation } = claim;

      let warning: string | undefined;
      const patch: Partial<GarmentRow> = {};
      try {
        const { tags, costUsd } = await tagGarment(config, media.readAsDataUrl(userId, garment.imageUrl), { lang, source: garment.source });
        console.info(`[mirobe] tagged ${id}, cost $${costUsd ?? '?'}`);
        if (!tags.isGarment) {
          patch.taggingStatus = 'failed';
          patch.description = lang === 'tr' ? 'Fotoğrafta bir kıyafet bulunamadı.' : 'No garment found in the photo.';
        } else {
          const { isGarment: _ignored, onPerson, ...fields } = tags;
          Object.assign(patch, fields, { taggingStatus: 'ready' });
          // An on-device cutout of a worn garment contains the whole person; drop it.
          // The AI packshot is no longer made here: it is rendered on first request.
          if (onPerson) patch.cutoutUrl = null;
        }
      } catch (error) {
        console.warn('[mirobe] tagging failed:', (error as Error).message);
        usage.refund(reservation);
        patch.taggingStatus = 'failed';
        if ((error as HttpError).code === 'PROVIDER_CREDITS') warning = 'PROVIDER_CREDITS';
      }
      const updated = patchRow(db, 'garments', userId, id, patch);
      res.json({ garment: updated, usage: usage.snapshot(userId, plan), warning });
    })
  );

  app.post(
    '/api/garments/:id/packshot',
    ...ai,
    route(async (req, res) => {
      const id = String(req.params.id);
      const garment = getRow(db, 'garments', req.userId, id);
      if (!garment || garment.deletedAt) throw new HttpError(404, 'Garment not found');
      const plan = await resolvePlan(db, config, req.userId);
      const claim = claimPackshot(req.userId, plan, id);
      if (!claim.reservation) return res.status(202).json({ garment: claim.garment });
      const updated = await renderPackshot(req.userId, claim.garment, claim.reservation);
      res.json({ garment: updated, usage: usage.snapshot(req.userId, plan) });
    })
  );

  // -------------------------------------------------------------------------
  // Stylist (Jev)
  // -------------------------------------------------------------------------
  app.post(
    '/api/stylist/decide',
    ...ai,
    route(async (req, res) => {
      const body = z
        .object({ query: z.string().trim().min(1).max(500), lang: LangSchema, exclude: z.array(z.string()).max(50).default([]) })
        .parse(req.body);
      const plan = await resolvePlan(db, config, req.userId);
      const reservation = usage.reserve(req.userId, plan, 'stylist');
      const garments = listRows(db, 'garments', req.userId);
      const decision = await jevDecision(config, body.query, garments, body.lang, {
        exclude: body.exclude,
        userId: req.userId,
      });
      if (decision.garmentIds.length === 0) usage.refund(reservation);
      res.json({ decision, usage: usage.snapshot(req.userId, plan) });
    })
  );

  app.post(
    '/api/stylist/chat',
    ...ai,
    route(async (req, res) => {
      const body = z
        .object({
          lang: LangSchema,
          messages: z
            .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(1000), garmentIds: z.array(z.string()).max(8).optional() }))
            .min(1)
            .max(20),
        })
        .parse(req.body);
      const plan = await resolvePlan(db, config, req.userId);
      // Every chat turn counts one, small talk included; only a failed reply is refunded.
      const reservation = usage.reserve(req.userId, plan, 'stylist');
      const result = await stylistChat(config, {
        messages: body.messages,
        lang: body.lang,
        garments: listRows(db, 'garments', req.userId),
        userId: req.userId,
      }).catch((error) => {
        usage.refund(reservation);
        throw error;
      });
      res.json({ ...result, usage: usage.snapshot(req.userId, plan) });
    })
  );

  // -------------------------------------------------------------------------
  // Photo try-on (cached per avatar + outfit) and motion clips
  // -------------------------------------------------------------------------
  app.post(
    '/api/tryons',
    ...ai,
    route(async (req, res) => {
      const body = z
        .object({ garmentIds: z.array(z.string()).min(1).max(6), avatarId: z.string().optional(), personImageUrl: z.string().max(200).optional() })
        .parse(req.body);
      const userId = req.userId;
      // A live camera frame (uploaded just before) takes precedence over the saved mirror photo.
      const avatar = body.personImageUrl
        ? null
        : body.avatarId
          ? getRow(db, 'avatars', userId, body.avatarId)
          : listRows(db, 'avatars', userId).find((a) => a.isActive);
      if (!body.personImageUrl && (!avatar || avatar.deletedAt)) throw new HttpError(409, 'Create your mirror photo first', 'AVATAR_REQUIRED');
      const personUrl = body.personImageUrl ?? avatar!.imageUrl;
      const personDataUrl = media.readAsDataUrl(userId, personUrl); // also verifies ownership
      const garments = body.garmentIds.map((id) => getRow(db, 'garments', userId, id));
      if (garments.some((g) => !g || g.deletedAt)) throw new HttpError(404, 'Garment not found');
      const garmentIds = [...new Set(body.garmentIds)];
      const cacheKey = tryOnCacheKey(avatar?.id ?? personUrl, garmentIds, config.tryonModel);
      const plan = await resolvePlan(db, config, userId);

      const cached = db
        .prepare("SELECT data FROM tryons WHERE user_id = ? AND cache_key = ? AND deleted_at IS NULL")
        .all(userId, cacheKey)
        .map((r: any) => ROW_SCHEMAS.tryons.parse(JSON.parse(r.data)))
        .find((t) => t.status === 'ready');
      if (cached) {
        // Re-using a render is still a fresh attempt: re-stamping it moves it to the top of "recent try-ons".
        const touched = patchRow(db, 'tryons', userId, cached.id, {});
        return res.json({ tryon: touched, cached: true, usage: usage.snapshot(userId, plan) });
      }
      const inFlight = rendering.get(cacheKey);
      if (inFlight) return res.json({ tryon: await inFlight, cached: true, usage: usage.snapshot(userId, plan) });

      const reservation = usage.reserve(userId, plan, 'images', `tryon:${cacheKey}`);
      const now = new Date().toISOString();
      const tryon: TryOnRow = {
        id: `try_${crypto.randomUUID()}`,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        avatarId: avatar?.id ?? null,
        personUrl,
        garmentIds,
        status: 'processing',
        imageUrl: null,
        videoStatus: 'none',
        videoUrl: null,
        provider: config.tryonModel,
        error: null,
      };
      upsertRow(db, 'tryons', userId, tryon, { extra: { cache_key: cacheKey } });
      const job = (async () => {
        try {
          const result = await renderTryOn(
            config,
            personDataUrl,
            garments.map((row) => ({ row: row!, dataUrl: media.readAsDataUrl(userId, row!.packshotUrl ?? row!.cutoutUrl ?? row!.imageUrl) }))
          );
          const stored = media.saveDataUrl(userId, result.dataUrl);
          console.info(`[mirobe] try-on rendered, cost $${result.costUsd ?? '?'}`);
          return patchRow(db, 'tryons', userId, tryon.id, { status: 'ready', imageUrl: stored.url });
        } catch (error) {
          usage.refund(reservation);
          // The provider's message stays in the server log; clients only see a generic code.
          console.warn('[mirobe] try-on failed:', (error as Error).message);
          patchRow(db, 'tryons', userId, tryon.id, { status: 'failed', error: 'RENDER_FAILED' });
          throw error;
        }
      })();
      rendering.set(cacheKey, job);
      try {
        const ready = await job;
        res.status(201).json({ tryon: ready, cached: false, usage: usage.snapshot(userId, plan) });
      } finally {
        rendering.delete(cacheKey);
      }
    })
  );

  app.get(
    '/api/tryons/:id',
    auth,
    route((req, res) => {
      const tryon = getRow(db, 'tryons', req.userId, String(req.params.id));
      if (!tryon) throw new HttpError(404, 'Try-on not found');
      res.json({ tryon });
    })
  );

  // Try-ons are server-owned rows; deleting leaves a tombstone so every device drops it on the next pull.
  app.delete(
    '/api/tryons/:id',
    auth,
    route((req, res) => {
      const tryon = getRow(db, 'tryons', req.userId, String(req.params.id));
      if (!tryon) throw new HttpError(404, 'Try-on not found');
      res.json({ tryon: tryon.deletedAt ? tryon : patchRow(db, 'tryons', req.userId, tryon.id, { deletedAt: new Date().toISOString() }) });
    })
  );

  app.post(
    '/api/tryons/:id/video',
    ...ai,
    route(async (req, res) => {
      const userId = req.userId;
      const tryon = getRow(db, 'tryons', userId, String(req.params.id));
      if (!tryon || tryon.status !== 'ready' || !tryon.imageUrl) throw new HttpError(404, 'Try-on not ready');
      if (tryon.videoStatus === 'ready' || tryon.videoStatus === 'processing') return res.json({ tryon });
      const plan = await resolvePlan(db, config, userId);
      if (PLANS[plan].videos === 0) throw new HttpError(402, 'Video clips require Pro', 'PLAN_REQUIRED');
      // Claim the clip synchronously (no await between check and write) so repeated taps
      // cannot start several paid generations for the same try-on. A clip counts one video.
      const claim = transaction(db, () => {
        const current = getRow(db, 'tryons', userId, tryon.id)!;
        if (current.videoStatus === 'ready' || current.videoStatus === 'processing') return { current, reservation: null };
        const reservation = usage.reserve(userId, plan, 'videos', `clip:${tryon.id}`);
        return { current: patchRow(db, 'tryons', userId, tryon.id, { videoStatus: 'processing' }), reservation };
      });
      if (!claim.reservation) return res.json({ tryon: claim.current });
      try {
        const job = await startMotionClip(config, media.read(userId, tryon.imageUrl));
        const next = patchRow(db, 'tryons', userId, tryon.id, {}, { video_request_id: `${job}|${claim.reservation}` });
        res.status(202).json({ tryon: next, usage: usage.snapshot(userId, plan) });
      } catch (error) {
        usage.refund(claim.reservation);
        patchRow(db, 'tryons', userId, tryon.id, { videoStatus: 'none' });
        throw error;
      }
    })
  );

  // -------------------------------------------------------------------------
  // Live mirror (fal realtime). Switched off unless LIVE_MIRROR_ENABLED: then every
  // route answers 404 before any auth, plan, quota or provider work. When on, a
  // session counts as one video; its seconds are reserved up-front and settled on stop.
  // -------------------------------------------------------------------------
  app.use('/api/live', (_req, _res, next) => {
    if (!config.liveMirrorEnabled) return next(new HttpError(404, 'The live mirror is switched off', 'FEATURE_DISABLED'));
    next();
  });

  app.post(
    '/api/live/start',
    ...ai,
    route(async (req, res) => {
      const { garmentId } = z.object({ garmentId: z.string() }).parse(req.body);
      const userId = req.userId;
      const garment = getRow(db, 'garments', userId, garmentId);
      if (!garment || garment.deletedAt) throw new HttpError(404, 'Garment not found');
      const plan = await resolvePlan(db, config, userId);
      if (PLANS[plan].videos === 0) throw new HttpError(402, 'Live mirror requires Pro', 'PLAN_REQUIRED');
      const sessionId = usage.reserve(userId, plan, 'videos', `live:${garmentId}`, LIVE_MAX_SESSION_SECONDS);
      try {
        const { buffer, mimeType } = media.read(userId, garment.packshotUrl ?? garment.cutoutUrl ?? garment.imageUrl);
        const [token, referenceImageUrl] = await Promise.all([createRealtimeToken(config), uploadToFal(config, buffer, mimeType)]);
        const slot = garment.category === 'bottom' ? 'bottoms' : garment.category === 'dress' ? 'outfit' : garment.category === 'outerwear' ? 'jacket' : 'top';
        const response: LiveStartResponse = {
          sessionId,
          token,
          app: config.liveApp,
          allowedSeconds: LIVE_MAX_SESSION_SECONDS,
          referenceImageUrl,
          prompt: `Substitute the current ${slot} with the ${garment.name || 'garment'} from the reference image, matching its color, material, print and fit. Preserve the person, face, motion, lighting and background.`,
        };
        res.json(response);
      } catch (error) {
        usage.refund(sessionId);
        throw error;
      }
    })
  );

  // Token refresh during a live session. Only for an open session this user started
  // (a live reservation that has not been stopped or run past its reserved seconds),
  // so a token can never be minted outside a paid, quota-checked /live/start.
  app.post(
    '/api/live/token',
    ...ai,
    route(async (req, res) => {
      const { sessionId } = z.object({ sessionId: z.string().min(1).max(64) }).parse(req.body ?? {});
      const session = usage.liveSession(req.userId, sessionId);
      if (!session) throw new HttpError(403, 'No active live session', 'LIVE_SESSION_REQUIRED');
      if (Date.now() > session.endsAt) throw new HttpError(409, 'Live session has ended', 'LIVE_SESSION_ENDED');
      const plan = await resolvePlan(db, config, req.userId);
      if (PLANS[plan].videos === 0) throw new HttpError(402, 'Live mirror requires Pro', 'PLAN_REQUIRED');
      res.json({ token: await createRealtimeToken(config) });
    })
  );

  app.post(
    '/api/live/stop',
    auth,
    route((req, res) => {
      const { sessionId, usedSeconds } = z.object({ sessionId: z.string(), usedSeconds: z.number().min(0) }).parse(req.body);
      // Recorded: max(client-reported, server-measured since start), capped at the reservation.
      usage.settleLive(req.userId, sessionId, usedSeconds);
      usage.endLive(req.userId, sessionId);
      res.json({ ok: true });
    })
  );

  app.use(billingRoutes({ db, config, usage, auth, requireAccount, push, fcm }));
  app.use(pushRoutes({ db, auth }));
  app.use(reportRoutes({ db, auth, requireAccount }));
  app.use(legalRoutes());

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use(errorHandler);
  return app;
}

/** Fails a clip, refunds its reservation and clears the job so it is not polled again. */
function failClip(ctx: AppContext, row: { id: string; user_id: string }, reservation: string | undefined, reason: string) {
  console.warn(`[mirobe] motion clip ${row.id} failed: ${reason}`);
  transaction(ctx.db, () => {
    if (reservation) ctx.usage.refund(reservation);
    patchRow(ctx.db, 'tryons', row.user_id, row.id, { videoStatus: 'failed', error: 'CLIP_FAILED' }, { video_request_id: null });
  });
}

/**
 * One pass over the motion clips in flight, oldest first. Each row is handled on
 * its own: a provider hiccup or a bad row never blocks the others. Unreachable
 * providers and failed downloads are retried on the next pass (the provider has
 * already charged), until the clip is older than VIDEO_MAX_AGE_MS: then it fails
 * and the user's video is refunded.
 */
export async function pollVideosOnce(ctx: AppContext, now = () => Date.now()) {
  const { db, config, media } = ctx;
  const rows = db
    .prepare('SELECT id, user_id, video_request_id, updated_at FROM tryons WHERE video_request_id IS NOT NULL ORDER BY updated_at, id')
    .all() as { id: string; user_id: string; video_request_id: string; updated_at: string }[];
  for (const row of rows) {
    const [job, reservation] = row.video_request_id.split('|');
    const startedAt = Date.parse((reservation && ctx.usage.reservedAt(reservation)) || row.updated_at);
    const expired = now() - startedAt >= VIDEO_MAX_AGE_MS;
    try {
      const result = await checkMotionClipJob(config, job);
      if (result.status === 'ready') {
        console.info(`[mirobe] motion clip ready, cost $${result.costUsd ?? '?'}`);
        const stored = media.save(row.user_id, result.buffer, 'video/mp4');
        patchRow(db, 'tryons', row.user_id, row.id, { videoStatus: 'ready', videoUrl: stored.url }, { video_request_id: null });
      } else if (result.status === 'failed') {
        failClip(ctx, row, reservation, result.error);
      } else if (expired) {
        failClip(ctx, row, reservation, 'timed out');
      }
    } catch (error) {
      // Transient (provider unreachable, download failed): keep it processing and retry.
      console.warn(`[mirobe] video poller (${row.id}):`, (error as Error).message);
      if (expired) {
        try {
          failClip(ctx, row, reservation, `timed out after errors: ${(error as Error).message}`);
        } catch (inner) {
          console.warn('[mirobe] video poller could not fail clip:', (inner as Error).message);
        }
      }
    }
  }
}

/**
 * Polls the video providers for motion clips in flight and copies finished
 * videos into our storage (provider URLs are not permanent). In-process; one server instance.
 */
export function startVideoPoller(ctx: AppContext, intervalMs = 5000) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await pollVideosOnce(ctx);
    } catch (error) {
      console.warn('[mirobe] video poller:', (error as Error).message);
    } finally {
      busy = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

/**
 * Fails and refunds jobs a lost request left behind (a restart or crash mid-call):
 * try-ons, tagging and packshots still 'processing' after STALE_JOB_MS, and clips
 * marked 'processing' that never got a provider job id. Refunds go by the
 * reservation's ref, limited to reservations made around the time the job started.
 * Run at startup and periodically; returns how many rows were swept.
 */
export function sweepStaleJobs(ctx: AppContext, now = Date.now()) {
  const { db, usage } = ctx;
  const cutoff = new Date(now - STALE_JOB_MS).toISOString();
  // A reservation is made just before its row is marked processing.
  const since = (updatedAt: string) => new Date(Date.parse(updatedAt) - 60_000).toISOString();
  let swept = 0;
  const each = (label: string, fn: () => void) => {
    try {
      fn();
      swept += 1;
    } catch (error) {
      console.warn(`[mirobe] sweep ${label}:`, (error as Error).message);
    }
  };

  const tryons = db
    .prepare("SELECT id, user_id, cache_key, updated_at FROM tryons WHERE json_extract(data, '$.status') = 'processing' AND updated_at < ?")
    .all(cutoff) as { id: string; user_id: string; cache_key: string | null; updated_at: string }[];
  for (const row of tryons) {
    each(`try-on ${row.id}`, () =>
      transaction(db, () => {
        if (row.cache_key) usage.refundByRef(row.user_id, `tryon:${row.cache_key}`, since(row.updated_at));
        patchRow(db, 'tryons', row.user_id, row.id, { status: 'failed', error: 'RENDER_FAILED' });
      })
    );
  }

  const garments = db
    .prepare(
      `SELECT id, user_id, updated_at, json_extract(data, '$.taggingStatus') AS tagging, json_extract(data, '$.packshotStatus') AS packshot
       FROM garments WHERE (json_extract(data, '$.taggingStatus') = 'processing' OR json_extract(data, '$.packshotStatus') = 'processing') AND updated_at < ?`
    )
    .all(cutoff) as { id: string; user_id: string; updated_at: string; tagging: string; packshot: string }[];
  for (const row of garments) {
    each(`garment ${row.id}`, () =>
      transaction(db, () => {
        const patch: Partial<GarmentRow> = {};
        if (row.tagging === 'processing') {
          usage.refundByRef(row.user_id, `tag:${row.id}`, since(row.updated_at));
          patch.taggingStatus = 'failed';
        }
        if (row.packshot === 'processing') {
          usage.refundByRef(row.user_id, `packshot:${row.id}`, since(row.updated_at));
          patch.packshotStatus = 'failed';
        }
        patchRow(db, 'garments', row.user_id, row.id, patch);
      })
    );
  }

  // A clip claimed but never submitted (the submit call is far shorter than this window).
  const clipCutoff = new Date(now - JOB_IN_FLIGHT_MS).toISOString();
  const clips = db
    .prepare("SELECT id, user_id, updated_at FROM tryons WHERE video_request_id IS NULL AND json_extract(data, '$.videoStatus') = 'processing' AND updated_at < ?")
    .all(clipCutoff) as { id: string; user_id: string; updated_at: string }[];
  for (const row of clips) {
    each(`clip ${row.id}`, () =>
      transaction(db, () => {
        usage.refundByRef(row.user_id, `clip:${row.id}`, since(row.updated_at));
        patchRow(db, 'tryons', row.user_id, row.id, { videoStatus: 'failed', error: 'CLIP_FAILED' });
      })
    );
  }
  if (swept) console.warn(`[mirobe] swept ${swept} stale job(s)`);
  return swept;
}
