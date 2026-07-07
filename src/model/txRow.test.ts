import { describe, it, expect } from 'vitest';
import { newRowToTx, oldRowToTx } from './txRow';
import { txKey } from '../db';

describe('txRow shared parsers', () => {
  it('newRowToTx parses a 14-col row correctly', () => {
    const row = [
      'tx-001',
      '2024-01-15',
      'trade_republic',
      'BUY',
      'iShares MSCI World',
      'IE00B4L5Y983',
      '10',
      '75.50',
      '-755',
      '-1.5',
      '0',
      'EUR',
      '',
      'note text',
    ];
    const tx = newRowToTx(row);

    expect(tx.id).toBe('tx-001');
    expect(tx.date).toBe('2024-01-15');
    expect(tx.source).toBe('trade_republic');
    expect(tx.type).toBe('BUY');
    expect(tx.name).toBe('iShares MSCI World');
    expect(tx.isin).toBe('IE00B4L5Y983');
    expect(tx.symbol).toBe('IE00B4L5Y983');
    expect(tx.shares).toBeCloseTo(10);
    expect(tx.price).toBeCloseTo(75.5);
    expect(tx.amount).toBeCloseTo(-755);
    expect(tx.fee).toBeCloseTo(-1.5);
    expect(tx.tax).toBe(0);
    expect(tx.currency).toBe('EUR');
    expect(tx.note).toBe('note text');
  });

  it('oldRowToTx parses a 10-col row correctly', () => {
    const row = [
      'tx-001',
      '2024-01-15',
      'TRADING',
      'BUY',
      'iShares MSCI World',
      'IE00B4L5Y983',
      '10',
      '75.50',
      '-755',
      '0',
    ];
    const tx = oldRowToTx(row);

    expect(tx.id).toBe('tx-001');
    expect(tx.date).toBe('2024-01-15');
    expect(tx.source).toBe('trade_republic');
    expect(tx.type).toBe('BUY');
    expect(tx.isin).toBe('IE00B4L5Y983');
    expect(tx.shares).toBeCloseTo(10);
    expect(tx.amount).toBeCloseTo(-755);
    expect(tx.fee).toBe(0);
    expect(tx.currency).toBe('EUR');
  });

  it('14-col and equivalent 10-col rows produce equal txKey', () => {
    const newRow = [
      'tx-001',
      '2024-01-15',
      'trade_republic',
      'BUY',
      'iShares MSCI World',
      'IE00B4L5Y983',
      '10',
      '75.50',
      '-755',
      '-1.5',
      '0',
      'EUR',
      '',
      '',
    ];
    const oldRow = [
      'tx-001',
      '2024-01-15',
      'TRADING',
      'BUY',
      'iShares MSCI World',
      'IE00B4L5Y983',
      '10',
      '75.50',
      '-755',
      '0',
    ];

    const tx14 = newRowToTx(newRow);
    const tx10 = oldRowToTx(oldRow);

    // Both have id='tx-001' so txKey should be the id
    expect(txKey(tx14)).toBe(txKey(tx10));
    expect(txKey(tx14)).toBe('tx-001');
  });

  it('German-comma numerics parse correctly in 14-col row', () => {
    const row = [
      'tx-002',
      '2024-02-01',
      'trade_republic',
      'BUY',
      'iShares EM',
      'IE00BKM4GZ66',
      '5',
      '42,20',
      '-211,00',
      '0',
      '0',
      'EUR',
      '',
      '',
    ];
    const tx = newRowToTx(row);

    expect(tx.shares).toBeCloseTo(5);
    expect(tx.price).toBeCloseTo(42.2);
    expect(tx.amount).toBeCloseTo(-211);
  });

  it('handles numeric cell values (UNFORMATTED_VALUE mode)', () => {
    const row = [
      'tx-003',
      '2024-03-01',
      'trade_republic',
      'BUY',
      'Test ETF',
      'IE00TEST',
      10,
      75.5,
      -755,
      -1.5,
      0,
      'EUR',
      0,
      '',
    ];
    const tx = newRowToTx(row);

    expect(tx.shares).toBeCloseTo(10);
    expect(tx.price).toBeCloseTo(75.5);
    expect(tx.amount).toBeCloseTo(-755);
    expect(tx.fee).toBeCloseTo(-1.5);
  });
});
