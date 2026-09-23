import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { SYNC_TABLES, type AuthResponse, type LoginInput, type RegisterInput } from '@mirobe/shared';
import { nextSeq, transaction, type Db } from '../db/index';
import { HttpError } from './http';
import { dummyHash, hashPassword, verifyPassword } from './password';

declare global {
  namespace Express {
    interface Request {
      userId: string;
      /** Null for anonymous accounts. */
      userEmail: string | null;
      /** Hash of the bearer token that authenticated this request (for logout). */
      tokenHash: string;
    }
  }
}

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

interface Session {
  userId: string;
  email: string | null;
  tokenHash: string;
}

/** A new device token for the user. Only its hash is stored. */
export function issueToken(db: Db, userId: string): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO devices (token_hash, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)').run(hash(token), userId, now, now);
  return token;
}

/** Creates an anonymous account. Registering later upgrades the same user id in place. */
export function createAnonymousUser(db: Db): { userId: string; token: string } {
  const userId = `usr_${crypto.randomUUID()}`;
  db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(userId, new Date().toISOString());
  return { userId, token: issueToken(db, userId) };
}

function sessionLookup(db: Db) {
  const lookup = db.prepare(
    'SELECT d.user_id, u.email FROM devices d JOIN users u ON u.id = d.user_id WHERE d.token_hash = ?'
  );
  const touch = db.prepare('UPDATE devices SET last_seen_at = ? WHERE token_hash = ?');
  return (req: Request): Session | null => {
    const header = req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return null;
    const tokenHash = hash(token);
    const row = lookup.get(tokenHash) as { user_id: string; email: string | null } | undefined;
    if (!row) return null;
    touch.run(new Date().toISOString(), tokenHash);
    return { userId: row.user_id, email: row.email, tokenHash };
  };
}

function attach(req: Request, session: Session) {
  req.userId = session.userId;
  req.userEmail = session.email;
  req.tokenHash = session.tokenHash;
}

export function requireAuth(db: Db) {
  const resolve = sessionLookup(db);
  return (req: Request, _res: Response, next: NextFunction) => {
    const session = resolve(req);
    if (!session) return next(new HttpError(401, 'Unauthorized', 'UNAUTHORIZED'));
    attach(req, session);
    next();
  };
}

/** Like requireAuth, but a missing or unknown token just leaves the request unauthenticated. */
export function optionalAuth(db: Db) {
  const resolve = sessionLookup(db);
  return (req: Request, _res: Response, next: NextFunction) => {
    const session = resolve(req);
    if (session) attach(req, session);
    next();
  };
}

/**
 * Paid AI features need a registered (email) account. Runs after requireAuth and
 * before any quota reservation or provider call.
 */
export function requireAccount(req: Request, _res: Response, next: NextFunction) {
  if (!req.userEmail) return next(new HttpError(403, 'Sign in to use AI features', 'AUTH_REQUIRED'));
  next();
}

const isUniqueViolation = (error: unknown) => /UNIQUE constraint failed: users\.email/i.test((error as Error)?.message ?? '');
const emailTaken = () => new HttpError(409, 'This email is already registered', 'EMAIL_TAKEN');

/**
 * Registers an email account. An anonymous caller is upgraded in place (same user
 * id, so the wardrobe stays); anyone else gets a new user. Either way the old
 * anonymous tokens are revoked and a fresh one is issued.
 */
export async function registerUser(db: Db, input: RegisterInput, caller?: { userId: string; email: string | null }): Promise<AuthResponse> {
  const findByEmail = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE');
  if (findByEmail.get(input.email)) throw emailTaken();
  const passwordHash = await hashPassword(input.password);
  const now = new Date().toISOString();
  try {
    return transaction(db, () => {
      if (caller && caller.email === null) {
        const upgraded = db
          .prepare(
            'UPDATE users SET email = ?, password_hash = ?, name = ?, updated_at = ? WHERE id = ? AND email IS NULL AND merged_into IS NULL'
          )
          .run(input.email, passwordHash, input.name ?? null, now, caller.userId);
        if (upgraded.changes === 1) {
          db.prepare('DELETE FROM devices WHERE user_id = ?').run(caller.userId);
          return { userId: caller.userId, token: issueToken(db, caller.userId), email: input.email };
        }
      }
      const userId = `usr_${crypto.randomUUID()}`;
      db.prepare('INSERT INTO users (id, created_at, updated_at, email, password_hash, name) VALUES (?, ?, ?, ?, ?, ?)').run(
        userId,
        now,
        now,
        input.email,
        passwordHash,
        input.name ?? null
      );
      return { userId, token: issueToken(db, userId), email: input.email };
    });
  } catch (error) {
    // Two registrations for the same email raced past the pre-check.
    if (isUniqueViolation(error)) throw emailTaken();
    throw error;
  }
}

/**
 * Verifies email + password and issues a new device token. Unknown email and wrong
 * password fail identically, and both cost one scrypt derivation.
 * When the caller is an anonymous user, its rows move into the account (see mergeAnonymousInto).
 */
