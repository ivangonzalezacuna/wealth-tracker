/**
 * Snapshot repository - CRUD operations for the snapshots table.
 * Mirrors the API surface of the old sheets/snapshots.ts module.
 *
 * Snapshots use a JSON column for account values, since account keys are
 * dynamic (added/removed via Settings). This avoids DDL changes when accounts
 * are modified.
 */

import { getDb, persistDb } from '../connection';
import type { Snapshot } from '../../types';

/** Load all snapshots, sorted by date ascending. */
export async function loadSnapshots(): Promise<Snapshot[]> {
  const db = await getDb();
  const result = db.exec('SELECT date, values_json, notes FROM snapshots ORDER BY date ASC');
  if (result.length === 0) return [];
  return result[0].values.map(rowToSnapshot);
}

/**
 * Upsert a single snapshot (insert or update by date).
 */
export async function upsertSnapshot(snap: Snapshot): Promise<void> {
  const db = await getDb();
  const { date, notes, ...values } = snap;
  // Remove 'notes' from values object - it's stored separately
  const valuesJson = JSON.stringify(values);
  db.run('INSERT OR REPLACE INTO snapshots (date, values_json, notes) VALUES (?, ?, ?)', [
    date,
    valuesJson,
    notes || '',
  ]);
  await persistDb();
}

/**
 * Full overwrite of all snapshots - used by backup restore and delete operations.
 */
export async function saveSnapshots(snaps: Snapshot[]): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM snapshots');
  const stmt = db.prepare(
    'INSERT INTO snapshots (date, values_json, notes) VALUES (?, ?, ?)',
  );
  for (const snap of snaps) {
    const { date, notes, ...values } = snap;
    stmt.run([date, JSON.stringify(values), notes || '']);
  }
  stmt.free();
  await persistDb();
}

// ── Internal helpers ──────────────────────────────────────────────

function rowToSnapshot(row: unknown[]): Snapshot {
  const date = String(row[0] ?? '');
  const notes = String(row[2] ?? '');
  let values: Record<string, number | string | undefined> = {};
  try {
    values = JSON.parse(String(row[1] ?? '{}'));
  } catch {
    values = {};
  }
  return { date, notes, ...values };
}
