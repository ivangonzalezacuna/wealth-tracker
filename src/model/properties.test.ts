import { describe, expect, it } from 'vitest';
import {
  estimateMortgagePayoff,
  parseProperties,
  propertyEquity,
  serializeProperties,
  totalPropertyEquity,
  type Property,
} from './properties';

const home: Property = {
  id: 'home',
  label: 'Home',
  use: 'Home',
  value: 420000,
  share: 50,
  valueDate: '2026-10-31',
  mortgage: 'known',
  debt: 140000,
  debtDate: '2026-10-31',
};
const terms = { annualRate: 3.5, monthlyPayment: 900 };

describe('informational property register', () => {
  it('supports old settings with no register and round trips versioned entries', () => {
    expect(parseProperties(undefined)).toEqual([]);
    expect(parseProperties(null)).toEqual([]);
    expect(parseProperties(serializeProperties([home]))).toEqual([home]);
    const estimated = { ...home, mortgageTerms: terms };
    expect(parseProperties(serializeProperties([estimated]))).toEqual([estimated]);
    expect(propertyEquity(estimated)).toBe(propertyEquity(home));
    expect(parseProperties(serializeProperties([]))).toEqual([]);
  });
  it('keeps owned value and personally attributed debt separate', () => {
    expect(propertyEquity(home)).toBe(70000);
    expect(propertyEquity({ ...home, share: 40, debt: 168000 })).toBe(0);
    expect(propertyEquity({ ...home, value: 200000, share: 100, debt: 240000 })).toBe(-40000);
    expect(
      propertyEquity({
        ...home,
        value: 360000,
        share: 100 / 3,
        mortgage: 'none',
        debt: null,
        debtDate: null,
      }),
    ).toBeCloseTo(120000);
    expect(
      totalPropertyEquity([
        home,
        { ...home, id: 'other', mortgage: 'unknown', debt: null, debtDate: null },
      ]),
    ).toBeNull();
  });
  it.each(['', 'not json', '[]', '{"version":2,"properties":[]}', '{"version":1}'])(
    'rejects invalid register %s rather than dropping it',
    (raw) => {
      expect(() => parseProperties(raw)).toThrow(/property register/);
    },
  );
  it.each([
    { share: 0 },
    { share: 101 },
    { value: -1 },
    { value: Infinity },
    { label: '  ' },
    { valueDate: '2026-02-30' },
    { debtDate: null },
    { mortgage: 'unknown' },
    { mortgage: 'none', debt: 0 },
    { mortgageTerms: { annualRate: 3.5 } },
    { mortgageTerms: { ...terms, annualRate: -1 } },
    { mortgageTerms: { ...terms, monthlyPayment: 0 } },
    { mortgageTerms: terms, debt: 0 },
    { mortgageTerms: terms, mortgage: 'none', debt: null, debtDate: null },
    { use: 'Invalid' },
  ])('rejects invalid property fields %j', (patch) => {
    expect(() => serializeProperties([{ ...home, ...patch } as Property])).toThrow();
  });

  describe('mortgage payoff estimate', () => {
    it('uses the statement month and recalculates after a lump-sum repayment', () => {
      expect(estimateMortgagePayoff(140000, '2026-11-30', terms)).toEqual({ month: '2044-03' });
      expect(estimateMortgagePayoff(130000, '2026-12-31', terms)).toEqual({ month: '2042-08' });
    });

    it('handles zero interest, the year boundary and a partial final payment', () => {
      expect(
        estimateMortgagePayoff(110, '2026-12-31', { annualRate: 0, monthlyPayment: 100 }),
      ).toEqual({ month: '2027-02' });
      expect(
        estimateMortgagePayoff(100, '2026-12-31', { annualRate: 0, monthlyPayment: 100 }),
      ).toEqual({ month: '2027-01' });
    });

    it('does not report a date when payments only cover interest or take over 50 years', () => {
      expect(
        estimateMortgagePayoff(120000, '2026-11-30', { annualRate: 4, monthlyPayment: 400 }),
      ).toEqual({ reason: 'interest' });
      expect(
        estimateMortgagePayoff(120000, '2026-11-30', { annualRate: 0, monthlyPayment: 100 }),
      ).toEqual({ reason: 'limit' });
    });
  });
  it('rejects duplicate IDs', () => {
    expect(() => serializeProperties([home, home])).toThrow();
  });
});
