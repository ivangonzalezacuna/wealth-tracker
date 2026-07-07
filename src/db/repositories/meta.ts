/**
 * Meta repository - internal bookkeeping (import metadata, sync state).
 */

import { getDb, persistDb } from '../connection';

/** Get a meta value by key. */
export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const result = db.exec('SELECT value FROM meta WHERE key = ?', [key]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  return String(result[0].values[0][0] ?? '');
}

/** Set a meta value. */
export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
  await persistDb();
}

/** Delete a meta key. */
export async function deleteMeta(key: string): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM meta WHERE key = ?', [key]);
  await persistDb();
}

// ── Import metadata helpers ───────────────────────────────────────

const IMPORT_META_PREFIX = 'import:';

/** Save import metadata (e.g., last import date). */
export async function saveImportMeta(date: string): Promise<void> {
  await setMeta(`${IMPORT_META_PREFIX}last_import`, date);
}

/** Load import metadata. */
export async function loadImportMeta(): Promise<Record<string, string>> {
  const db = await getDb();
  const result = db.exec("SELECT key, value FROM meta WHERE key LIKE 'import:%'");
  const meta: Record<string, string> = {};
  if (result.length === 0) return meta;
  for (const row of result[0].values) {
    const key = String(row[0] ?? '').replace(IMPORT_META_PREFIX, '');
    meta[key] = String(row[1] ?? '');
  }
  return meta;
}

// ── Drive sync state helpers ──────────────────────────────────────

/** Get the last successful Drive sync timestamp. */
export async function getLastSyncTimestamp(): Promise<string | null> {
  return getMeta('sync:last_upload_at');
}

/** Set the last successful Drive sync timestamp. */
export async function setLastSyncTimestamp(iso: string): Promise<void> {
  await setMeta('sync:last_upload_at', iso);
}

/** Get the Drive file version (for conflict detection). */
export async function getDriveVersion(): Promise<string | null> {
  return getMeta('sync:drive_version');
}

/** Set the Drive file version. */
export async function setDriveVersion(version: string): Promise<void> {
  await setMeta('sync:drive_version', version);
}
