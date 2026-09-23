import * as SQLite from 'expo-sqlite';
import type { SyncRowMap, SyncTable } from '@mirobe/shared';

/**
 * On-device mirror of the synced server tables. Rows are stored as JSON with a
 * `dirty` flag; the sync engine pushes dirty rows and clears the flag once the
 * server accepted exactly that version.
 */
const db = SQLite.openDatabaseSync('mirobe.db');

db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS rows (
    tbl TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    dirty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tbl, id)
  );
  CREATE INDEX IF NOT EXISTS rows_dirty ON rows(dirty);
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

type AnyRow = SyncRowMap[SyncTable];

export const localDb = {
  loadAll(): { [K in SyncTable]: SyncRowMap[K][] } {
    const result = { garments: [], looks: [], avatars: [], tryons: [] } as { [K in SyncTable]: SyncRowMap[K][] };
    const rows = db.getAllSync<{ tbl: SyncTable; data: string }>('SELECT tbl, data FROM rows ORDER BY updated_at DESC');
    for (const row of rows) (result[row.tbl] as AnyRow[])?.push(JSON.parse(row.data));
    return result;
  },

  get<T extends SyncTable>(table: T, id: string): { row: SyncRowMap[T]; dirty: boolean } | null {
    const found = db.getFirstSync<{ data: string; dirty: number }>('SELECT data, dirty FROM rows WHERE tbl = ? AND id = ?', [table, id]);
    return found ? { row: JSON.parse(found.data), dirty: found.dirty === 1 } : null;
  },

  put(table: SyncTable, row: AnyRow, dirty: boolean) {
    db.runSync(
      `INSERT INTO rows (tbl, id, data, updated_at, dirty) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(tbl, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, dirty = excluded.dirty`,
      [table, row.id, JSON.stringify(row), row.updatedAt, dirty ? 1 : 0]
    );
  },

  dirty(): { table: SyncTable; row: AnyRow }[] {
    return db
      .getAllSync<{ tbl: SyncTable; data: string }>('SELECT tbl, data FROM rows WHERE dirty = 1 ORDER BY updated_at LIMIT 200')
      .map((r) => ({ table: r.tbl, row: JSON.parse(r.data) }));
  },

  /** Clears the flag only if the row was not edited again while the push was in flight. */
  markClean(table: SyncTable, id: string, updatedAt: string) {
    db.runSync('UPDATE rows SET dirty = 0 WHERE tbl = ? AND id = ? AND updated_at = ?', [table, id, updatedAt]);
  },

  getKv(key: string): string | null {
    return db.getFirstSync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key])?.value ?? null;
  },

  setKv(key: string, value: string) {
    db.runSync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  },

  transaction(fn: () => void) {
    db.withTransactionSync(fn);
  },

  /** After the server lost our account, re-send everything we own. */
  markAllDirty() {
    db.runSync("UPDATE rows SET dirty = 1 WHERE tbl IN ('garments', 'looks', 'avatars')");
    db.runSync("DELETE FROM rows WHERE tbl = 'tryons'");
  },

  reset() {
    db.execSync('DELETE FROM rows; DELETE FROM kv;');
  },
};
