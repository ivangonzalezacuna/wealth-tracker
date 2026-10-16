import { afterEach, describe, expect, it } from 'vitest';
import { getSnapshotParser, parseSnapshotStatement, snapshotParsers } from './snapshotParsers';
import {
  fictionalBalanceParser,
  fictionalBalanceLines,
} from '../../tests/fixtures/snapshot-import/balanceParser';
import { syntheticPages } from '../../tests/fixtures/snapshot-import/synthetic';

afterEach(() => {
  snapshotParsers.splice(1);
});

describe('statement parser registry', () => {
  it('routes existing Trade Republic statements without changing the parsed values', () => {
    expect(parseSnapshotStatement(syntheticPages())).toMatchObject({
      documentType: 'trade-republic:valuation',
      total: 3707.62,
    });
  });
  it('routes a registered non-ETF report without changing extraction or UI code', () => {
    snapshotParsers.push(fictionalBalanceParser);
    expect(parseSnapshotStatement(syntheticPages([fictionalBalanceLines]))).toMatchObject({
      documentType: fictionalBalanceParser.id,
      positions: [],
      balances: { closing: 1234.56 },
    });
    expect(getSnapshotParser(fictionalBalanceParser.id).mapping.kind).toBe('balances');
  });
  it('does not fall through to another parser when a recognized report is invalid', () => {
    snapshotParsers.push(fictionalBalanceParser);
    expect(() =>
      parseSnapshotStatement(syntheticPages([fictionalBalanceLines.slice(0, 1)])),
    ).toThrow('Incomplete');
  });
  it('rejects unsupported, unknown and ambiguous report types', () => {
    expect(() => parseSnapshotStatement(syntheticPages([['unknown report']]))).toThrow(
      'Unsupported',
    );
    expect(() => getSnapshotParser('unknown')).toThrow('Unsupported');
    snapshotParsers.push({ ...snapshotParsers[0], id: 'ambiguous:test', matches: () => true });
    expect(() => parseSnapshotStatement(syntheticPages())).toThrow('Ambiguous');
  });
  it('rejects non-EUR output rather than relabelling it', () => {
    const statement = fictionalBalanceParser.parse(syntheticPages([fictionalBalanceLines]));
    Reflect.set(statement, 'currency', 'USD');
    snapshotParsers.push({ ...fictionalBalanceParser, parse: () => statement });
    expect(() => parseSnapshotStatement(syntheticPages([fictionalBalanceLines]))).toThrow(
      'currency',
    );
  });
  it('rejects mismatched types and unsafe values at the shared boundary', () => {
    const statement = fictionalBalanceParser.parse(syntheticPages([fictionalBalanceLines]));
    for (const invalid of [
      { ...statement, documentType: 'other:report' },
      { ...statement, balances: { closing: NaN } },
      { ...statement, balances: { closing: Infinity } },
      { ...statement, balances: { closing: Number.MAX_SAFE_INTEGER } },
      { ...statement, positions: [{ isin: 'not-supported', name: 'Fund', value: 1, page: 1 }] },
    ]) {
      snapshotParsers.splice(1);
      snapshotParsers.push({ ...fictionalBalanceParser, parse: () => invalid });
      expect(() => parseSnapshotStatement(syntheticPages([fictionalBalanceLines]))).toThrow();
    }
  });
});
