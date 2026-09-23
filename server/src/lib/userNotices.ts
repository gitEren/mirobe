import crypto from 'node:crypto';
import type { PlanId, UserNotice, UserNoticeKind } from '@mirobe/shared';
import { transaction, type Db } from '../db/index';

type PaidPlan = Exclude<PlanId, 'free'>;

/** A notice not shown within this long no longer says anything new: it is not listed, and pruned. */
const NOTICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Unseen notices listed per GET /api/me. */
export const MAX_NOTICES = 5;

/**
 * Leaves a notice for the app to show the next time it opens. A newer notice of the same kind
 * replaces an unseen older one, so the app never says the same thing twice in a row.
 */
export function addNotice(db: Db, userId: string, kind: UserNoticeKind, plan: PaidPlan | null, now = new Date()) {
  transaction(db, () => {
    pruneNotices(db, now.getTime());
    withdrawNotices(db, userId, kind);
    db.prepare('INSERT INTO user_notices (id, user_id, kind, plan, created_at) VALUES (?, ?, ?, ?, ?)').run(
      `ntc_${crypto.randomUUID()}`,
      userId,
      kind,
      plan,
      now.toISOString()
    );
  });
}

/**
 * Deletes every notice past its 30 days, seen or not: the privacy policy promises they are kept
 * no longer. Runs before a notice is added and with the server's periodic sweep.
 */
export function pruneNotices(db: Db, now = Date.now()) {
  db.prepare('DELETE FROM user_notices WHERE created_at < ?').run(new Date(now - NOTICE_TTL_MS).toISOString());
}

/** Drops the user's unseen notices of a kind that no longer holds (auto-renew switched off again, …). */
export function withdrawNotices(db: Db, userId: string, kind: UserNoticeKind) {
  db.prepare('DELETE FROM user_notices WHERE user_id = ? AND kind = ? AND seen_at IS NULL').run(userId, kind);
}

/** The user's unseen notices, newest first. */
export function unseenNotices(db: Db, userId: string, now = Date.now()): UserNotice[] {
  const rows = db
    .prepare('SELECT id, kind, plan FROM user_notices WHERE user_id = ? AND seen_at IS NULL AND created_at >= ? ORDER BY created_at DESC, id LIMIT ?')
    .all(userId, new Date(now - NOTICE_TTL_MS).toISOString(), MAX_NOTICES) as { id: string; kind: UserNoticeKind; plan: PaidPlan | null }[];
  return rows.map((row) => (row.plan ? { id: row.id, kind: row.kind, plan: row.plan } : { id: row.id, kind: row.kind }));
}

/** Marks one of the user's own notices as shown (again is fine). False when the user has no notice with this id. */
export function markNoticeSeen(db: Db, userId: string, id: string, now = new Date()): boolean {
  const result = db.prepare('UPDATE user_notices SET seen_at = COALESCE(seen_at, ?) WHERE id = ? AND user_id = ?').run(now.toISOString(), id, userId);
  return Number(result.changes) > 0;
}
