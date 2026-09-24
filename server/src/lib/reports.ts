import crypto from 'node:crypto';
import { AI_REPORT_EXCERPT_MAX, type AiReport, type AiReportResponse, type GarmentRow, type TryOnRow } from '@mirobe/shared';
import { transaction, type Db } from '../db/index';
import { getRow, patchRow } from '../db/rows';
import { HttpError } from './http';

/** Reports one account may file in a rolling 24 hours. Kept in the table, so a restart does not reset it. */
export const AI_REPORT_DAILY_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The try-on or garment a report points at must be the caller's own and not deleted. */
function ownTarget(db: Db, userId: string, report: AiReport): TryOnRow | GarmentRow | null {
  if (report.targetType === 'stylist') return null;
  const table = report.targetType === 'tryon' || report.targetType === 'video' ? 'tryons' : 'garments';
  const row = getRow(db, table, userId, report.targetId);
  if (!row || row.deletedAt) throw new HttpError(404, 'Report target not found');
  return row;
}

/**
 * What the reporter saw, kept with the report so the review still has it after the image is hidden
 * or the piece edited: the media path of the photo, clip or studio image, the AI tags as JSON, or
 * the Jev reply the app sent (the server keeps no chat history).
 */
function excerptOf(report: AiReport, target: TryOnRow | GarmentRow | null): string | null {
  const clip = (text: string | null | undefined) => (text ? text.slice(0, AI_REPORT_EXCERPT_MAX) : null);
  switch (report.targetType) {
    case 'stylist':
      return clip(report.excerpt);
    case 'tryon':
      return clip((target as TryOnRow).imageUrl);
    case 'video':
      return clip((target as TryOnRow).videoUrl);
    case 'packshot':
      return clip((target as GarmentRow).packshotUrl);
    case 'tagging': {
      const { name, category, subcategory, colors, material, pattern, occasions, styleTags, extraTags, description } = target as GarmentRow;
      return clip(JSON.stringify({ name, category, subcategory, colors: colors.map((c) => c.name), material, pattern, occasions, styleTags, extraTags, description }));
    }
  }
}

/**
 * Takes an offensive or privacy-reported image away from the reporter: a try-on gets the same
 * tombstone as deleting it, a clip or studio image is cleared (it can be made again, at the
 * usual cost). The files stay on disk for the review and go with the account. Tags and Jev
 * replies are only recorded.
 */
function hideFromReporter(db: Db, userId: string, report: AiReport): AiReportResponse['hidden'] {
  if (report.reason !== 'offensive' && report.reason !== 'privacy') return undefined;
  if (report.targetType === 'tryon') {
    return { table: 'tryons', row: patchRow(db, 'tryons', userId, report.targetId, { deletedAt: new Date().toISOString() }) };
  }
  if (report.targetType === 'video') {
    const tryon = getRow(db, 'tryons', userId, report.targetId)!;
    if (tryon.videoStatus !== 'ready') return undefined;
    return { table: 'tryons', row: patchRow(db, 'tryons', userId, tryon.id, { videoStatus: 'none', videoUrl: null }) };
  }
  if (report.targetType === 'packshot') {
    const garment = getRow(db, 'garments', userId, report.targetId)!;
    if (!garment.packshotUrl) return undefined;
    return { table: 'garments', row: patchRow(db, 'garments', userId, garment.id, { packshotUrl: null, packshotStatus: 'none' }) };
  }
  return undefined;
}

/** Records a report (and hides the image where it applies) in one transaction. */
export function createReport(db: Db, userId: string, report: AiReport, now = new Date()): AiReportResponse {
  const result = transaction(db, () => {
    const since = new Date(now.getTime() - DAY_MS).toISOString();
    const recent = db.prepare('SELECT COUNT(*) AS n FROM ai_reports WHERE user_id = ? AND created_at > ?').get(userId, since) as { n: number };
    if (recent.n >= AI_REPORT_DAILY_LIMIT) throw new HttpError(429, 'Too many reports. Try again later.', 'RATE_LIMITED');
    const target = ownTarget(db, userId, report);
    const id = `rep_${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO ai_reports (id, user_id, target_type, target_id, reason, note, excerpt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      userId,
      report.targetType,
      report.targetId,
      report.reason,
      report.note ?? null,
      excerptOf(report, target),
      now.toISOString()
    );
    const hidden = hideFromReporter(db, userId, report);
    return hidden ? { id, hidden } : { id };
  });
  // The operator's cue: open reports are listed with `WHERE handled_at IS NULL` (see the README).
  console.info(`[mirobe] REPORT ${report.targetType} ${report.targetId} ${report.reason}`);
  return result;
}
