import { describe, expect, it } from 'vitest';
import { buildSecuritySuggestions, filterSecuritySuggestions } from './securitySuggestions';
import type { Transaction } from '../types';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'id',
    date: '2024-01-01',
    source: 'manual',
    type: 'BUY',
    name: '',
    isin: '',
    shares: 0,
    price: 0,
    amount: 0,
    fee: 0,
    tax: 0,
    currency: 'EUR',
    fxRate: 1,
    ...overrides,
  };
}

describe('security suggestions', () => {
  it('builds paired isin/name entries from transactions', () => {
    const suggestions = buildSecuritySuggestions([
      tx({ isin: ' ie00bbb ', name: 'Beta Fund' }),
      tx({ isin: 'IE00AAA', name: 'Alpha Fund' }),
      tx({ isin: 'IE00BBB', name: 'Beta Fund Updated' }),
      tx({ isin: 'IE00CCC', name: '' }),
    ]);
    expect(suggestions.pairs).toEqual([
      { isin: 'IE00AAA', name: 'Alpha Fund' },
      { isin: 'IE00BBB', name: 'Beta Fund Updated' },
    ]);
  });

  it('filters paired suggestions by existing isin list', () => {
    const filtered = filterSecuritySuggestions(
      {
        pairs: [
          { isin: 'IE00AAA', name: 'Alpha Fund' },
          { isin: 'IE00BBB', name: 'Beta Fund' },
        ],
      },
      [' ie00aaa '],
    );
    expect(filtered.pairs).toEqual([{ isin: 'IE00BBB', name: 'Beta Fund' }]);
  });

  it('filters suggestions even when suggestion isins are mixed-case', () => {
    const filtered = filterSecuritySuggestions(
      {
        pairs: [
          { isin: 'ie00aaa', name: 'Alpha Fund' },
          { isin: 'IE00BBB', name: 'Beta Fund' },
        ],
      },
      ['IE00AAA'],
    );
    expect(filtered.pairs).toEqual([{ isin: 'IE00BBB', name: 'Beta Fund' }]);
  });
});
