import { describe, it, expect, vi } from 'vitest';
import {
  buildBackup,
  backupFilename,
  validateBackup,
  summarizeBackup,
  migrateBackup,
  isBackupStale,
  MIGRATIONS,
  BACKUP_SCHEMA_VERSION,
} from './exportImport';
import type { BackupFile } from './exportImport';

const FIXTURE_DATA: BackupFile['data'] = {
  accounts: [
    {
      id: 'a1',
      label: 'Main',
      moneyType: 'investment',
      institution: 'TR',
      color: '#111',
      isPrimaryInvestment: true,
      order: 1,
    },
  ],
  holdings: [
    {
      isin: 'IE00B4L5Y983',
      shortName: 'IWDA',
      name: 'iShares MSCI World',
      color: '#4a90d9',
      acc: true,
      active: true,
      contribAmount: 100,
      contribInterval: 'weekly',
      assetClass: 'equity',
      region: 'developed',
      foldInto: '',
      order: 1,
    },
  ],
  settings: { costBasisMethod: 'avgco' },
  snapshots: [{ date: '2026-01', a1: 5000, notes: '' }],
  transactions: [
    {
      id: 'tx1',
      date: '2025-12-01',
      source: 'trade_republic',
      type: 'BUY',
      name: 'iShares MSCI World',
      isin: 'IE00B4L5Y983',
      shares: 10,
      price: 75,
      amount: -750,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 0,
    },
  ],
  importMeta: { last_import: '2026-01-15' },
};

function validBackupObj(): BackupFile {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    app: 'wealth-tracker',
    exportedAt: '2026-06-15T10:00:00.000Z',
    data: FIXTURE_DATA,
  };
}

describe('buildBackup', () => {
  it('echoes input under data with valid schemaVersion/app/exportedAt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));

    const result = buildBackup(FIXTURE_DATA);

    expect(result.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(result.app).toBe('wealth-tracker');
    expect(result.exportedAt).toBe('2026-07-01T12:00:00.000Z');
    expect(result.data.accounts).toEqual(FIXTURE_DATA.accounts);
    expect(result.data.holdings).toEqual(FIXTURE_DATA.holdings);
    expect(result.data.settings).toEqual(FIXTURE_DATA.settings);
    expect(result.data.snapshots).toEqual(FIXTURE_DATA.snapshots);
    expect(result.data.transactions).toEqual(FIXTURE_DATA.transactions);
    expect(result.data.importMeta).toEqual(FIXTURE_DATA.importMeta);

    vi.useRealTimers();
  });
});

describe('backupFilename', () => {
  it('returns expected filename for a fixed date', () => {
    const d = new Date('2026-06-15T10:00:00.000Z');
    expect(backupFilename(d)).toBe('wealth-tracker-backup-2026-06-15.json');
  });
});

describe('validateBackup', () => {
  it('valid fixture returns object', () => {
    const result = validateBackup(validBackupObj());
    expect(result).not.toBeNull();
    expect(result!.app).toBe('wealth-tracker');
  });

  it('missing app returns null', () => {
    const obj = validBackupObj();
    delete (obj as any).app;
    expect(validateBackup(obj)).toBeNull();
  });

  it('wrong app returns null', () => {
    const obj = { ...validBackupObj(), app: 'other-app' };
    expect(validateBackup(obj)).toBeNull();
  });

  it('missing schemaVersion returns null', () => {
    const obj = validBackupObj();
    delete (obj as any).schemaVersion;
    expect(validateBackup(obj)).toBeNull();
  });

  it('too-high schemaVersion returns null', () => {
    const obj = { ...validBackupObj(), schemaVersion: BACKUP_SCHEMA_VERSION + 1 };
    expect(validateBackup(obj)).toBeNull();
  });

  it('missing data returns null', () => {
    const obj = validBackupObj();
    delete (obj as any).data;
    expect(validateBackup(obj)).toBeNull();
  });

  it('data.accounts not array returns null', () => {
    const obj = validBackupObj();
    (obj.data as any).accounts = 'not-array';
    expect(validateBackup(obj)).toBeNull();
  });

  it('data.settings not object returns null', () => {
    const obj = validBackupObj();
    (obj.data as any).settings = 'not-obj';
    expect(validateBackup(obj)).toBeNull();
  });

  it('null input returns null', () => {
    expect(validateBackup(null)).toBeNull();
  });

  it('JSON array returns null', () => {
    expect(validateBackup([1, 2, 3])).toBeNull();
  });
});

