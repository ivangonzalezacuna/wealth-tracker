import { describe, expect, it } from 'vitest';
import { germanCents, mergeStatement, parseTradeRepublic, positionedLines } from './pdfStatement';
import { statementFixture } from '../../tests/e2e/fixtures/pdfStatement';

const now = new Date(2026, 9, 4);
const parse = (lines = statementFixture(), pages = 2) => parseTradeRepublic(lines, pages, now);
const accounts = [
  { id: 'cash', label: 'Cash', moneyType: 'cash' },
  { id: 'broker', label: 'Broker', moneyType: 'investment', isPrimaryInvestment: true },
  { id: 'usd', label: 'USD', currency: 'USD', moneyType: 'cash' },
];
describe('local PDF statement', () => {
  it('extracts only reconciled safe balances and identifiers', () => {
    expect(parse()).toEqual({
      valuationDate: '2026-09-30',
      cash: 100,
      brokerage: 1234.56,
      total: 1334.56,
      holdings: [{ isin: 'DE0000000016', value: 1234.56 }],
    });
    expect(JSON.stringify(parse())).not.toMatch(/PRIVATE|Synthetic|DEPOT|DATUM/);
  });
  it('sorts shuffled positioned cells without conflating price and value', () => {
    const lines = statementFixture().flatMap((l) =>
      positionedLines(
        l.cells
          .map((c) => ({
            str: c.text,
            transform: [1, 0, 0, 1, c.x, l.y],
            width: 50,
          }))
          .reverse(),
        l.page,
      ),
    );
    expect(parse(lines).holdings[0].value).toBe(1234.56);
  });
  it.each([
    '0',
    '10',
    '1000',
    '0,125',
    '10,123456',
    '1.000',
    '1.234,5678 Stk.',
    '12.345.678,0001',
    '123.456 Stk.',
  ])('accepts German share quantity %s without deriving market value', (quantity) => {
    const lines = statementFixture();
    lines[11].cells[0].text = quantity;
    expect(parse(lines).holdings).toEqual([{ isin: 'DE0000000016', value: 1234.56 }]);
  });
  it.each([
    '1.00',
    '1.0000',
    '1234.567',
    '1.23.456',
    '1.000.00',
    '01',
    '01.000',
    '00,1',
    '1,234.5678',
    '1.234,',
    '.5',
    ',5',
    '-1',
    '+1',
    '1e3',
    '1 000',
    '1.000 shares',
  ])('rejects malformed or foreign share quantity %s', (quantity) => {
    const lines = statementFixture();
    lines[11].cells[0].text = quantity;
    expect(() => parse(lines)).toThrow();
  });
  it('does not accept a quantity from the security name or unit-price column', () => {
    const lines = statementFixture();
    lines[11].cells[0].text = 'invalid';
    lines[11].cells[1].text = '1.000';
    lines[11].cells[2].text = '1.234,5678 Stk.';
    expect(() => parse(lines)).toThrow();
  });
  it.each([
    '1,234.56',
    '1.23,45',
    '-1,00',
    '+1,00',
    '1,0',
    '1,00 USD',
    'NaN',
    '1e3',
    '1,00 junk',
    '9007199254740992,00',
  ])('rejects unsafe locale amount %s', (value) => {
    expect(() => germanCents(value)).toThrow();
  });
  it.each([
    ['100,00', '100,01'],
    ['1.234,56 EUR', '1.234,55 EUR'],
    ['30.09.2026', '29.09.2026'],
    ['30.09.2026', '31.11.2026'],
    ['30.09.2026', '31.12.2026'],
    ['ANZAHL POSITIONEN: 1', 'ANZAHL POSITIONEN: 2'],
    ['DE0000000016', 'INVALID'],
    ['Cashkonto', 'Other cash'],
    ['VERMÖGENSÜBERSICHT', 'Other report'],
    ['Seite 2 von 2', 'Seite 2 von 3'],
  ])('fails closed on %s → %s', (before, after) => {
    const lines = statementFixture();
    for (const line of lines) for (const c of line.cells) c.text = c.text.replace(before, after);
    expect(() => parse(lines)).toThrow();
  });
  it('rejects truncated pages, duplicate rows and conflicting dates', () => {
    expect(() =>
      parse(
        statementFixture().filter((l) => l.page === 1),
        1,
      ),
    ).toThrow();
    const lines = statementFixture();
    lines[18].cells[0].text = lines[18].cells[0].text.replace('30.09.2026', '31.08.2026');
    expect(() => parse(lines)).toThrow();
    const duplicate = statementFixture();
    duplicate.splice(14, 0, ...duplicate.slice(11, 13));
    expect(() => parse(duplicate)).toThrow();
  });
  it('merges allowlisted values without FX, PII, stale ETF values or unrelated zeros', () => {
    const snap = mergeStatement(
      parse(),
      accounts,
      ['DE0000000016', 'DE0000000024'],
      'cash',
      'broker',
      [],
      {
        date: '2026-09',
        usd: 999.123,
        notes: 'User note',
        cash: 9,
        broker: 10,
        etf_DE0000000024: 100,
        filename: 'private.pdf',
        rawText: 'private',
      },
    );
    expect(snap).toEqual({
      date: '2026-09',
      usd: 999.123,
      notes: 'User note',
      cash: 100,
      broker: 1234.56,
      etf_DE0000000016: 1234.56,
    });
    expect(mergeStatement(parse(), accounts, [], 'cash', 'broker', ['DE0000000016'])).toEqual({
      date: '2026-09',
      cash: 100,
      broker: 1234.56,
    });
  });
  it.each([
    ['arbitrary', false, 45],
    ['retired', false, 0],
    ['legacy-account', true, 45],
    ['PRIVATE-KEY', false, -45],
  ])(
    'refuses to discard an unpreservable balance without exposing its key',
    (key, configured, value) => {
      const existing = { date: '2026-09', [key]: value };
      let error: unknown;
      try {
        mergeStatement(
          parse(),
          configured ? [...accounts, { id: key, label: 'Legacy' }] : accounts,
          ['DE0000000016'],
          'cash',
          'broker',
          [],
          existing,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('Resolve existing balances before importing');
      expect((error as Error).message).not.toContain(key);
      expect(existing).toEqual({ date: '2026-09', [key]: value });
    },
  );
  it('ignores unpreservable balances in a different month', () => {
    expect(
      mergeStatement(parse(), accounts, ['DE0000000016'], 'cash', 'broker', [], {
        date: '2026-08',
        arbitrary: 45,
      }),
    ).toEqual({
      date: '2026-09',
      cash: 100,
      broker: 1234.56,
      etf_DE0000000016: 1234.56,
    });
  });
  it('requires explicit unknown exclusion and distinct EUR mappings', () => {
    expect(() => mergeStatement(parse(), accounts, [], 'cash', 'broker', [])).toThrow(/unknown/);
    expect(() => mergeStatement(parse(), accounts, [], 'usd', 'broker', [])).toThrow(/EUR/);
    expect(() => mergeStatement(parse(), accounts, [], 'broker', 'broker', [])).toThrow();
  });
});
