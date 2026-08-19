import type {
  Account,
  FxRateRecord,
  Holding,
  HoldingMetadata,
  Settings,
  Snapshot,
  Transaction,
} from '../types';
import { formatEnglishDate } from '../dateFormat';

export const BACKUP_SCHEMA_VERSION = 5;

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
    /** FX rate cache. Optional for backwards-compatibility with pre-v4 backups;
     *  migrateBackup (v3→v4) always fills in an empty array when absent. */
    fxRates?: FxRateRecord[];
    holdingMetadata?: HoldingMetadata[];
  };
}

// ── Schema migrations ─────────────────────────────────────

type Migration = (data: BackupFile['data']) => BackupFile['data'];

/** One entry per breaking change to a canonical type, keyed by the version
 *  migrating FROM. Add an entry (and bump BACKUP_SCHEMA_VERSION) only for a
 *  rename/removal/meaning-change, never for a purely additive field,
 *  which old backups already restore correctly via each parser's existing
 *  default-handling. */
export const MIGRATIONS: Record<number, Migration> = {
  1: (data) => {
    // v1->v2: holdings had `ticker` field, now replaced by `shortName`.
    // Transactions had `symbol` field, now removed (isin is the key).
    // Cast through unknown[] because v1 objects have different shapes than current types.
    const holdings = (data.holdings as unknown as Record<string, unknown>[]).map((h) => {
      const { ticker, ...rest } = h;
      return { ...rest, shortName: (rest.shortName as string) || (ticker as string) || '' };
    });
    const transactions = (data.transactions as unknown as Record<string, unknown>[]).map((t) => {
      const { symbol, ...rest } = t;
      return { ...rest, isin: (rest.isin as string) || (symbol as string) || '' };
    });
    return { ...data, holdings, transactions } as typeof data;
  },
  2: (data) => {
    // v2->v3: per-holding contribAmount/contribInterval removed; targetPct derived from weights.
    const INTERVAL_MULTIPLIER: Record<string, number> = {
      weekly: 52,
      biweekly: 26,
      monthly: 12,
      quarterly: 4,
    };
    const rawHoldings = data.holdings as unknown as Record<string, unknown>[];
    const totalAnnual = rawHoldings
      .filter((h) => h.active && Number(h.contribAmount) > 0)
      .reduce((sum, h) => {
        const mult = INTERVAL_MULTIPLIER[String(h.contribInterval || 'monthly')] ?? 12;
        return sum + Number(h.contribAmount) * mult;
      }, 0);
    const holdings = rawHoldings.map((h) => {
      const { contribAmount, contribInterval, ...rest } = h;
      if (
        (rest.targetPct === undefined || rest.targetPct === 0) &&
        Number(contribAmount) > 0 &&
        h.active &&
        totalAnnual > 0
      ) {
        const mult = INTERVAL_MULTIPLIER[String(contribInterval || 'monthly')] ?? 12;
        const tgt = Math.round(((Number(contribAmount) * mult * 100) / totalAnnual) * 10) / 10;
        return { ...rest, targetPct: tgt };
      }
      return rest;
    });
    // Seed calibration_interval in settings if not already present.
    const settings = { calibration_interval: 'monthly', ...data.settings };
    return { ...data, holdings, settings } as unknown as typeof data;
  },
  3: (data) => {
    // v3->v4: fxRates array added to backup; old backups simply get an empty array.
    if (!Array.isArray((data as unknown as Record<string, unknown>).fxRates)) {
      return { ...data, fxRates: [] } as unknown as typeof data;
    }
    return data;
  },
  4: (data) => {
    if (!Array.isArray((data as unknown as Record<string, unknown>).holdingMetadata)) {
      return { ...data, holdingMetadata: [] } as unknown as typeof data;
    }
    return data;
  },
};

export function migrateBackup(b: BackupFile): BackupFile {
  let data = b.data;
  for (let v = b.schemaVersion; v < BACKUP_SCHEMA_VERSION; v++) {
    if (MIGRATIONS[v]) data = MIGRATIONS[v](data);
  }
  return { ...b, schemaVersion: BACKUP_SCHEMA_VERSION, data };
}

