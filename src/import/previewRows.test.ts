import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types';
import {
  classifyPreviewRows,
  defaultExcluded,
  findOversells,
  isCanonicalType,
} from './previewRows';

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: '',
    date: '2026-01-01',
    source: 'trade_republic',
    type: 'BUY',
    name: 'Fund',
    isin: 'IE00TEST0001',
    shares: 1,
    price: 100,
    amount: -100,
    fee: 0,
    tax: 0,
    currency: 'EUR',
    fxRate: 1,
    ...over,
  };
}

describe('classifyPreviewRows', () => {
  it('labels new, duplicate and changed rows by txKey', () => {
    const stored = [tx({ id: 'a' }), tx({ id: 'b', amount: -50 })];
    const incoming = [tx({ id: 'a' }), tx({ id: 'b', amount: -55 }), tx({ id: 'c' })];
    const rows = classifyPreviewRows(stored, incoming);
    expect(rows.map((r) => r.status)).toEqual(['duplicate', 'changed', 'new']);
    expect(rows.map((r) => r.idx)).toEqual([0, 1, 2]);
  });

  it('flags unmapped types and number errors', () => {
    const bad = tx({ id: 'n' });
    const rows = classifyPreviewRows(
      [],
      [tx({ id: 'u', type: 'CRYPTO_REWARD' as Transaction['type'] }), bad],
      new Set([bad]),
    );
    expect(rows[0].unmapped).toBe(true);
    expect(rows[0].numberError).toBe(false);
    expect(rows[1].unmapped).toBe(false);
    expect(rows[1].numberError).toBe(true);
  });

  it('excludes new unmapped rows by default only', () => {
    const rows = classifyPreviewRows(
      [tx({ id: 'dup', type: 'ODD' as Transaction['type'] })],
      [
        tx({ id: 'dup', type: 'ODD' as Transaction['type'] }),
        tx({ id: 'u', type: 'ODD' as Transaction['type'] }),
        tx({ id: 'ok' }),
      ],
    );
    expect([...defaultExcluded(rows)]).toEqual([1]);
  });

  it('recognises canonical types', () => {
    expect(isCanonicalType('DIVIDEND')).toBe(true);
    expect(isCanonicalType('CRYPTO_REWARD')).toBe(false);
  });
});

describe('findOversells', () => {
  it('flags an incoming SELL without enough shares', () => {
    const sell = tx({ id: 's', type: 'SELL', shares: 2, amount: 200, date: '2026-02-01' });
    const flagged = findOversells([tx({ id: 'b', shares: 1 })], [sell]);
    expect([...flagged]).toEqual([sell]);
  });

  it('accepts SELLs covered by stored or incoming BUYs', () => {
    const buy = tx({ id: 'b2', shares: 1, date: '2026-01-15' });
    const sell = tx({ id: 's', type: 'SELL', shares: 2, amount: 200, date: '2026-02-01' });
    expect(findOversells([tx({ id: 'b', shares: 1 })], [buy, sell]).size).toBe(0);
  });

  it('applies splits before later sells', () => {
    const split = tx({ id: 'x', type: 'SPLIT', shares: 3, amount: 0, date: '2026-01-10' });
    const sell = tx({ id: 's', type: 'SELL', shares: 3, amount: 300, date: '2026-02-01' });
    expect(findOversells([tx({ id: 'b', shares: 1 })], [split, sell]).size).toBe(0);
  });

  it('blames earlier incoming SELLs when a stored SELL would oversell', () => {
    const early = tx({ id: 'e', type: 'SELL', shares: 1, amount: 100, date: '2026-01-15' });
    const stored = [
      tx({ id: 'b', shares: 1 }),
      tx({ id: 'later', type: 'SELL', shares: 1, amount: 100, date: '2026-03-01' }),
    ];
    expect([...findOversells(stored, [early])]).toEqual([early]);
  });
});