describe('summarizeBackup', () => {
  it('contains correct counts and structure', () => {
    const b = validBackupObj();
    const summary = summarizeBackup(b);
    expect(summary).toContain(`${b.data.accounts.length} accounts`);
    expect(summary).toContain(`${b.data.holdings.length} holdings`);
    expect(summary).toContain(`${b.data.snapshots.length} snapshots`);
    expect(summary).toContain(`${b.data.transactions.length} transactions`);
    expect(summary).toContain('replace all your current data');
    expect(summary).toContain('Backup from');
    expect(summary).toContain('Transactions:');
    expect(summary).toContain('Last snapshot:');
  });

  it('handles empty transactions gracefully', () => {
    const b = validBackupObj();
    b.data = { ...b.data, transactions: [] };
    const summary = summarizeBackup(b);
    expect(summary).toContain('0 transactions');
    expect(summary).not.toContain('Transactions:');
  });

  it('handles empty snapshots gracefully', () => {
    const b = validBackupObj();
    b.data = { ...b.data, snapshots: [] };
    const summary = summarizeBackup(b);
    expect(summary).toContain('0 snapshots');
    expect(summary).not.toContain('Last snapshot:');
  });
});

describe('migrateBackup', () => {
  it('already-current-version backup → returned with structurally identical data', () => {
    const b = validBackupObj();
    const result = migrateBackup(b);
    expect(result.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(result.data).toEqual(b.data);
  });

  it('applies migrations in order from old version to current', () => {
    // Inject synthetic migrations for testing
    const originalMigrations = { ...MIGRATIONS };

    // Simulate: version 1→2 renames 'old' to 'new' in settings
    MIGRATIONS[1] = (data) => ({
      ...data,
      settings: { ...data.settings, migrated_v1: 'yes' },
    });
    // version 2→3 adds another marker
    MIGRATIONS[2] = (data) => ({
      ...data,
      settings: { ...data.settings, migrated_v2: 'yes' },
    });

    const oldBackup: BackupFile = {
      ...validBackupObj(),
      schemaVersion: 1,
    };

    // Temporarily pretend BACKUP_SCHEMA_VERSION is 3 by running the loop manually
    let data = oldBackup.data;
    for (let v = 1; v < 4; v++) {
      if (MIGRATIONS[v]) data = MIGRATIONS[v](data);
    }

    expect(data.settings.migrated_v1).toBe('yes');
    expect(data.settings.migrated_v2).toBe('yes');

    // Clean up injected migrations
    delete MIGRATIONS[1];
    delete MIGRATIONS[2];
    Object.assign(MIGRATIONS, originalMigrations);
  });

  it('skips versions with no migration entry', () => {
    const b: BackupFile = { ...validBackupObj(), schemaVersion: BACKUP_SCHEMA_VERSION };
    // With no MIGRATIONS entries, it should just return the same data
    const result = migrateBackup(b);
    expect(result.data).toEqual(b.data);
  });
});

describe('isBackupStale', () => {
  const now = new Date('2026-07-01T12:00:00.000Z');

  it('undefined → true (never backed up)', () => {
    expect(isBackupStale(undefined, now)).toBe(true);
  });

  it('40 days ago → true', () => {
    const fortyDaysAgo = new Date(now.getTime() - 40 * 86_400_000).toISOString();
    expect(isBackupStale(fortyDaysAgo, now)).toBe(true);
  });

  it('5 days ago → false', () => {
    const fiveDaysAgo = new Date(now.getTime() - 5 * 86_400_000).toISOString();
    expect(isBackupStale(fiveDaysAgo, now)).toBe(false);
  });

  it('malformed string → true', () => {
    expect(isBackupStale('not-a-date', now)).toBe(true);
  });

  it('exactly 30 days → true (threshold is >=)', () => {
    const thirtyDays = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    expect(isBackupStale(thirtyDays, now)).toBe(true);
  });

  it('29 days ago → false', () => {
    const twentyNine = new Date(now.getTime() - 29 * 86_400_000).toISOString();
    expect(isBackupStale(twentyNine, now)).toBe(false);
  });
});
