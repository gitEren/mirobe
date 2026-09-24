import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

// Synced tables share one shape: the row travels as JSON in `data`, and the
// columns next to it exist for ownership, LWW comparison and pull cursors.
const syncedTable = (name: string, extra = '') => `
  CREATE TABLE ${name} (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    server_seq INTEGER NOT NULL${extra}
  );
  CREATE INDEX ${name}_user_seq ON ${name}(user_id, server_seq);
`;

/** Adds a column unless it exists, so a migration can be re-run safely on a live database. */
function addColumn(db: Db, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const MIGRATIONS: (string | ((db: Db) => void))[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    plan_checked_at TEXT
  );
  CREATE TABLE devices (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE usage_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL,
    units INTEGER NOT NULL,
    ref TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX usage_events_user ON usage_events(user_id, kind, created_at);
  CREATE TABLE sync_counter (id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL);
  INSERT INTO sync_counter (id, value) VALUES (1, 0);
  ${syncedTable('garments')}
  ${syncedTable('looks')}
  ${syncedTable('avatars')}
  ${syncedTable('tryons', ',\n    cache_key TEXT,\n    video_request_id TEXT')}
  CREATE INDEX tryons_cache ON tryons(user_id, cache_key);
  `,
  // 2: email/password accounts. Additive only: every existing user stays anonymous
  // (email NULL). SQLite cannot add a UNIQUE column, so uniqueness is a partial
  // unique index; NOCASE keeps it case-insensitive even if a caller forgot to normalise.
  (db) => {
    addColumn(db, 'users', 'email', 'TEXT');
    addColumn(db, 'users', 'password_hash', 'TEXT');
    addColumn(db, 'users', 'email_verified_at', 'TEXT');
    addColumn(db, 'users', 'name', 'TEXT');
    addColumn(db, 'users', 'updated_at', 'TEXT');
    // Set when an anonymous user's rows were merged into a signed-in account.
    addColumn(db, 'users', 'merged_into', 'TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL');
    db.exec('CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id)');
  },
  // 3: the Premium plan was renamed Plus. users.plan is the only persisted plan id
  // (usage_events store kinds, not plans). Idempotent: re-running changes nothing.
  "UPDATE users SET plan = 'plus' WHERE plan = 'premium';",
  // 4: count-based quotas. Usage kinds become the plan buckets, mapped by what each
  // event paid for (its ref); their old unit amounts stay but are no longer summed.
  // Idempotent: the old kinds are gone after the first run.
  `
  UPDATE usage_events SET kind = 'taggings' WHERE kind = 'photo_tokens' AND ref LIKE 'tag:%';
  UPDATE usage_events SET kind = 'images' WHERE kind = 'photo_tokens';
  UPDATE usage_events SET kind = 'videos' WHERE kind = 'video_seconds';
  UPDATE usage_events SET kind = 'stylist' WHERE kind = 'jev_decisions';
  `,
  // 5: push notifications. One row per device token: a token registered again by
  // another user moves to that user. Payment notices can be switched off per user
  // (on by default); the daily outfit reminder is scheduled on the device.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        token TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
        environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
        lang TEXT NOT NULL DEFAULT 'tr',
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS push_tokens_user ON push_tokens(user_id);
    `);
    addColumn(db, 'users', 'notify_subscription', 'INTEGER NOT NULL DEFAULT 1');
  },
  // 6: payment notice rules. What RevenueCat webhooks said about the user's subscription:
  // the end of its last known period and when it expired (cleared by the next purchase or
  // renewal), so a renewal the user bought after a lapse can be told from an automatic one.
  // In-app notices (auto-renew switched back on) wait in user_notices until the app has
  // shown them; account deletion finds the table by its user_id.
  (db) => {
    addColumn(db, 'users', 'subscription_expires_at', 'TEXT');
    addColumn(db, 'users', 'subscription_lapsed_at', 'TEXT');
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_notices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL,
        plan TEXT,
        created_at TEXT NOT NULL,
        seen_at TEXT
      );
      CREATE INDEX IF NOT EXISTS user_notices_user ON user_notices(user_id, seen_at, created_at);
    `);
  },
  // 7: consent to AI processing (App Store 5.1.2(i)): when the account allowed its photos and
  // messages to be sent to the AI providers. NULL (every existing user) until it does; withdrawing
  // clears it again. The AI routes refuse accounts without it.
  (db) => addColumn(db, 'users', 'ai_consent_at', 'TEXT'),
  // 8: "Report AI output" (Google Play AI-generated content policy). One row per report, reviewed
  // by the operator, who stamps handled_at. `excerpt` is what the reporter saw: the media path of the
  // image or clip, the AI tags, or the Jev reply (chats are not stored). Account deletion finds the
  // table by its user_id.
  `
  CREATE TABLE IF NOT EXISTS ai_reports (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    target_type TEXT NOT NULL CHECK (target_type IN ('tryon', 'packshot', 'video', 'stylist', 'tagging')),
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('offensive', 'inaccurate', 'privacy', 'other')),
    note TEXT CHECK (note IS NULL OR length(note) <= 500),
    excerpt TEXT CHECK (excerpt IS NULL OR length(excerpt) <= 1000),
    created_at TEXT NOT NULL,
    handled_at TEXT
  );
  CREATE INDEX IF NOT EXISTS ai_reports_user ON ai_reports(user_id, created_at);
  CREATE INDEX IF NOT EXISTS ai_reports_open ON ai_reports(handled_at, created_at);
  `,
];

export function openDb(dataDir: string | ':memory:'): Db {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    fs.mkdirSync(dataDir, { recursive: true });
    file = path.join(dataDir, 'mirobe.db');
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: Db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  const current = row.v ?? 0;
  MIGRATIONS.slice(current).forEach((step, index) => {
    transaction(db, () => {
      if (typeof step === 'string') db.exec(step);
      else step(db);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        current + index + 1,
        new Date().toISOString()
      );
    });
  });
}

export function transaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Next global sync sequence number. Call inside a transaction. */
export function nextSeq(db: Db): number {
  const row = db.prepare('UPDATE sync_counter SET value = value + 1 WHERE id = 1 RETURNING value').get() as {
    value: number;
  };
  return row.value;
}
