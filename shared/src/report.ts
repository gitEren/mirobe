import { z } from 'zod';
import type { GarmentRow, TryOnRow } from './schemas';

/**
 * "Report AI output" (Google Play's AI-generated content policy): what a report points at.
 * `tryon` and `video` carry a try-on id, `packshot` and `tagging` a garment id (the caller's
 * own), `stylist` the app's local id of a Jev reply, whose text travels as `excerpt`.
 */
export const AI_REPORT_TARGETS = ['tryon', 'packshot', 'video', 'stylist', 'tagging'] as const;
export type AiReportTarget = (typeof AI_REPORT_TARGETS)[number];

export const AI_REPORT_REASONS = ['offensive', 'inaccurate', 'privacy', 'other'] as const;
export type AiReportReason = (typeof AI_REPORT_REASONS)[number];

export const AI_REPORT_NOTE_MAX = 500;
export const AI_REPORT_EXCERPT_MAX = 1000;

/** An empty or blank optional text is left out rather than stored as ''. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

/** POST /api/reports */
export const AiReportSchema = z.object({
  targetType: z.enum(AI_REPORT_TARGETS),
  /** Ids only (letters, digits, `_ . : -`): it goes into the operator's log line as is. */
  targetId: z.string().trim().min(1).max(64).regex(/^[\w.:-]+$/),
  reason: z.enum(AI_REPORT_REASONS),
  note: optionalText(AI_REPORT_NOTE_MAX),
  /** The reported Jev reply (the server keeps no chat history). For other targets the server fills it in. */
  excerpt: optionalText(AI_REPORT_EXCERPT_MAX),
});
export type AiReportInput = z.input<typeof AiReportSchema>;
export type AiReport = z.output<typeof AiReportSchema>;

/**
 * 201 answer. `hidden`: an offensive or privacy report took the image away from the
 * reporter (a try-on is removed, a clip or studio image cleared); the app adopts the row.
 */
export interface AiReportResponse {
  id: string;
  hidden?: { table: 'tryons'; row: TryOnRow } | { table: 'garments'; row: GarmentRow };
}
