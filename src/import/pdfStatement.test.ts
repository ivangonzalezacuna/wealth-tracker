import { describe, expect, it } from 'vitest';
import {
  germanCents,
  mergeStatement,
  parseTradeRepublic,
  positionedLines,
  PdfValidationError,
  safePdfMessage,
  PDF_ERROR,
} from './pdfStatement';
import {
  realisticStatementFixture as statementFixture,
  statementFixture as smallStatementFixture,
  syntheticPdf,
} from '../../tests/e2e/fixtures/pdfStatement';

const now = new Date(2026, 9, 4);
const parse = (lines = statementFixture(), pages = 2) => parseTradeRepublic(lines, pages, now);
const expectedHoldings = [
  { isin: 'DE0000000016', value: 234.56 },
  { isin: 'DE0000000024', value: 100 },
  { isin: 'DE0000000032', value: 150 },
  { isin: 'DE0000000040', value: 175 },
  { isin: 'DE0000000057', value: 200 },
  { isin: 'DE0000000065', value: 125 },
  { isin: 'DE0000000073', value: 250 },
];
// Mapping tests explicitly exclude the six other securities.
const otherIsins = expectedHoldings.slice(1).map((h) => h.isin);
const firstHolding = (lines: ReturnType<typeof statementFixture>) =>
  lines.find((l) => l.cells.some((c) => c.text === 'Synthetic Global Equity USD (Acc)'))!;
