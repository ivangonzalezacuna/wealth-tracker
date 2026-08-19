/**
 * Alpha Vantage provider — pure HTTP fetcher for ETF metadata lookup.
 *
 * This module calls the ETF_PROFILE endpoint using a ticker symbol and API key.
 * Caching and persistence are handled by trackinsightService.ts.
 */

export const TI_BASE_URL = 'https://www.alphavantage.co/query';

export interface TiEtfInfo {
  symbol?: string;
  exchange?: string;
  domicileCountry?: string;
  fundCurrency?: string;
  aum?: number | null;
  inceptionDate?: string | null;
  holdingsCount?: number | null;
  sectors?: Array<{ industry: string; exposure: string }> | null;
  topHoldings?: Array<{ asset: string; weightPercentage: string }> | null;
}

export class TiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'TiError';
  }
}

export class TiOfflineError extends TiError {
  constructor(cause?: unknown) {
    super(cause instanceof Error ? `Network error: ${cause.message}` : 'Network unavailable');
    this.name = 'TiOfflineError';
  }
}

export class TiNotFoundError extends TiError {
  constructor(symbol: string) {
    super(`Alpha Vantage returned no data for symbol "${symbol}"`, 404);
    this.name = 'TiNotFoundError';
  }
}

export function buildFundUrl(
  symbol: string,
  apiKey: string,
  baseUrl: string = TI_BASE_URL,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set('function', 'ETF_PROFILE');
  url.searchParams.set('symbol', symbol.trim().toUpperCase());
  url.searchParams.set('apikey', apiKey.trim());
  return url.toString();
}

export async function fetchEtfInfo(
  symbol: string,
  apiKey: string,
  baseUrl: string = TI_BASE_URL,
): Promise<TiEtfInfo> {
  if (!symbol.trim()) throw new TiError('Ticker symbol is required');
  if (!apiKey.trim()) throw new TiError('Alpha Vantage API key is required');

  const url = buildFundUrl(symbol, apiKey, baseUrl);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new TiOfflineError(err);
  }

  if (!response.ok) {
    if (response.status === 404) throw new TiNotFoundError(symbol);
    throw new TiError(
      `Alpha Vantage request failed with HTTP ${response.status} for symbol "${symbol}"`,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TiError('Alpha Vantage response was not valid JSON');
  }

  if (!body || typeof body !== 'object') throw new TiNotFoundError(symbol);
  const record = body as Record<string, unknown>;
  if (typeof record['Error Message'] === 'string' && record['Error Message']) {
    throw new TiNotFoundError(symbol);
  }
  if (typeof record.Information === 'string' && record.Information) {
    throw new TiError(record.Information, 429);
  }
  if (Object.keys(record).length === 0) throw new TiNotFoundError(symbol);

  return validateTiEtfInfo(body, symbol);
}

export function validateTiEtfInfo(raw: unknown, symbolHint?: string): TiEtfInfo {
  if (!raw || typeof raw !== 'object') return {};
  const v = raw as Record<string, unknown>;
  const fund: Record<string, unknown> =
    v.data && typeof v.data === 'object'
      ? (v.data as Record<string, unknown>)
      : v.fund && typeof v.fund === 'object'
        ? (v.fund as Record<string, unknown>)
        : (v as Record<string, unknown>);

  const aum = parseNumericValue(fund.aum ?? fund.net_assets ?? fund.total_assets);

  const rawHoldings = firstArray(fund.holdings, fund.top_holdings, fund.top10_holdings);
  const holdingsCount =
    parseCountValue(fund.total_holdings ?? fund.holdings_count ?? fund.nb_holdings) ??
    (rawHoldings ? rawHoldings.length : null);

  const exchange = firstString(fund.exchange, fund.main_exchange, fund.primary_exchange);

  const domicileCountry = firstString(fund.domicile, fund.domicile_country, fund.country);

  const fundCurrency = firstString(fund.currency, fund.fund_currency, fund.base_currency);

  const inceptionDate =
    typeof fund.inception_date === 'string' && fund.inception_date
      ? fund.inception_date
      : typeof fund.inceptionDate === 'string' && fund.inceptionDate
        ? fund.inceptionDate
        : fund.inception_date == null
          ? null
          : undefined;

  const symbol =
    firstString(fund.symbol, fund.ticker, fund.Symbol, symbolHint)?.toUpperCase() ?? undefined;

  const sectors = parseSectors(
    firstArray(fund.sectors, fund.weight_distribution, fund.sector_breakdown),
  );

  const topHoldings = parseTopHoldings(rawHoldings);

  return {
    symbol,
    exchange,
    domicileCountry,
    fundCurrency,
    aum,
    inceptionDate,
    holdingsCount,
    sectors,
    topHoldings,
  };
}

function parseSectors(raw: unknown): Array<{ industry: string; exposure: string }> | null {
  if (!Array.isArray(raw)) return null;
  const result = raw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      industry:
        typeof entry.name === 'string'
          ? entry.name
          : typeof entry.industry === 'string'
            ? entry.industry
            : typeof entry.sector === 'string'
              ? entry.sector
              : typeof entry.label === 'string'
                ? entry.label
                : typeof entry.category === 'string'
                  ? entry.category
                  : objectSingleKey(entry)
                    ? objectSingleKey(entry)!
                    : '',
      exposure:
        typeof entry.weight === 'number'
          ? String(entry.weight)
          : typeof entry.exposure === 'string'
            ? entry.exposure
            : typeof entry.weight === 'string'
              ? entry.weight
              : objectSingleKey(entry)
                ? String(entry[objectSingleKey(entry)!] ?? '')
                : '',
    }))
    .filter((entry) => !!entry.industry);
  return result.length > 0 ? result : null;
}

function parseTopHoldings(raw: unknown): Array<{ asset: string; weightPercentage: string }> | null {
  if (!Array.isArray(raw)) return null;
  const result = raw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      asset:
        typeof entry.name === 'string'
          ? entry.name
          : typeof entry.description === 'string'
            ? entry.description
            : typeof entry.asset === 'string'
              ? entry.asset
              : typeof entry.symbol === 'string'
                ? entry.symbol
                : '',
      weightPercentage:
        typeof entry.weight === 'number'
          ? String(entry.weight)
          : typeof entry.weightPercentage === 'string'
            ? entry.weightPercentage
            : typeof entry.percent === 'string'
              ? entry.percent
              : typeof entry.weight === 'string'
                ? entry.weight
                : '',
    }))
    .filter((entry) => !!entry.asset);
  return result.length > 0 ? result : null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized) return normalized;
    }
  }
  return undefined;
}

function firstArray(...values: unknown[]): unknown[] | null {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return null;
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.replace(/[$€,]/g, '');
  const suffix = normalized.slice(-1).toUpperCase();
  const multipliers: Record<string, number> = {
    K: 1_000,
    M: 1_000_000,
    B: 1_000_000_000,
    T: 1_000_000_000_000,
  };
  const base = suffix in multipliers ? normalized.slice(0, -1) : normalized;
  const parsed = Number(base);
  if (!Number.isFinite(parsed)) return null;
  return suffix in multipliers ? parsed * multipliers[suffix] : parsed;
}

function parseCountValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function objectSingleKey(record: Record<string, unknown>): string | null {
  const keys = Object.keys(record).filter((k) => !!k && !k.startsWith('_'));
  return keys.length === 1 ? keys[0] : null;
}
