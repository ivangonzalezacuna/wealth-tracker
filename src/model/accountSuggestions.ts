import type { Account } from '../types';
import { normalizeInstitution } from './securitySuggestions';
import {
  builtInCountries,
  countryCode,
  defaultCurrencyForCountry,
  normalizeCountry,
} from './countryCurrency';

function uniqueSorted(accounts: Account[], pick: (a: Account) => string): string[] {
  return [...new Set(accounts.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Currencies in use (accounts plus any extra codes, e.g. from transactions); EUR is always offered. */
export function accountCurrencyList(accounts: Account[], extra: readonly string[] = []): string[] {
  const used = [...accounts.map((a) => a.currency || 'EUR'), ...extra]
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{3}$/.test(c));
  return [...new Set(['EUR', ...used])].sort((a, b) => a.localeCompare(b));
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

/** Currency most used by the user's accounts in each country. */
export function accountCountryLinks(accounts: Account[]): Record<string, string> {
  const byCountry = new Map<string, string[]>();
  for (const a of accounts) {
    const country = (a.country || '').trim();
    if (!country) continue;
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country)!.push((a.currency || 'EUR').trim().toUpperCase());
  }
  const links: Record<string, string> = {};
  for (const [country, list] of byCountry) {
    const currency = mostCommon(list);
    if (currency) links[country] = currency;
  }
  return links;
}

/**
 * Currency for a country: the user's own accounts first (matched by name or by the same
 * country in another language), then the country's usual currency.
 */
export function currencyForCountry(
  country: string,
  links: Record<string, string> = {},
): string | undefined {
  const key = normalizeCountry(country);
  if (!key) return undefined;
  const code = countryCode(country);
  for (const [name, currency] of Object.entries(links)) {
    if (normalizeCountry(name) === key) return currency;
  }
  if (code) {
    for (const [name, currency] of Object.entries(links)) {
      if (countryCode(name) === code) return currency;
    }
  }
  return defaultCurrencyForCountry(country);
}

/**
 * Country picker options: the user's own countries first, then every built-in country not
 * already covered by one of them. Each option shows the currency it suggests.
 */
export function countryOptions(
  stored: string[],
  links: Record<string, string> = {},
): { value: string; hint?: string }[] {
  const covered = new Set(stored.map((name) => countryCode(name)).filter(Boolean));
  return [
    ...stored.map((value) => ({ value, hint: currencyForCountry(value, links) })),
    ...builtInCountries()
      .filter((c) => !covered.has(c.code))
      .map((c) => ({ value: c.name, hint: c.currency })),
  ];
}
export interface AccountSuggestions {
  institutionSuggestions: string[];
  countryLinks: Record<string, string>;
  countrySuggestions: string[];
  groupSuggestions: string[];
  currencySuggestions: string[];
}

/** Values offered by the account dialog, derived from the accounts that currently exist. */
export function accountSuggestions(accounts: Account[]): AccountSuggestions {
  return {
    institutionSuggestions: uniqueSorted(accounts, (a) =>
      normalizeInstitution(a.institution || ''),
    ),
    countryLinks: accountCountryLinks(accounts),
    countrySuggestions: uniqueSorted(accounts, (a) => (a.country || '').trim()),
    groupSuggestions: uniqueSorted(accounts, (a) => (a.group || '').trim()),
    currencySuggestions: accountCurrencyList(accounts),
  };
}