export function buildBackup(
  input: BackupFile['data'] & { holdingMetadata?: HoldingMetadata[] },
): BackupFile {
  const { fmp_api_key: _stripped, ...safeSettings } = input.settings as Record<string, unknown>;
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    app: 'wealth-tracker',
    exportedAt: new Date().toISOString(),
    data: {
      ...input,
      settings: safeSettings as Settings,
      fxRates: input.fxRates ?? [],
      holdingMetadata: input.holdingMetadata ?? [],
      transactions: input.transactions.map(({ rowId: _rowId, ...tx }) => tx),
    },
  };
}

export function backupFilename(now: Date = new Date()): string {
  return `wealth-tracker-backup-${now.toISOString().slice(0, 10)}.json`;
}

/** Returns the typed BackupFile on success, null on any shape mismatch - never throws. */
export function validateBackup(raw: unknown): BackupFile | null {
  if (!isRecord(raw)) return null;
  const b = raw as Partial<BackupFile>;
  if (b.app !== 'wealth-tracker') return null;
  if (
    typeof b.schemaVersion !== 'number' ||
    !Number.isInteger(b.schemaVersion) ||
    b.schemaVersion < 1 ||
    b.schemaVersion > BACKUP_SCHEMA_VERSION
  )
    return null;
  if (!isIsoTimestamp(b.exportedAt)) return null;
  const d = b.data as Partial<BackupFile['data']> | undefined;
  if (!isRecord(d)) return null;
  if (
    !Array.isArray(d.accounts) ||
    !d.accounts.every(isValidAccount) ||
    !Array.isArray(d.holdings) ||
    !d.holdings.every(isValidHolding) ||
    !isValidSettings(d.settings) ||
    !Array.isArray(d.snapshots) ||
    !d.snapshots.every(isValidSnapshot) ||
    !Array.isArray(d.transactions) ||
    !d.transactions.every(isValidTransaction) ||
    !isStringMap(d.importMeta) ||
    // fxRates is optional for backwards compatibility: old backups omit it and
    // migrateBackup (v3→v4) fills in an empty array.
    (d.fxRates !== undefined &&
      (!Array.isArray(d.fxRates) || !d.fxRates.every(isValidFxRateRecord))) ||
    (d.holdingMetadata !== undefined &&
      (!Array.isArray(d.holdingMetadata) || !d.holdingMetadata.every(isValidHoldingMetadata)))
  )
    return null;
  return b as BackupFile;
}

export function summarizeBackup(b: BackupFile): string {
  const { accounts, holdings, snapshots, transactions } = b.data;
  const date = new Date(b.exportedAt);
  const when = isNaN(date.getTime())
    ? b.exportedAt
    : formatEnglishDate(date, { day: 'numeric', month: 'short', year: 'numeric' });

  // Transaction date range
  let txRange = '';
  if (transactions.length > 0) {
    const dates = transactions.map((t) => t.date).sort();
    const fmtDate = (iso: string) => {
      const d = new Date(iso);
      return isNaN(d.getTime()) ? iso : formatEnglishDate(d, { month: 'short', year: 'numeric' });
    };
    txRange = `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}`;
  }

  // Last snapshot date
  let lastSnap = '';
  if (snapshots.length > 0) {
    const snapDates = snapshots.map((s) => s.date).sort();
    const last = snapDates[snapDates.length - 1];
    const d = new Date(last.length <= 7 ? `${last}-01` : last);
    lastSnap = isNaN(d.getTime())
      ? last
      : formatEnglishDate(d, { month: 'short', year: 'numeric' });
  }

  const counts = `${accounts.length} accounts · ${holdings.length} holdings · ${snapshots.length} snapshots · ${transactions.length} transactions`;
  const detailLines = [
    txRange ? `Transactions: ${txRange}` : '',
    lastSnap ? `Last snapshot: ${lastSnap}` : '',
  ].filter(Boolean);

  return [
    `Backup from ${when}`,
    counts,
    ...detailLines,
    '⚠ This will replace all your current data.',
  ].join('\n');
}

// ── Backup staleness ──────────────────────────────────────

const BACKUP_REMINDER_DAYS = 30;

export function isBackupStale(lastBackupAt: string | undefined, now: Date = new Date()): boolean {
  if (!lastBackupAt) return true;
  const last = new Date(lastBackupAt).getTime();
  if (isNaN(last)) return true;
  return (now.getTime() - last) / 86_400_000 >= BACKUP_REMINDER_DAYS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNumber(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !isNaN(new Date(value).getTime());
}

function isMonthOrDayDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}(-\d{2})?$/.test(value)) return false;
  const normalized = value.length === 7 ? `${value}-01` : value;
  return !isNaN(new Date(normalized).getTime());
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isValidSettings(value: unknown): value is Settings {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => entry == null || typeof entry === 'string')
  );
}

