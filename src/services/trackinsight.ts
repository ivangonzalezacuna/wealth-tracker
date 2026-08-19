/**
 * Trackinsight provider — pure HTTP fetcher for ETF metadata lookup.
 *
 * Trackinsight provides free, no-key ETF metadata keyed directly by ISIN,
 * eliminating the two-step search-then-fetch pattern required by FMP.
 * This module has no side effects: it only fetches and returns typed records.
 * Caching and persistence are handled by trackinsightService.ts.
 */

export const TI_BASE_URL = 'https://www.trackinsight.com/data-api/v1';

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
  constructor(isin: string) {
    super(`Trackinsight returned no data for ISIN "${isin}"`, 404);
    this.name = 'TiNotFoundError';
  }
}

export function buildFundUrl(isin: string, baseUrl: string = TI_BASE_URL): string {
  return `${baseUrl}/funds/${encodeURIComponent(isin)}.json`;
}

export async function fetchEtfInfo(
  isin: string,
  baseUrl: string = TI_BASE_URL,
): Promise<TiEtfInfo> {
  const url = buildFundUrl(isin, baseUrl);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new TiOfflineError(err);
  }

  if (!response.ok) {
    if (response.status === 404) throw new TiNotFoundError(isin);
    throw new TiError(
      `Trackinsight request failed with HTTP ${response.status} for ISIN "${isin}"`,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TiError('Trackinsight response was not valid JSON');
  }

  return validateTiEtfInfo(body, isin);
}

export function validateTiEtfInfo(raw: unknown, isin?: string): TiEtfInfo {
  if (!raw || typeof raw !== 'object') return {};
  const v = raw as Record<string, unknown>;

  // The response may have a top-level `fund` wrapper, or fields may be at the root.
  const fund: Record<string, unknown> =
    v.fund && typeof v.fund === 'object'
      ? (v.fund as Record<string, unknown>)
      : (v as Record<string, unknown>);

  const aum =
    typeof fund.total_assets === 'number' && Number.isFinite(fund.total_assets)
      ? fund.total_assets
      : typeof fund.aum === 'number' && Number.isFinite(fund.aum)
        ? fund.aum
        : null;

  const holdingsCount =
    typeof fund.total_holdings === 'number' && Number.isFinite(fund.total_holdings)
      ? fund.total_holdings
      : typeof fund.nb_holdings === 'number' && Number.isFinite(fund.nb_holdings)
        ? fund.nb_holdings
        : null;

  const exchange =
    typeof fund.main_exchange === 'string' && fund.main_exchange
      ? fund.main_exchange
      : typeof fund.exchange === 'string' && fund.exchange
        ? fund.exchange
        : undefined;

  const domicileCountry =
    typeof fund.domicile === 'string' && fund.domicile
      ? fund.domicile
      : typeof fund.domicile_country === 'string' && fund.domicile_country
        ? fund.domicile_country
        : undefined;

  const fundCurrency =
    typeof fund.currency === 'string' && fund.currency
      ? fund.currency
      : typeof fund.fund_currency === 'string' && fund.fund_currency
        ? fund.fund_currency
        : undefined;

  const inceptionDate =
    typeof fund.inception_date === 'string' && fund.inception_date
      ? fund.inception_date
      : fund.inception_date == null
        ? null
        : undefined;

  // Ticker/symbol — Trackinsight typically does not return a canonical ticker symbol;
  // we derive one from the ISIN if not present.
  const symbol =
    typeof fund.ticker === 'string' && fund.ticker
      ? fund.ticker
      : typeof fund.symbol === 'string' && fund.symbol
        ? fund.symbol
        : isin
          ? undefined // keep undefined; symbol is optional
          : undefined;

  const sectors = parseSectors(fund.weight_distribution ?? fund.sectors ?? fund.sector_breakdown);

  const topHoldings = parseTopHoldings(fund.top_holdings ?? fund.top10_holdings);

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
              : '',
      exposure:
        typeof entry.weight === 'number'
          ? String(entry.weight)
          : typeof entry.exposure === 'string'
            ? entry.exposure
            : typeof entry.weight === 'string'
              ? entry.weight
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
          : typeof entry.asset === 'string'
            ? entry.asset
            : '',
      weightPercentage:
        typeof entry.weight === 'number'
          ? String(entry.weight)
          : typeof entry.weightPercentage === 'string'
            ? entry.weightPercentage
            : typeof entry.weight === 'string'
              ? entry.weight
              : '',
    }))
    .filter((entry) => !!entry.asset);
  return result.length > 0 ? result : null;
}
