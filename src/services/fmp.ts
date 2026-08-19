/**
 * FMP provider — pure HTTP fetcher for ETF metadata lookup.
 *
 * This module has no side effects: it only fetches from the Financial
 * Modeling Prep API and returns typed records. Caching and persistence are
 * handled by fmpService.ts, not here.
 */

export const FMP_BASE_URL = 'https://financialmodelingprep.com/api';

export interface FmpSearchResult {
  symbol: string;
  name: string;
  currency: string;
  stockExchange: string;
  exchangeShortName: string;
}

export interface FmpEtfInfo {
  symbol?: string;
  exchange?: string;
  domicileCountry?: string;
  fundCurrency?: string;
  aum?: number | null;
  inceptionDate?: string | null;
  holdingsCount?: number | null;
  sectorsList?: Array<{ industry: string; exposure: string }> | null;
  topHoldings?: Array<{ asset: string; weightPercentage: string }> | null;
}

export class FmpError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'FmpError';
  }
}

export class FmpOfflineError extends FmpError {
  constructor(cause?: unknown) {
    super(cause instanceof Error ? `Network error: ${cause.message}` : 'Network unavailable');
    this.name = 'FmpOfflineError';
  }
}

export class FmpAuthError extends FmpError {
  constructor(statusCode: number) {
    super(`FMP authentication failed with HTTP ${statusCode}`, statusCode);
    this.name = 'FmpAuthError';
  }
}

export function buildSearchUrl(
  isin: string,
  apiKey: string,
  baseUrl: string = FMP_BASE_URL,
): string {
  const url = new URL(`${baseUrl}/v3/search`);
  url.searchParams.set('query', isin);
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('limit', '5');
  return url.toString();
}

export function buildEtfInfoUrl(
  symbol: string,
  apiKey: string,
  baseUrl: string = FMP_BASE_URL,
): string {
  const url = new URL(`${baseUrl}/v3/etf/info`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('apikey', apiKey);
  return url.toString();
}

export function redactApiKey(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('apikey')) parsed.searchParams.set('apikey', '***');
    return parsed.toString();
  } catch {
    return url.replace(/([?&]apikey=)[^&]*/i, '$1***');
  }
}

export async function searchByIsin(
  isin: string,
  apiKey: string,
  baseUrl: string = FMP_BASE_URL,
): Promise<FmpSearchResult[]> {
  const url = buildSearchUrl(isin, apiKey, baseUrl);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new FmpOfflineError(err);
  }

  if (!response.ok) {
    if (response.status === 404) return [];
    if (response.status === 401 || response.status === 403) {
      throw new FmpAuthError(response.status);
    }
    throw new FmpError(`FMP search failed with HTTP ${response.status} for ${redactApiKey(url)}`, response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FmpError('FMP search response was not valid JSON');
  }

  if (!Array.isArray(body)) {
    throw new FmpError('Unexpected FMP search response shape');
  }

  return body
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      symbol: typeof entry.symbol === 'string' ? entry.symbol : '',
      name: typeof entry.name === 'string' ? entry.name : '',
      currency: typeof entry.currency === 'string' ? entry.currency : '',
      stockExchange:
        typeof entry.stockExchange === 'string'
          ? entry.stockExchange
          : typeof entry.exchange === 'string'
            ? entry.exchange
            : '',
      exchangeShortName:
        typeof entry.exchangeShortName === 'string' ? entry.exchangeShortName : '',
    }))
    .filter((entry) => !!entry.symbol);
}

export async function fetchEtfInfo(
  symbol: string,
  apiKey: string,
  baseUrl: string = FMP_BASE_URL,
): Promise<FmpEtfInfo> {
  const url = buildEtfInfoUrl(symbol, apiKey, baseUrl);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new FmpOfflineError(err);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new FmpAuthError(response.status);
    }
    throw new FmpError(
      `FMP ETF info failed with HTTP ${response.status} for ${redactApiKey(url)}`,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FmpError('FMP ETF info response was not valid JSON');
  }

  if (!Array.isArray(body)) {
    throw new FmpError('Unexpected FMP ETF info response shape');
  }
  if (body.length === 0) {
    throw new FmpError(`FMP ETF info returned no records for symbol "${symbol}"`);
  }

  return validateFmpEtfInfo(body[0]);
}

export function validateFmpEtfInfo(raw: unknown): FmpEtfInfo {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Record<string, unknown>;

  const aum = typeof value.aum === 'number' && Number.isFinite(value.aum) ? value.aum : null;
  const holdingsCount =
    typeof value.holdingsCount === 'number' && Number.isFinite(value.holdingsCount)
      ? value.holdingsCount
      : null;
  const sectorsList = Array.isArray(value.sectorsList)
    ? value.sectorsList
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry) => ({
          industry: typeof entry.industry === 'string' ? entry.industry : '',
          exposure:
            typeof entry.exposure === 'string'
              ? entry.exposure
              : typeof entry.weightPercentage === 'string'
                ? entry.weightPercentage
                : '',
        }))
        .filter((entry) => !!entry.industry || !!entry.exposure)
    : null;
  const topHoldings = Array.isArray(value.topHoldings)
    ? value.topHoldings
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry) => ({
          asset: typeof entry.asset === 'string' ? entry.asset : '',
          weightPercentage:
            typeof entry.weightPercentage === 'string'
              ? entry.weightPercentage
              : typeof entry.weight === 'string'
                ? entry.weight
                : '',
        }))
        .filter((entry) => !!entry.asset || !!entry.weightPercentage)
    : null;

  return {
    symbol: typeof value.symbol === 'string' ? value.symbol : undefined,
    exchange:
      typeof value.exchange === 'string'
        ? value.exchange
        : typeof value.stockExchange === 'string'
          ? value.stockExchange
          : undefined,
    domicileCountry:
      typeof value.domicileCountry === 'string' ? value.domicileCountry : undefined,
    fundCurrency: typeof value.fundCurrency === 'string' ? value.fundCurrency : undefined,
    aum,
    inceptionDate:
      typeof value.inceptionDate === 'string'
        ? value.inceptionDate
        : value.inceptionDate == null
          ? null
          : undefined,
    holdingsCount,
    sectorsList,
    topHoldings,
  };
}
