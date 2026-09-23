import type { NextFunction, Request, Response } from 'express';
import { AI_CONSENT_REQUIRED } from '@mirobe/shared';
import type { Db } from '../db/index';
import { HttpError } from './http';

/** Whether the account allowed AI processing (users.ai_consent_at is set). */
export function aiConsentGiven(db: Db, userId: string): boolean {
  const row = db.prepare('SELECT ai_consent_at FROM users WHERE id = ?').get(userId) as { ai_consent_at: string | null } | undefined;
  return Boolean(row?.ai_consent_at);
}

/**
 * Records (granted) or withdraws the account's consent and returns the stored state. Granting
 * again keeps the time of the first grant; withdrawing clears it, and a later grant is new.
 */
export function setAiConsent(db: Db, userId: string, granted: boolean, now = new Date()): boolean {
  if (granted) db.prepare('UPDATE users SET ai_consent_at = COALESCE(ai_consent_at, ?) WHERE id = ?').run(now.toISOString(), userId);
  else db.prepare('UPDATE users SET ai_consent_at = NULL WHERE id = ?').run(userId);
  return aiConsentGiven(db, userId);
}

/**
 * Every AI route: the account allowed its photos and messages to be sent to third-party AI
 * (App Store 5.1.2(i)). Runs after requireAccount (an anonymous user is told to sign in
 * first) and before any quota reservation or provider call.
 */
export function requireAiConsent(db: Db) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!aiConsentGiven(db, req.userId)) return next(new HttpError(403, 'Allow AI processing to use AI features', AI_CONSENT_REQUIRED));
    next();
  };
}
