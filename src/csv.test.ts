import { describe, it, expect } from 'vitest';
import { parseNum, parseCSV } from './csv';
import { TxType } from './types';

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
    const n26Csv = [
      'Booking Date,Value Date,Partner Name,Partner Iban,Type,Payment Reference,Account Name,Amount (EUR),Original Amount,Original Currency,Exchange Rate',
      '2024-01-01,2024-01-01,,,Interest,,Instant Savings,0.75,,,',
    ].join('\n');

    const txs = parseCSV(n26Csv);
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe(TxType.INTEREST);
    expect(txs[0].source).toBe('n26');
    expect(txs[0].amount).toBeCloseTo(0.75);
  });
});
