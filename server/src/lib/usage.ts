import crypto from 'node:crypto';
import { PLANS, type PlanId, type UsageKind, type UsageSnapshot } from '@mirobe/shared';
import { transaction, type Db } from '../db/index';
import { HttpError } from './http';

/** Time to connect (WebRTC + fal handshake) on top of the reserved seconds. */
const LIVE_GRACE_SECONDS = 30;

function periodStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Monthly usage per plan bucket. Every paid action is one event and a refund deletes
 * it, so `used` is the number of events this period. `units` is not counted: it keeps
 * a live session's seconds, and events stored before count-based quotas carry their
 * old unit amount (20 for a try-on) yet still count once.
 */
export class UsageLedger {
  constructor(private db: Db) {}

  used(userId: string, kind: UsageKind): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS used FROM usage_events WHERE user_id = ? AND kind = ? AND created_at >= ?')
      .get(userId, kind, periodStart()) as { used: number };
    return row.used;
  }

  snapshot(userId: string, planId: PlanId): UsageSnapshot {
    const count = (kind: UsageKind) => ({ used: this.used(userId, kind), limit: PLANS[planId][kind] });
    return {
      planId,
      periodStart: periodStart(),
      images: count('images'),
      videos: count('videos'),
      stylist: count('stylist'),
      taggings: count('taggings'),
    };
  }

  remaining(userId: string, planId: PlanId, kind: UsageKind): number {
    return Math.max(0, PLANS[planId][kind] - this.used(userId, kind));
  }

  /**
   * Counts one use up-front so parallel requests cannot overspend. Refund on provider failure.
   * `units` is stored with the event (a live session's reserved seconds), never counted.
   */
  reserve(userId: string, planId: PlanId, kind: UsageKind, ref?: string, units = 1): string {
    return transaction(this.db, () => {
      if (this.remaining(userId, planId, kind) < 1) {
        throw new HttpError(402, 'Plan limit reached for this month', 'QUOTA_EXCEEDED');
      }
      const id = crypto.randomUUID();
      this.db
        .prepare('INSERT INTO usage_events (id, user_id, kind, units, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, userId, kind, units, ref ?? null, new Date().toISOString());
      return id;
    });
  }

  refund(eventId: string) {
    this.db.prepare('DELETE FROM usage_events WHERE id = ?').run(eventId);
  }

  /**
   * Refunds the newest reservation with this ref made at or after `notBefore`
   * (the job it paid for was lost, e.g. by a restart). Returns whether one was found.
   */
  refundByRef(userId: string, ref: string, notBefore: string): boolean {
    const row = this.db
      .prepare('SELECT id FROM usage_events WHERE user_id = ? AND ref = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1')
      .get(userId, ref, notBefore) as { id: string } | undefined;
    if (row) this.refund(row.id);
    return Boolean(row);
  }

  /** When a reservation was made (ISO), or null if it no longer exists. */
  reservedAt(eventId: string): string | null {
    const row = this.db.prepare('SELECT created_at FROM usage_events WHERE id = ?').get(eventId) as { created_at: string } | undefined;
    return row?.created_at ?? null;
  }

  /**
   * An open live-mirror session of this user: its reservation (a video with ref `live:*`)
   * with the time it may run until (reserved seconds + a short grace for connecting), or null.
   */
  liveSession(userId: string, eventId: string): { endsAt: number } | null {
    const row = this.db
      .prepare("SELECT units, created_at FROM usage_events WHERE id = ? AND user_id = ? AND kind = 'videos' AND ref LIKE 'live:%'")
      .get(eventId, userId) as { units: number; created_at: string } | undefined;
    return row ? { endsAt: Date.parse(row.created_at) + (row.units + LIVE_GRACE_SECONDS) * 1000 } : null;
  }

  /** Marks a live session stopped so no further realtime tokens are issued for it. */
  endLive(userId: string, eventId: string) {
    this.db
      .prepare("UPDATE usage_events SET ref = 'live-ended:' || substr(ref, 6) WHERE id = ? AND user_id = ? AND ref LIKE 'live:%'")
      .run(eventId, userId);
  }

  /** Settles a reservation's seconds to what was actually consumed (live sessions). */
  settle(userId: string, eventId: string, units: number) {
    this.db.prepare('UPDATE usage_events SET units = MIN(units, ?) WHERE id = ? AND user_id = ?').run(
      Math.max(0, Math.ceil(units)),
      eventId,
      userId
    );
  }

  /**
   * Settles a live session's seconds: the larger of what the client reports and the
   * time the server saw pass since /live/start, never more than was reserved, so an
   * under-reporting client cannot shorten the record. The session counts as one
   * video either way; `units` keeps how long it ran.
   */
  settleLive(userId: string, eventId: string, clientSeconds: number, now = Date.now()): number | null {
    const row = this.db
      .prepare("SELECT units, created_at FROM usage_events WHERE id = ? AND user_id = ? AND kind = 'videos' AND (ref LIKE 'live:%' OR ref LIKE 'live-ended:%')")
      .get(eventId, userId) as { units: number; created_at: string } | undefined;
    if (!row) return null;
    const elapsed = Math.max(0, (now - Date.parse(row.created_at)) / 1000);
    const used = Math.min(row.units, Math.ceil(Math.max(clientSeconds, elapsed)));
    this.settle(userId, eventId, used);
    return used;
  }
}