export async function loginUser(db: Db, input: LoginInput, caller?: { userId: string; email: string | null }): Promise<AuthResponse> {
  const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ? COLLATE NOCASE').get(input.email) as
    | { id: string; email: string; password_hash: string | null }
    | undefined;
  const ok = await verifyPassword(input.password, user?.password_hash ?? (await dummyHash()));
  if (!user || !user.password_hash || !ok) throw new HttpError(401, 'Wrong email or password', 'INVALID_CREDENTIALS');
  return transaction(db, () => {
    if (caller && caller.email === null && caller.userId !== user.id) mergeAnonymousInto(db, caller.userId, user.id);
    return { userId: user.id, token: issueToken(db, user.id), email: user.email };
  });
}

export function revokeToken(db: Db, tokenHash: string) {
  db.prepare('DELETE FROM devices WHERE token_hash = ?').run(tokenHash);
}

/**
 * Signing in on a device that was used anonymously: the anonymous wardrobe was
 * made on this device by the same person, so its rows and media move into the
 * account instead of being dropped. Rows get fresh sync sequence numbers so the
 * account's other devices pull them. The account's active mirror photo wins over
 * the anonymous one. The anonymous user keeps its usage history and loses its tokens.
 */
export function mergeAnonymousInto(db: Db, anonymousId: string, targetId: string) {
  transaction(db, () => {
    const now = new Date().toISOString();
    const targetHasAvatar = (db.prepare('SELECT data FROM avatars WHERE user_id = ? AND deleted_at IS NULL').all(targetId) as { data: string }[]).some(
      (row) => JSON.parse(row.data).isActive
    );
    for (const table of SYNC_TABLES) {
      const rows = db.prepare(`SELECT id, data FROM ${table} WHERE user_id = ?`).all(anonymousId) as { id: string; data: string }[];
      for (const row of rows) {
        let data = row.data;
        let updatedAt: string | null = null;
        if (table === 'avatars' && targetHasAvatar) {
          const parsed = JSON.parse(row.data);
          if (parsed.isActive) {
            data = JSON.stringify({ ...parsed, isActive: false, updatedAt: now });
            updatedAt = now;
          }
        }
        db.prepare(`UPDATE ${table} SET user_id = ?, data = ?, updated_at = COALESCE(?, updated_at), server_seq = ? WHERE id = ?`).run(
          targetId,
          data,
          updatedAt,
          nextSeq(db),
          row.id
        );
      }
    }
    db.prepare('UPDATE media SET user_id = ? WHERE user_id = ?').run(targetId, anonymousId);
    // Same phone: its push token now belongs to the account (the app also re-registers it).
    db.prepare('UPDATE push_tokens SET user_id = ? WHERE user_id = ?').run(targetId, anonymousId);
    db.prepare('DELETE FROM devices WHERE user_id = ?').run(anonymousId);
    db.prepare('UPDATE users SET merged_into = ?, updated_at = ? WHERE id = ?').run(targetId, now, anonymousId);
  });
}

/**
 * Every column that points at a user: foreign keys to users(id) plus any plain
 * `user_id` column, so a table added later (billing, …) is covered too.
 */
function userColumns(db: Db): { table: string; column: string }[] {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'users'").all() as {
    name: string;
  }[];
  const found = new Map<string, { table: string; column: string }>();
  for (const { name } of tables) {
    const keys = db.prepare(`PRAGMA foreign_key_list(${name})`).all() as { table: string; from: string }[];
    for (const key of keys) if (key.table === 'users') found.set(`${name}.${key.from}`, { table: name, column: key.from });
    const columns = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
    if (columns.some((c) => c.name === 'user_id')) found.set(`${name}.user_id`, { table: name, column: 'user_id' });
  }
  return [...found.values()];
}

/**
 * Deletes an account and everything it owns: synced rows, usage and live-session
 * reservations, device tokens, media records, and the anonymous users that were
 * merged into it. A registered account must confirm with its current password.
 * Runs in one transaction and returns the media file names, which the caller
 * removes from disk after the commit.
 */
export async function deleteAccount(db: Db, caller: { userId: string; email: string | null }, password?: string): Promise<string[]> {
  if (caller.email) {
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(caller.userId) as { password_hash: string | null } | undefined;
    const ok = await verifyPassword(password ?? '', user?.password_hash ?? (await dummyHash()));
    if (!password || !user?.password_hash || !ok) throw new HttpError(401, 'Wrong password', 'INVALID_CREDENTIALS');
  }
  return transaction(db, () => {
    const merged = db.prepare('SELECT id FROM users WHERE merged_into = ?').all(caller.userId) as { id: string }[];
    const ids = [caller.userId, ...merged.map((row) => row.id)];
    const marks = ids.map(() => '?').join(', ');
    const files = (db.prepare(`SELECT file_name FROM media WHERE user_id IN (${marks})`).all(...ids) as { file_name: string }[]).map(
      (row) => row.file_name
    );
    for (const { table, column } of userColumns(db)) db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${marks})`).run(...ids);
    db.prepare(`DELETE FROM users WHERE id IN (${marks})`).run(...ids);
    return files;
  });
}
