import type { GarmentRow, TryOnRow } from './schemas';
import type { OutfitSlot } from './taxonomy';
import type { PlanId, UsageSnapshot } from './plans';

export interface ApiError {
  error: string;
  code?: string;
}

export interface AuthResponse {
  userId: string;
  token: string;
  /** Null for anonymous accounts. */
  email?: string | null;
}

/** In-app notice kinds. `uncancellation`: auto-renew was switched back on. */
export const USER_NOTICE_KINDS = ['uncancellation'] as const;
export type UserNoticeKind = (typeof USER_NOTICE_KINDS)[number];

/**
 * Something the server tells the app in the app rather than with a push. The app shows
 * it once and marks it seen (POST /api/notices/:id/seen).
 */
export interface UserNotice {
  id: string;
  kind: UserNoticeKind;
  /** The subscription's plan; left out for a store product the server does not know. */
  plan?: Exclude<PlanId, 'free'>;
}

export interface MeResponse {
  userId: string;
  email: string | null;
  isAnonymous: boolean;
  usage: UsageSnapshot;
  /** Unseen in-app notices, newest first (at most 5). Absent from servers that predate them. */
  notices?: UserNotice[];
  /** Whether the account allowed AI processing (POST /api/me/ai-consent). Absent from servers that predate it. */
  aiConsent?: boolean;
}

export interface MediaUploadResponse {
  id: string;
  url: string;
}

export interface AnalyzeGarmentResponse {
  garment: GarmentRow;
  usage: UsageSnapshot;
}

export type OutfitSelection = Partial<Record<OutfitSlot, string>>;

export interface StylistDecision {
  selection: OutfitSelection;
  garmentIds: string[];
  title: string;
  occasion: string;
  style: string;
  text: string;
  confidence: number;
  provider: 'jev' | 'gemini' | 'heuristic';
  latencyMs: number;
}

export interface StylistResponse {
  decision: StylistDecision;
  usage: UsageSnapshot;
}

export interface StylistChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Outfit shown with an assistant message, so follow-ups can refine it. */
  garmentIds?: string[];
}

export interface StylistChatResponse {
  intent: 'outfit' | 'refine' | 'chat';
  reply: string;
  suggestions: string[];
  decision?: StylistDecision;
  usage: UsageSnapshot;
}

export interface TryOnResponse {
  tryon: TryOnRow;
  cached: boolean;
  usage: UsageSnapshot;
}

export interface LiveStartResponse {
  sessionId: string;
  token: string;
  app: string;
  allowedSeconds: number;
  referenceImageUrl: string;
  prompt: string;
}
