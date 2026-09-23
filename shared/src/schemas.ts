import { z } from 'zod';
import { GARMENT_CATEGORIES, OCCASIONS, PATTERNS, SEASONS, STYLE_TAGS } from './taxonomy';

const isoDate = z.string().min(10);
const id = z.string().min(8).max(64);

export const ColorSchema = z.object({
  name: z.string().min(1).max(40),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type GarmentColor = z.infer<typeof ColorSchema>;

/**
 * What the vision model must return for a garment photo. Enum fields are
 * strict; unknown occasions/styles are dropped rather than failing the scan.
 */
export const GarmentTagsSchema = z.object({
  name: z.string().min(2).max(80),
  category: z.enum(GARMENT_CATEGORIES),
  subcategory: z.string().max(60).default(''),
  colors: z.array(ColorSchema).min(1).max(4),
  material: z.string().max(80).default(''),
  pattern: z.enum(PATTERNS).catch('solid'),
  seasons: z.array(z.string()).transform((v) => v.filter((s): s is (typeof SEASONS)[number] => (SEASONS as readonly string[]).includes(s))),
  formality: z.coerce.number().int().min(1).max(5),
  occasions: z
    .array(z.string())
    .transform((v) => v.filter((s): s is (typeof OCCASIONS)[number] => (OCCASIONS as readonly string[]).includes(s))),
  styleTags: z
    .array(z.string())
    .transform((v) => v.filter((s): s is (typeof STYLE_TAGS)[number] => (STYLE_TAGS as readonly string[]).includes(s))),
  extraTags: z.array(z.string().max(30)).max(8).default([]),
  description: z.string().max(240).default(''),
  confidence: z.coerce.number().min(0).max(1),
  isGarment: z.boolean().default(true),
  /** The garment is worn by a person in the photo (on-device lifting would cut out the person). */
  onPerson: z.boolean().default(false),
});
export type GarmentTags = z.infer<typeof GarmentTagsSchema>;

export const TAGGING_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const;
export type TaggingStatus = (typeof TAGGING_STATUSES)[number];

// ---------------------------------------------------------------------------
// Synced rows. Field names are camelCase on the wire; the server maps them to
// snake_case columns. Every row carries updatedAt + deletedAt for LWW sync.
// ---------------------------------------------------------------------------

const syncMeta = {
  id,
  createdAt: isoDate,
  updatedAt: isoDate,
  deletedAt: isoDate.nullable().default(null),
};

export const GarmentRowSchema = z.object({
  ...syncMeta,
  name: z.string().max(80).default(''),
  category: z.enum(GARMENT_CATEGORIES).nullable().default(null),
  subcategory: z.string().max(60).default(''),
  colors: z.array(ColorSchema).default([]),
  material: z.string().max(80).default(''),
  pattern: z.string().max(30).default(''),
  seasons: z.array(z.string()).default([]),
  formality: z.number().int().min(0).max(5).default(0),
  occasions: z.array(z.string()).default([]),
  styleTags: z.array(z.string()).default([]),
  extraTags: z.array(z.string()).default([]),
  description: z.string().max(240).default(''),
  confidence: z.number().min(0).max(1).default(0),
  imageUrl: z.string().max(500),
  /** Transparent PNG lifted on-device (original pixels, free). */
  cutoutUrl: z.string().max(500).nullable().default(null),
  /** Optional AI studio packshot rendered by the server. */
  packshotUrl: z.string().max(500).nullable().default(null),
  taggingStatus: z.enum(TAGGING_STATUSES).default('pending'),
  packshotStatus: z.enum(['none', 'processing', 'ready', 'failed']).default('none'),
  source: z.enum(['camera', 'gallery', 'wearing']).default('camera'),
  favorite: z.boolean().default(false),
  wornCount: z.number().int().min(0).default(0),
  lastWornAt: isoDate.nullable().default(null),
});
export type GarmentRow = z.infer<typeof GarmentRowSchema>;

export const LookRowSchema = z.object({
  ...syncMeta,
  title: z.string().max(80).default(''),
  occasion: z.string().max(40).default(''),
  style: z.string().max(60).default(''),
  garmentIds: z.array(id).max(8),
  tryonId: id.nullable().default(null),
  coverUrl: z.string().max(500).nullable().default(null),
  note: z.string().max(400).default(''),
  source: z.enum(['jev', 'manual']).default('manual'),
  saved: z.boolean().default(true),
});
export type LookRow = z.infer<typeof LookRowSchema>;

export const AvatarRowSchema = z.object({
  ...syncMeta,
  imageUrl: z.string().max(500),
  isActive: z.boolean().default(true),
});
export type AvatarRow = z.infer<typeof AvatarRowSchema>;

/** Try-ons are created by the server only; clients pull them read-only. */
export const TryOnRowSchema = z.object({
  ...syncMeta,
  /** Saved mirror photo used as the person, or null when a live camera frame was used. */
  avatarId: id.nullable().default(null),
  /** The person photo actually dressed (avatar image or a camera snapshot). */
  personUrl: z.string().nullable().default(null),
  garmentIds: z.array(id),
  status: z.enum(['processing', 'ready', 'failed']),
  imageUrl: z.string().nullable(),
  videoStatus: z.enum(['none', 'processing', 'ready', 'failed']),
  videoUrl: z.string().nullable(),
  provider: z.string(),
  error: z.string().nullable(),
});
export type TryOnRow = z.infer<typeof TryOnRowSchema>;

export const CLIENT_WRITABLE_TABLES = ['garments', 'looks', 'avatars'] as const;
export const SYNC_TABLES = ['garments', 'looks', 'avatars', 'tryons'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
export type ClientWritableTable = (typeof CLIENT_WRITABLE_TABLES)[number];

export const ROW_SCHEMAS = {
  garments: GarmentRowSchema,
  looks: LookRowSchema,
  avatars: AvatarRowSchema,
  tryons: TryOnRowSchema,
} as const;

export interface SyncRowMap {
  garments: GarmentRow;
  looks: LookRow;
  avatars: AvatarRow;
  tryons: TryOnRow;
}

export const SyncPushSchema = z.object({
  changes: z
    .array(
      z.object({
        table: z.enum(CLIENT_WRITABLE_TABLES),
        row: z.record(z.string(), z.unknown()),
      })
    )
    .max(500),
});
export type SyncPush = z.infer<typeof SyncPushSchema>;

export interface SyncPushResult {
  accepted: number;
  /** Rows the server kept because they were newer; the client should adopt them. */
  rejected: { table: SyncTable; row: SyncRowMap[SyncTable] }[];
  cursor: number;
}

export interface SyncPullResult {
  cursor: number;
  hasMore: boolean;
  changes: { [K in SyncTable]: SyncRowMap[K][] };
}
