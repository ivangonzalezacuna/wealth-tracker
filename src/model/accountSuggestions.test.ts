import { describe, expect, it } from 'vitest';
import {
  accountCountryLinks,
  accountCurrencyList,
  countryOptions,
  currencyForCountry,
  accountSuggestions,
} from './accountSuggestions';
import type { Account } from '../types';

const acct = (over: Partial<Account>): Account => ({
  id: over.label ?? 'a',
  label: 'A',
  moneyType: 'investment',
  color: '#888888',
  ...over,
});

describe('account suggestions', () => {
  it('offers only currencies in use, always including EUR', () => {
    expect(accountCurrencyList([])).toEqual(['EUR']);
    expect(accountCurrencyList([acct({ currency: 'usd' }), acct({})], ['GBP', 'x', ''])).toEqual([
      'EUR',
      'GBP',
      'USD',
    ]);
  });

  it('links each country to its most used currency, falling back to built-in defaults', () => {
    const links = accountCountryLinks([
      acct({ country: 'Spain', currency: 'usd' }),
      acct({ country: 'Spain', currency: 'USD' }),
      acct({ country: 'Spain' }),
      acct({ currency: 'GBP' }),
    ]);
    expect(links).toEqual({ Spain: 'USD' });
    expect(currencyForCountry(' spain ', links)).toBe('USD');
    expect(currencyForCountry('Switzerland', links)).toBe('CHF');
    expect(currencyForCountry('USA')).toBe('USD');
    expect(currencyForCountry('Atlantis')).toBeUndefined();
    // The same country in another language reuses the user's own currency.
    expect(currencyForCountry('España', links)).toBe('USD');
    expect(currencyForCountry('Schweiz')).toBe('CHF');
    expect(currencyForCountry('')).toBeUndefined();
  });
  it('builds country options from stored countries, then uncovered built-in ones', () => {
    const options = countryOptions(['Alemania'], { Alemania: 'USD' });
    expect(options[0]).toEqual({ value: 'Alemania', hint: 'USD' });
    expect(options.some((o) => o.value === 'Germany')).toBe(false);
    expect(options).toContainEqual({ value: 'Switzerland', hint: 'CHF' });
  });

  it('drops a value once no account uses it and lists newly typed ones', () => {
    const before = accountSuggestions([
      acct({ label: 'A', institution: 'Old Bank', group: 'Retirement', country: 'Spain' }),
      acct({ label: 'B', institution: 'Broker' }),
    ]);
    expect(before.institutionSuggestions).toEqual(['Broker', 'Old Bank']);
    const after = accountSuggestions([
      acct({ label: 'B', institution: 'Broker' }),
      acct({ label: 'C', institution: 'New Bank', group: 'Fun money' }),
    ]);
    expect(after.institutionSuggestions).toEqual(['Broker', 'New Bank']);
    expect(after.groupSuggestions).toEqual(['Fun money']);
    expect(after.countrySuggestions).toEqual([]);
  });
});