function isValidAccount(value: unknown): value is Account {
  if (!isRecord(value) || typeof value.label !== 'string') return false;
  return (
    isOptionalString(value.id) &&
    isOptionalString(value.key) &&
    isOptionalString(value.moneyType) &&
    isOptionalString(value.institution) &&
    isOptionalString(value.country) &&
    isOptionalString(value.group) &&
    isOptionalString(value.color) &&
    isOptionalBoolean(value.isPrimaryInvestment) &&
    isOptionalFiniteNumber(value.order) &&
    isOptionalFiniteNumber(value.annualReturnPct) &&
    isOptionalFiniteNumber(value.contribAmount) &&
    isOptionalString(value.contribInterval) &&
    isOptionalBoolean(value.locked) &&
    isOptionalString(value.lockedUntil) &&
    isOptionalFiniteNumber(value.extraContrib)
  );
}

function isValidHolding(value: unknown): value is Holding {
  if (!isRecord(value)) return false;
  return (
    typeof value.isin === 'string' &&
    typeof value.name === 'string' &&
    typeof value.shortName === 'string' &&
    typeof value.color === 'string' &&
    typeof value.acc === 'boolean' &&
    typeof value.active === 'boolean' &&
    isOptionalFiniteNumber(value.targetPct) &&
    typeof value.assetClass === 'string' &&
    typeof value.region === 'string' &&
    typeof value.foldInto === 'string' &&
    isFiniteNumber(value.order) &&
    isOptionalFiniteNumber(value.ter) &&
    isOptionalString(value.notes)
  );
}

function isValidSnapshot(value: unknown): value is Snapshot {
  if (!isRecord(value) || !isMonthOrDayDate(value.date)) return false;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'date') continue;
    if (key === 'notes') {
      if (!isOptionalString(entry)) return false;
      continue;
    }
    if (!isFiniteNumber(entry)) return false;
  }
  return true;
}

function isValidTransaction(value: unknown): value is Transaction {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    isMonthOrDayDate(value.date) &&
    typeof value.source === 'string' &&
    isOptionalString(value.category) &&
    typeof value.type === 'string' &&
    typeof value.name === 'string' &&
    typeof value.isin === 'string' &&
    isFiniteNumber(value.shares) &&
    isFiniteNumber(value.price) &&
    isFiniteNumber(value.amount) &&
    isFiniteNumber(value.fee) &&
    isFiniteNumber(value.tax) &&
    typeof value.currency === 'string' &&
    isFiniteNumber(value.fxRate) &&
    isOptionalString(value.note)
  );
}

function isValidFxRateRecord(value: unknown): value is FxRateRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.base === 'string' &&
    typeof value.target === 'string' &&
    typeof value.date === 'string' &&
    isFiniteNumber(value.rate) &&
    typeof value.effectiveDate === 'string' &&
    typeof value.fetchedAt === 'string'
  );
}

function isValidHoldingMetadata(value: unknown): value is HoldingMetadata {
  if (!isRecord(value)) return false;
  return (
    typeof value.isin === 'string' &&
    isOptionalString(value.symbol) &&
    isOptionalString(value.exchange) &&
    isOptionalString(value.domicileCountry) &&
    isOptionalString(value.fundCurrency) &&
    (value.aum === null || isOptionalFiniteNumber(value.aum)) &&
    (value.inceptionDate === null || isOptionalString(value.inceptionDate)) &&
    (value.holdingsCount === null || isOptionalFiniteNumber(value.holdingsCount)) &&
    (value.sectors === null ||
      value.sectors === undefined ||
      (Array.isArray(value.sectors) &&
        value.sectors.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.industry === 'string' &&
            typeof entry.exposure === 'string',
        ))) &&
    (value.topHoldings === null ||
      value.topHoldings === undefined ||
      (Array.isArray(value.topHoldings) &&
        value.topHoldings.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.asset === 'string' &&
            typeof entry.weightPercentage === 'string',
        ))) &&
    typeof value.fetchedAt === 'string' &&
    typeof value.lastRefreshedAt === 'string' &&
    typeof value.provider === 'string'
  );
}
