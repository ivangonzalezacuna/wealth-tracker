import { describe, it, expect, vi } from 'vitest';
import {
  buildBackup,
  backupFilename,
  validateBackup,
  summarizeBackup,
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
      ticker: 'IWDA',
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
      symbol: '',
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
  it('contains correct counts', () => {
    const b = validBackupObj();
    const summary = summarizeBackup(b);
    expect(summary).toMatch(/\b1 holdings\b/);
    expect(summary).toMatch(/\b1 snapshots\b/);
    expect(summary).toMatch(/\b1 transactions\b/);
    expect(summary).toContain('replace everything');
  });
});
