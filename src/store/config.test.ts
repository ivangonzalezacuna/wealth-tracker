import { describe, it, expect, vi } from 'vitest';

// Mock the sheets API and other deps before importing the module under test
vi.mock('../sheets/api', () => ({
  readRange: vi.fn(async () => []),
  writeRange: vi.fn(async () => {}),
  appendRows: vi.fn(async () => {}),
  ensureSheets: vi.fn(async () => {}),
}));

vi.mock('../config', () => ({
  CONFIG: { accounts: [], holdings: [], projection: {}, targetAllocation: {}, reinvestmentRules: {} },
}));

import { parseAccounts, setAccounts } from './config';
import { writeRange } from '../sheets/api';

describe('parseAccounts', () => {
  it('legacy sheet (no new columns) defaults to annualReturnPct:0, contribAmount:0, contribInterval:monthly', () => {
    const rows: (string | number | boolean)[][] = [
      ['id', 'moneyType', 'institution', 'label', 'color', 'isPrimaryInvestment', 'order'],
      ['acct1', 'investment', 'TR', 'Main', '#111', true, 1],
      ['acct2', 'cash', 'N26', 'Cash', '#222', false, 2],
    ];
    const accounts = parseAccounts(rows);
    expect(accounts).toHaveLength(2);
    for (const a of accounts) {
      expect(a.annualReturnPct).toBe(0);
      expect(a.contribAmount).toBe(0);
      expect(a.contribInterval).toBe('monthly');
    }
  });

  it('new-format sheet parses annualReturnPct, contribAmount, contribInterval correctly', () => {
    const rows: (string | number | boolean)[][] = [
      [
        'id', 'moneyType', 'institution', 'label', 'color', 'isPrimaryInvestment', 'order',
        'annualReturnPct', 'contribAmount', 'contribInterval',
      ],
      ['acct1', 'investment', 'TR', 'Main', '#111', true, 1, 5, 200, 'quarterly'],
    ];
    const accounts = parseAccounts(rows);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].annualReturnPct).toBe(5);
    expect(accounts[0].contribAmount).toBe(200);
    expect(accounts[0].contribInterval).toBe('quarterly');
  });

  it('coerces an invalid contribInterval string to monthly', () => {
    const rows: (string | number | boolean)[][] = [
      [
        'id', 'moneyType', 'institution', 'label', 'color', 'isPrimaryInvestment', 'order',
        'annualReturnPct', 'contribAmount', 'contribInterval',
      ],
      ['acct1', 'investment', 'TR', 'Main', '#111', true, 1, 7, 100, 'daily'],
    ];
    const accounts = parseAccounts(rows);
    expect(accounts[0].contribInterval).toBe('monthly');
  });
});

describe('setAccounts', () => {
  it('writes a header array of length 10 ending in the three new columns', async () => {
    const accounts = [
      {
        id: 'acct1',
        moneyType: 'investment',
        institution: 'TR',
        label: 'Main',
        color: '#111',
        isPrimaryInvestment: true,
        order: 1,
        annualReturnPct: 7,
        contribAmount: 50,
        contribInterval: 'monthly' as const,
      },
    ];
    await setAccounts(accounts);
    const calls = (writeRange as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    const hdr = lastCall[1][0]; // first row is the header
    expect(hdr).toHaveLength(10);
    expect(hdr.slice(-3)).toEqual(['annualReturnPct', 'contribAmount', 'contribInterval']);
  });
});
