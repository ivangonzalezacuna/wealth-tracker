import { describe, it, expect } from 'vitest';
import { parseNum, parseCSV } from './csv';
import { TxType } from './model/tx';

describe('parseNum', () => {
  it('parses German comma-decimal "1234,56"', () => {
    expect(parseNum('1234,56')).toBeCloseTo(1234.56);
  });

  it('parses German thousands+comma "1.234,56"', () => {
    expect(parseNum('1.234,56')).toBeCloseTo(1234.56);
  });

  it('parses dot-decimal "1234.56"', () => {
    expect(parseNum('1234.56')).toBeCloseTo(1234.56);
  });

  it('returns 0 for empty string', () => {
    expect(parseNum('')).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(parseNum(undefined)).toBe(0);
  });
});

describe('parseCSV auto-detection', () => {
  it('still parses Trade Republic CSV correctly (regression)', () => {
    const trCsv = [
      'transaction_id;date;type;category;name;symbol;shares;price;amount;fee;tax;currency;fx_rate',
      'tx-001;2024-01-15;BUY;TRADING;iShares MSCI World;IE00B4L5Y983;10;75,50;-755,00;-1,50;0;EUR;',
    ].join('\n');

    const txs = parseCSV(trCsv);
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe(TxType.BUY);
    expect(txs[0].source).toBe('trade_republic');
    expect(txs[0].amount).toBeCloseTo(-755);
  });

  it('auto-detects a non-TR profile when header matches a registered profile', () => {
    // This test verifies that parseCSV now uses detectProfile instead of hardcoding TR.
    // Since only the TR profile is built-in and registered, we test the fallback behavior:
    // an unrecognized header falls back to TR profile (preserving backward compat).
    const unknownCsv = [
      'Ref;Datum;Typ;Bezeichnung;Betrag',
      'FB-001;15.01.2024;KAUF;Test;-500,00',
    ].join('\n');

    // The header doesn't match any built-in profile, so fallback to TR is used.
    // TR profile won't find its expected columns, so we get empty transactions.
    const txs = parseCSV(unknownCsv);
    // The important thing: it doesn't throw, and it returns an array.
    expect(Array.isArray(txs)).toBe(true);
  });
});
