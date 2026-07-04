import type { Account, Holding, Settings, Snapshot, Transaction } from '../types';

export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupFile {
  schemaVersion: number;
  app: 'wealth-tracker';
  exportedAt: string;
  data: {
    accounts: Account[];
    holdings: Holding[];
    settings: Settings;
    snapshots: Snapshot[];
    transactions: Transaction[];
    importMeta: Record<string, string>;
  };
}

// ── Schema migrations ─────────────────────────────────────

type Migration = (data: BackupFile['data']) => BackupFile['data'];

/** One entry per breaking change to a canonical type, keyed by the version
 *  migrating FROM. Empty today: schema version 1 is the only one that has
 *  ever shipped. Add an entry (and bump BACKUP_SCHEMA_VERSION) only for a
 *  rename/removal/meaning-change, never for a purely additive field,
 *  which old backups already restore correctly via each parser's existing
 *  default-handling. */
export const MIGRATIONS: Record<number, Migration> = {};

export function migrateBackup(b: BackupFile): BackupFile {
  let data = b.data;
  for (let v = b.schemaVersion; v < BACKUP_SCHEMA_VERSION; v++) {
    if (MIGRATIONS[v]) data = MIGRATIONS[v](data);
  }
  return { ...b, schemaVersion: BACKUP_SCHEMA_VERSION, data };
}

export function buildBackup(input: BackupFile['data']): BackupFile {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    app: 'wealth-tracker',
    exportedAt: new Date().toISOString(),
    data: { ...input },
  };
}

export function backupFilename(now: Date = new Date()): string {
  return `wealth-tracker-backup-${now.toISOString().slice(0, 10)}.json`;
}

/** Returns the typed BackupFile on success, null on any shape mismatch - never throws. */
export function validateBackup(raw: unknown): BackupFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Partial<BackupFile>;
  if (b.app !== 'wealth-tracker') return null;
  if (typeof b.schemaVersion !== 'number' || b.schemaVersion > BACKUP_SCHEMA_VERSION) return null;
  const d = b.data as Partial<BackupFile['data']> | undefined;
  if (!d || typeof d !== 'object') return null;
  if (
    !Array.isArray(d.accounts) ||
    !Array.isArray(d.holdings) ||
    !d.settings ||
    typeof d.settings !== 'object' ||
    !Array.isArray(d.snapshots) ||
    !Array.isArray(d.transactions) ||
    !d.importMeta ||
    typeof d.importMeta !== 'object'
  )
    return null;
  return b as BackupFile;
}

export function summarizeBackup(b: BackupFile): string {
  const { accounts, holdings, snapshots, transactions } = b.data;
  const date = new Date(b.exportedAt);
  const when = isNaN(date.getTime()) ? b.exportedAt : date.toLocaleDateString('de-DE');
  return `Backup from ${when}: ${accounts.length} accounts, ${holdings.length} holdings, ${snapshots.length} snapshots, ${transactions.length} transactions. This will replace everything currently in your Google Sheet.`;
}

// ── Backup staleness ──────────────────────────────────────

const BACKUP_REMINDER_DAYS = 30;

export function isBackupStale(lastBackupAt: string | undefined, now: Date = new Date()): boolean {
  if (!lastBackupAt) return true;
  const last = new Date(lastBackupAt).getTime();
  if (isNaN(last)) return true;
  return (now.getTime() - last) / 86_400_000 >= BACKUP_REMINDER_DAYS;
}
