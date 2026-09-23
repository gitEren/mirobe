import { ROW_SCHEMAS, type SyncRowMap, type SyncTable } from '@mirobe/shared';
import { HttpError } from '../lib/http';
import { nextSeq, transaction, type Db } from './index';

interface StoredRow {
  id: string;
  user_id: string;
  data: string;
  updated_at: string;
  deleted_at: string | null;
  server_seq: number;
}

export function parseStored<T extends SyncTable>(table: T, stored: StoredRow): SyncRowMap[T] {
  return ROW_SCHEMAS[table].parse(JSON.parse(stored.data)) as SyncRowMap[T];
}

export function getRow<T extends SyncTable>(db: Db, table: T, userId: string, id: string): SyncRowMap[T] | null {
  const stored = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId) as
    | StoredRow
    | undefined;
  return stored ? parseStored(table, stored) : null;
}

export function listRows<T extends SyncTable>(db: Db, table: T, userId: string): SyncRowMap[T][] {
  const rows = db
    .prepare(`SELECT * FROM ${table} WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`)
    .all(userId) as unknown as StoredRow[];
  return rows.map((row) => parseStored(table, row));
}

/**
 * Last-write-wins upsert. Returns the row that ended up stored and whether the
 * incoming one won. Ids are global, so a row owned by someone else is refused.
 */
export function upsertRow<T extends SyncTable>(
  db: Db,
  table: T,
  userId: string,
  row: SyncRowMap[T],
  options: { force?: boolean; extra?: Record<string, string | null> } = {}
): { stored: SyncRowMap[T]; applied: boolean; seq: number } {
  return transaction(db, () => {
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id) as StoredRow | undefined;
    if (existing && existing.user_id !== userId) {
      throw new HttpError(403, 'Row belongs to another user');
    }
    if (existing && !options.force && existing.updated_at > row.updatedAt) {
      return { stored: parseStored(table, existing), applied: false, seq: existing.server_seq };
    }
    const seq = nextSeq(db);
    const extraCols = Object.keys(options.extra ?? {});
    const cols = ['id', 'user_id', 'data', 'updated_at', 'deleted_at', 'server_seq', ...extraCols];
    const values = [
      row.id,
      userId,
      JSON.stringify(row),
      row.updatedAt,
      row.deletedAt ?? null,
      seq,
      ...extraCols.map((key) => options.extra![key]),
    ];
    const updates = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`);
    db.prepare(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
       ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}`
    ).run(...values);
    return { stored: row, applied: true, seq };
  });
}

/** Server-side edits: re-stamp updatedAt so the change wins over stale clients. */
export function patchRow<T extends SyncTable>(
  db: Db,
  table: T,
  userId: string,
  id: string,
  patch: Partial<SyncRowMap[T]>,
  extra?: Record<string, string | null>
): SyncRowMap[T] {
  return transaction(db, () => {
    const current = getRow(db, table, userId, id);
    if (!current) throw new HttpError(404, `${table} ${id} not found`);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() } as SyncRowMap[T];
    upsertRow(db, table, userId, next, { force: true, extra });
    return next;
  });
}

export function pullSince(db: Db, table: SyncTable, userId: string, since: number, limit: number) {
  const rows = db
    .prepare(`SELECT * FROM ${table} WHERE user_id = ? AND server_seq > ? ORDER BY server_seq LIMIT ?`)
    .all(userId, since, limit) as unknown as StoredRow[];
  return rows.map((row) => ({ seq: row.server_seq, row: parseStored(table, row) }));
}
