import { describe, expect, it } from 'vitest';
import {
  parseStatementAmount,
  parseTradeRepublicStatement,
  statementLines,
} from './snapshotTradeRepublic';
import {
  FAKE_CASH,
  FAKE_ISINS,
  FAKE_SECURITIES,
  FAKE_TOTAL,
  FAKE_VALUES,
  syntheticPages,
  syntheticStatementLines,
} from '../../tests/fixtures/snapshot-import/synthetic';

describe('Trade Republic valuation parser (synthetic data only)', () => {
  it('extracts printed values, normalized identifiers, wrapped names and exact reconciled totals', () => {
    const result = parseTradeRepublicStatement(syntheticPages());
    expect(result).toMatchObject({
      date: '2024-01-31',
      currency: 'EUR',
      securities: FAKE_SECURITIES,
      cash: FAKE_CASH,
      total: FAKE_TOTAL,
      warnings: [],
    });
    expect(result.positions.map((p) => p.isin)).toEqual(FAKE_ISINS);
    expect(result.positions.map((p) => p.value)).toEqual(FAKE_VALUES);
    expect(result.positions[2].name).toBe('Fictional fund 3 USD (Acc) Synthetic wrapped name');
    expect(result.positions[0].value).not.toBe(1.123456 * 10);
  });

  it('reconstructs shuffled text items by page coordinates', () => {
    const pages = syntheticPages();
    pages[0].items.reverse();
    expect(parseTradeRepublicStatement(pages).positions).toHaveLength(7);
    expect(
      statementLines({
        items: [
          { text: 'right', x: 30, y: 100 },
          { text: 'left', x: 1, y: 101 },
        ],
      }),
    ).toEqual(['left right']);
  });

  it('keeps incomplete positions but never proposes unverifiable totals', () => {
    const result = parseTradeRepublicStatement(syntheticPages().slice(0, 1));
    expect(result.positions).toHaveLength(7);
    expect(result.total).toBeUndefined();
    expect(result.securities).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('missing');
  });

  it.each([
    [
      'duplicate ISIN',
      (s: string[][]) => {
        s[0] = s[0].map((v) => v.replace(FAKE_ISINS[1], FAKE_ISINS[0]));
      },
      /Duplicate/,
    ],
    [
      'invalid ISIN',
      (s: string[][]) => {
        s[0] = s[0].map((v) => v.replace(FAKE_ISINS[0], 'not-an-isin'));
      },
      /ISIN/,
    ],
    [
      'wrong securities',
      (s: string[][]) => {
        s[0][5] = 'Brokerage 2.000,00';
      },
      /reconcile/,
    ],
    [
      'wrong cash',
      (s: string[][]) => {
        s[1][3] = 'Cashkonto 500,00 EUR';
      },
      /Cash/,
    ],
    [
      'wrong total',
      (s: string[][]) => {
        s[0][7] = 'GESAMT 9.999,00 EUR';
      },
      /reconcile/,
    ],
    [
      'wrong date',
      (s: string[][]) => {
        s[1][1] = 'Cash zum 29.02.2023';
      },
      /date/,
    ],
    [
      'inconsistent dates',
      (s: string[][]) => {
        s[1][1] = 'Cash zum 29.02.2024';
      },
      /date/,
    ],
    [
      'duplicate page',
      (s: string[][]) => {
        s[1][4] = 'Seite 1 von 2';
      },
      /duplicate/,
    ],
    [
      'unknown translation',
      (s: string[][]) => {
        s[0][1] = 'UNVERIFIED ENGLISH TITLE';
      },
      /English labels are not verified/,
    ],
    [
      'missing currency header',
      (s: string[][]) => {
        s[0] = s[0].map((v) => v.replaceAll('KURSWERT IN EUR', 'KURSWERT IN USD'));
      },
      /columns/,
    ],
  ] as const)('rejects %s explicitly', (_name, mutate, message) => {
    const lines = syntheticStatementLines();
    mutate(lines);
    expect(() => parseTradeRepublicStatement(syntheticPages(lines))).toThrow(message);
  });

  it('does not propose balances when position count is incomplete', () => {
    const lines = syntheticStatementLines();
    lines[0] = lines[0].map((v) => v.replace('POSITIONEN: 7', 'POSITIONEN: 8'));
    expect(parseTradeRepublicStatement(syntheticPages(lines)).total).toBeUndefined();
  });

  it.each([
    '1.234',
    '12,3',
    '1,234.56',
    '1,00suffix',
    'NaN',
    'Infinity',
    '-1,00',
    '',
    '99999999999999999999,00',
  ])('rejects invalid German amount %s', (value) => {
    expect(() => parseStatementAmount(value, 'de')).toThrow();
  });

  it('supports strict numeric conventions independently of gated English document labels', () => {
    expect(parseStatementAmount('1.234,56', 'de')).toBe(1234.56);
    expect(parseStatementAmount('1,234.56', 'en')).toBe(1234.56);
    expect(parseStatementAmount('0,00', 'de')).toBe(0);
    expect(() => parseStatementAmount('1.234,56', 'en')).toThrow();
  });
});
