import { describe, expect, it } from 'vitest';
import {
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

describe('informational property register', () => {
  it('supports old settings with no register and round trips versioned entries', () => {
    expect(parseProperties(undefined)).toEqual([]);
    expect(parseProperties(null)).toEqual([]);
    expect(parseProperties(serializeProperties([home]))).toEqual([home]);
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
    { use: 'Invalid' },
  ])('rejects invalid property fields %j', (patch) => {
    expect(() => serializeProperties([{ ...home, ...patch } as Property])).toThrow();
  });
  it('rejects duplicate IDs', () => {
    expect(() => serializeProperties([home, home])).toThrow();
  });
});