const accounts = [
  { id: 'cash', label: 'Cash', moneyType: 'cash' },
  { id: 'broker', label: 'Broker', moneyType: 'investment', isPrimaryInvestment: true },
  { id: 'usd', label: 'USD', currency: 'USD', moneyType: 'cash' },
];
describe('local PDF statement', () => {
  it('continues to support the original one-position fixture', () => {
    expect(parse(smallStatementFixture()).holdings).toEqual([
      { isin: 'DE0000000016', value: 1234.56 },
    ]);
  });
  it('generates an independent A4 PDF with glyph-level font changes', () => {
    const pdf = new TextDecoder('latin1').decode(syntheticPdf(statementFixture()));
    expect(pdf).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(pdf).toContain('/BaseFont /Helvetica-Oblique');
    expect(pdf.match(/\/F2 7 Tf/g)!.length).toBeGreaterThan(100);
  });
  it('extracts only reconciled safe balances and identifiers', () => {
    expect(parse()).toEqual({
      valuationDate: '2026-09-30',
      cash: 100,
      brokerage: 1234.56,
      total: 1334.56,
      holdings: expectedHoldings,
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
    expect(parse(lines).holdings).toEqual(expectedHoldings);
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
    firstHolding(lines).cells[0].text = quantity;
    expect(parse(lines).holdings).toEqual(expectedHoldings);
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
    firstHolding(lines).cells[0].text = quantity;
    expect(() => parse(lines)).toThrow();
  });
  it('does not accept a quantity from the security name or unit-price column', () => {
    const lines = statementFixture();
    const row = firstHolding(lines);
    row.cells[0].text = 'invalid';
    row.cells[1].text = '1.000';
    row.cells[2].text = '1.234,5678 Stk.';
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
    ['ANZAHL POSITIONEN: 7', 'ANZAHL POSITIONEN: 8'],
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
    try {
      parse(statementFixture().filter((l) => l.page === 1));
      expect.fail('A missing page must not import');
    } catch (error) {
      expect(error).toBeInstanceOf(PdfValidationError);
      expect((error as PdfValidationError).code).toBe('pages');
    }
    expect(() =>
      parse(
        statementFixture().filter((l) => l.page === 1),
        1,
      ),
    ).toThrow();
    const lines = statementFixture();
    const cashDate = lines.find((l) =>
      l.cells.some((c) => c.text.startsWith('Aufstellung über das Cash')),
    )!;
    cashDate.cells[0].text = cashDate.cells[0].text.replace('30.09.2026', '31.08.2026');
    expect(() => parse(lines)).toThrow();
    const duplicate = statementFixture();
    duplicate.push({ ...firstHolding(duplicate), y: firstHolding(duplicate).y - 1 });
    expect(() => parse(duplicate)).toThrow();
  });
  it('merges allowlisted values without FX, PII, stale ETF values or unrelated zeros', () => {
    const snap = mergeStatement(
      parse(),
      accounts,
      ['DE0000000016', 'DE0000000081'],
      'cash',
      'broker',
      otherIsins,
      {
        date: '2026-09',
        usd: 999.123,
        notes: 'User note',
        cash: 9,
        broker: 10,
        etf_DE0000000081: 100,
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
      etf_DE0000000016: 234.56,
    });
    expect(
      mergeStatement(
        parse(),
        accounts,
        [],
        'cash',
        'broker',
        expectedHoldings.map((h) => h.isin),
      ),
    ).toEqual({
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
          otherIsins,
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
      mergeStatement(parse(), accounts, ['DE0000000016'], 'cash', 'broker', otherIsins, {
        date: '2026-08',
        arbitrary: 45,
      }),
    ).toEqual({
      date: '2026-09',
      cash: 100,
      broker: 1234.56,
      etf_DE0000000016: 234.56,
    });
  });
  it('requires explicit unknown exclusion and distinct EUR mappings', () => {
    expect(() => mergeStatement(parse(), accounts, [], 'cash', 'broker', [])).toThrow(/unknown/);
    expect(() => mergeStatement(parse(), accounts, [], 'usd', 'broker', [])).toThrow(/EUR/);
    expect(() => mergeStatement(parse(), accounts, [], 'broker', 'broker', [])).toThrow();
  });
  it.each(['characters', 'words', 'mixed'] as const)(
    'parses shuffled %s fragments with kerning, whitespace and baseline jitter',
    (mode) => {
      const lines = [1, 2].flatMap((page) => {
        const items = statementFixture()
          .filter((l) => l.page === page)
          .flatMap((line) =>
            line.cells.flatMap((cell, cellIndex) => {
              const parts =
                mode === 'characters' || (mode === 'mixed' && cellIndex % 2)
                  ? [...cell.text]
                  : cell.text.match(/\S+|\s+/g)!;
              let x = cell.x;
              return parts.map((part, index) => {
                const width = part.length * 2.8;
                const item = {
                  str: part.replace(/ /g, index % 2 ? '\u00a0' : '\u2009'),
                  width,
                  transform: [1, 0, 0, 1, x, line.y + (index % 3) * 0.35],
                  hasEOL: index === parts.length - 1,
                };
                x += width + (part.trim() ? 0.1 : 0);
                return item;
              });
            }),
          )
          .reverse();
        return positionedLines(items, page);
      });
      expect(parse(lines).holdings).toEqual(expectedHoldings);
    },
  );
  it('uses header column geometry rather than the left edge of right-aligned amounts', () => {
    const lines = statementFixture();
    const header = lines.find((l) => l.cells.some((c) => c.text === 'STK./NOMINALE'))!;
    expect(firstHolding(lines).cells[3].x).toBeLessThan(header.cells[3].x);
    for (const line of lines) {
      for (const cell of line.cells) {
        if (cell.x >= 430 && /^\d/.test(cell.text)) cell.x -= 20;
      }
    }
    expect(parse(lines).holdings).toEqual(expectedHoldings);
  });
  it('recognizes wrapped words in all brokerage header columns', () => {
    const lines = statementFixture();
    const header = lines.find((l) => l.cells.some((c) => c.text === 'STK./NOMINALE'))!;
    const continued = lines.find((l) => l.page === 1 && l.y === header.y - 12)!;
    header.cells = [
      { x: 30, text: 'STK./' },
      { x: 145, text: 'WERTPAPIER' },
      { x: 335, text: 'KURS PRO' },
      { x: 480, text: 'KURS' },
    ];
    continued.cells = [
      { x: 30, text: 'NOMINALE' },
      { x: 145, text: 'BEZEICHNUNG' },
      { x: 335, text: 'STÜCK' },
      { x: 480, text: 'WERT IN EUR' },
    ];
    expect(parse(lines).holdings).toEqual(expectedHoldings);
  });
  it('recognizes a value header split into KURS and WERT on the same baseline', () => {
    const lines = statementFixture();
    const header = lines.find((l) => l.cells.some((c) => c.text === 'STK./NOMINALE'))!;
    header.cells.splice(3, 1, { x: 480, text: 'KURS' }, { x: 500, text: 'WERT IN' });
    expect(parse(lines).holdings).toEqual(expectedHoldings);
  });
  it.each(['', ' ', '\u00a0', '\u2009'])(
    'accepts harmless punctuation whitespace %j without weakening anchored labels',
    (space) => {
      const lines = statementFixture();
      for (const line of lines) {
        for (const cell of line.cells) {
          cell.text = cell.text.replace(/(ISIN|ANZAHL POSITIONEN): /g, `$1${space}:${space}`);
        }
      }
      expect(parse(lines).holdings).toEqual(expectedHoldings);
    },
  );
  it.each(['ISIN:DE0000000016 extra', 'ANZAHL POSITIONEN:7 extra'])(
    'rejects appended text after an identifier or count: %s',
    (label) => {
      const lines = statementFixture();
      const original = label.startsWith('ISIN') ? 'ISIN: DE0000000016' : 'ANZAHL POSITIONEN: 7';
      const cell = lines.flatMap((l) => l.cells).find((c) => c.text === original)!;
      cell.text = label;
      expect(() => parse(lines)).toThrow(PdfValidationError);
    },
  );
  it('rejects foreign unit prices even when the market value is EUR', () => {
    const lines = statementFixture();
    firstHolding(lines).cells[2].text = '19,00 USD';
    expect(() => parse(lines)).toThrow(PdfValidationError);
  });
  it('accepts title and brand fragments without treating currency names as account currency', () => {
    const lines = statementFixture();
    const title = lines.find((l) => l.cells[0].text === 'VERMÖGENSÜBERSICHT')!;
    title.cells = [
      { x: 30, text: 'VERMÖGENS' },
      { x: 80, text: 'ÜBERSICHT' },
    ];
    expect(parse(lines).holdings).toEqual(expectedHoldings);
  });
  it.each(['1 234,56', '234,56 USD', '234,56 GBP', '234,56 EUR USD'])(
    'rejects an invalid market value %s even when it occurs in a valid report',
    (value) => {
      const lines = statementFixture();
      firstHolding(lines).cells[3].text = value;
      expect(() => parse(lines)).toThrow(PdfValidationError);
    },
  );
  it('does not erase real numeric gaps when PDF.js splits an amount', () => {
    const lines = statementFixture();
    const row = firstHolding(lines);
    row.cells.splice(3, 1, { x: 530, width: 3, text: '23' }, { x: 536, width: 12, text: '4,56' });
    expect(() => parse(lines)).toThrow(PdfValidationError);
  });
  it.each(['01.10.2026', '31.09.2026', '00.09.2026', '30.13.2026', '19,00 USD'])(
    'rejects inconsistent unit-price dates and currencies: %s',
    (value) => {
      const lines = statementFixture();
      const row = lines.find((l) => l.cells[0].text === 'ISIN: DE0000000016')!;
      row.cells[1].text = value;
      expect(() => parse(lines)).toThrow(PdfValidationError);
    },
  );
  it.each(['29.09.2026', '31.08.2026'])(
    'accepts earlier valid quote dates without changing the valuation month: %s',
    (quoteDate) => {
      const lines = statementFixture();
      const row = lines.find((l) => l.cells[0].text === 'ISIN: DE0000000016')!;
      row.cells[1].text = quoteDate;
      expect(parse(lines)).toEqual({
        valuationDate: '2026-09-30',
        cash: 100,
        brokerage: 1234.56,
        total: 1334.56,
        holdings: expectedHoldings,
      });
    },
  );
  it('validates high-precision EUR quotes without deriving market value from them', () => {
    const lines = statementFixture();
    firstHolding(lines).cells[2].text = '19,123456';
    expect(parse(lines).holdings).toEqual(expectedHoldings);
  });
  it.each([
    'missing count',
    'missing holding',
    'missing cash',
    'missing page footer',
    'duplicate ISIN',
  ])('rejects %s rather than importing a partial report', (mutation) => {
    let lines = statementFixture();
    if (mutation === 'missing count')
      lines = lines.filter((l) => !l.cells.some((c) => c.text.startsWith('ANZAHL POSITIONEN')));
    if (mutation === 'missing holding')
      lines = lines.filter((l) => l.y < 469 || l.y > 505 || l.page !== 1);
    if (mutation === 'missing cash') lines = lines.filter((l) => l.cells[0].text !== 'Cashkonto');
    if (mutation === 'missing page footer')
      lines = lines.filter((l) => !l.cells.some((c) => c.text === 'Seite 2 von 2'));
    if (mutation === 'duplicate ISIN') {
      const row = lines.find((l) => l.cells[0].text === 'ISIN: DE0000000024')!;
      row.cells[0].text = 'ISIN: DE0000000016';
    }
    expect(() => parse(lines)).toThrow(PdfValidationError);
  });
  it('returns only fixed allowlisted error messages', () => {
    const privateText = 'PRIVATE PERSON / private-statement.pdf / 991.234,56';
    expect(safePdfMessage(new Error(privateText))).toBe(PDF_ERROR);
    const error = new PdfValidationError('positions');
    error.message = privateText;
    expect(error.code).toBe('positions');
    expect(safePdfMessage(error)).toContain('[positions]');
    expect(safePdfMessage(error)).toMatch(/securities are incomplete/i);
    expect(safePdfMessage(error)).not.toContain(privateText);
    Object.assign(error, { code: privateText });
    expect(safePdfMessage(error)).toBe(PDF_ERROR);
    expect(safePdfMessage({ code: 'date', message: privateText })).toBe(PDF_ERROR);
  });
  it('merges all seven securities when they are registered', () => {
    const snap = mergeStatement(
      parse(),
      accounts,
      expectedHoldings.map((h) => h.isin),
      'cash',
      'broker',
      [],
    );
    for (const holding of expectedHoldings) expect(snap[`etf_${holding.isin}`]).toBe(holding.value);
    expect(snap.cash).toBe(100);
    expect(snap.broker).toBe(1234.56);
  });
});
