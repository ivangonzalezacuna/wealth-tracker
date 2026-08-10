import { describe, it, expect } from 'vitest';
import {
  validatePrimaryInvestment,
  primaryInvestmentValue,
  validateAccountIds,
  validateAccountLabels,
} from './accounts';
import type { Account, Snapshot } from '../types';

describe('validatePrimaryInvestment', () => {
  it('returns null when no account is primary', () => {
    const accounts: Account[] = [{ label: 'Cash', moneyType: 'cash', isPrimaryInvestment: false }];
    expect(validatePrimaryInvestment(accounts)).toBeNull();
  });

  it('returns null when exactly one primary with moneyType "investment"', () => {
    const accounts: Account[] = [
      { label: 'TR Portfolio', moneyType: 'investment', isPrimaryInvestment: true },
      { label: 'N26', moneyType: 'savings', isPrimaryInvestment: false },
    ];
    expect(validatePrimaryInvestment(accounts)).toBeNull();
  });

  it('returns error when primary account has moneyType "cash"', () => {
    const accounts: Account[] = [
      { label: 'Cash Account', moneyType: 'cash', isPrimaryInvestment: true },
    ];
    const err = validatePrimaryInvestment(accounts);
    expect(err).not.toBeNull();
    expect(err).toContain('Cash Account');
    expect(err).toContain('not "investment"');
  });

  it('returns error when two accounts are primary (both investment)', () => {
    const accounts: Account[] = [
      { label: 'Broker A', moneyType: 'investment', isPrimaryInvestment: true },
      { label: 'Broker B', moneyType: 'investment', isPrimaryInvestment: true },
    ];
    const err = validatePrimaryInvestment(accounts);
    expect(err).not.toBeNull();
    expect(err).toContain('Only one account');
  });
});

describe('primaryInvestmentValue', () => {
  it('sums only isPrimaryInvestment accounts keyed by id', () => {
    const accounts: Account[] = [
      { id: 'tr_portfolio', label: 'TR', moneyType: 'investment', isPrimaryInvestment: true },
      { id: 'n26', label: 'N26', moneyType: 'savings', isPrimaryInvestment: false },
    ];
    const snap: Snapshot = { date: '2026-06', tr_portfolio: 15000, n26: 3000 };
    expect(primaryInvestmentValue(snap, accounts)).toBe(15000);
  });

  describe('validateAccountIds', () => {
    it('accepts valid ids', () => {
      const accounts: Account[] = [
        { id: 'broker_1', label: 'Broker' },
        { id: 'cash_2', label: 'Cash' },
      ];
      expect(validateAccountIds(accounts)).toBeNull();
    });

    it('rejects empty id', () => {
      const accounts: Account[] = [{ id: '', label: 'No ID' }];
      expect(validateAccountIds(accounts)).toContain('empty ID');
    });

    it('rejects duplicate ids', () => {
      const accounts: Account[] = [
        { id: 'same_id', label: 'A' },
        { id: 'same_id', label: 'B' },
      ];
      expect(validateAccountIds(accounts)).toContain('Duplicate account ID');
    });

    it('rejects reserved etf_ prefix', () => {
      const accounts: Account[] = [{ id: 'etf_broker', label: 'ETF Broker' }];
      expect(validateAccountIds(accounts)).toContain('reserved');
    });
  });

  describe('validateAccountLabels', () => {
    it('returns null when all labels contain alphanumeric characters', () => {
      const accounts: Account[] = [
        { label: 'Main Account', moneyType: 'investment' },
        { label: 'N26', moneyType: 'savings' },
      ];
      expect(validateAccountLabels(accounts)).toBeNull();
    });

    it('returns null for empty labels (empty-name check is handled separately)', () => {
      const accounts: Account[] = [{ label: '', moneyType: 'cash' }];
      expect(validateAccountLabels(accounts)).toBeNull();
    });

    it('rejects labels with only symbols like "!"', () => {
      const accounts: Account[] = [{ label: '!', moneyType: 'cash' }];
      const err = validateAccountLabels(accounts);
      expect(err).not.toBeNull();
      expect(err).toContain('!');
      expect(err).toContain('letter or digit');
    });

    it('rejects labels with only punctuation', () => {
      const accounts: Account[] = [{ label: '---', moneyType: 'cash' }];
      expect(validateAccountLabels(accounts)).not.toBeNull();
    });

    it('accepts labels mixing letters and symbols', () => {
      const accounts: Account[] = [{ label: 'N26 (main)', moneyType: 'savings' }];
      expect(validateAccountLabels(accounts)).toBeNull();
    });

    it('rejects duplicate labels after trimming and lowercasing', () => {
      const accounts: Account[] = [
        { label: 'Main Portfolio', moneyType: 'investment' },
        { label: '  main portfolio  ', moneyType: 'cash' },
      ];
      expect(validateAccountLabels(accounts)).toContain('Duplicate account name');
    });
  });

  it('returns null when no account is primary', () => {
    const accounts: Account[] = [
      { id: 'n26', label: 'N26', moneyType: 'savings', isPrimaryInvestment: false },
    ];
    const snap: Snapshot = { date: '2026-06', n26: 3000 };
    expect(primaryInvestmentValue(snap, accounts)).toBeNull();
  });

  it('returns null when snap is null', () => {
    const accounts: Account[] = [
      { id: 'tr', label: 'TR', moneyType: 'investment', isPrimaryInvestment: true },
    ];
    expect(primaryInvestmentValue(null, accounts)).toBeNull();
  });

  it('ignores non-primary balances in the same snapshot', () => {
    const accounts: Account[] = [
      { id: 'tr', label: 'TR', moneyType: 'investment', isPrimaryInvestment: true },
      { id: 'cash', label: 'Cash', moneyType: 'cash', isPrimaryInvestment: false },
    ];
    const snap: Snapshot = { date: '2026-06', tr: 10000, cash: 5000 };
    expect(primaryInvestmentValue(snap, accounts)).toBe(10000);
  });

  it('matches snapshot keys case-insensitively (reloaded lowercased header)', () => {
    const accounts: Account[] = [
      { id: 'TR_Portfolio', label: 'TR', moneyType: 'investment', isPrimaryInvestment: true },
    ];
    // After parseSnapshotRows, keys are lowercased
    const snap: Snapshot = { date: '2026-06', tr_portfolio: 12345.67 };
    expect(primaryInvestmentValue(snap, accounts)).toBeCloseTo(12345.67);
  });

  it('returns 0 (not null) when primary account value is 0', () => {
    const accounts: Account[] = [
      { id: 'tr', label: 'TR', moneyType: 'investment', isPrimaryInvestment: true },
    ];
    const snap: Snapshot = { date: '2026-06', tr: 0 };
    expect(primaryInvestmentValue(snap, accounts)).toBe(0);
  });

  it('returns null when primary account column is missing from snapshot', () => {
    const accounts: Account[] = [
      { id: 'tr', label: 'TR', moneyType: 'investment', isPrimaryInvestment: true },
    ];
    // Snapshot has no 'tr' key at all
    const snap: Snapshot = { date: '2026-06', cash: 5000 };
    expect(primaryInvestmentValue(snap, accounts)).toBeNull();
  });
});
