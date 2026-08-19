/**
 * Yahoo Finance provider — pure HTTP fetcher for ETF/stock metadata lookup.
 *
 * This module calls the Yahoo Finance quoteSummary endpoint using a ticker symbol.
 * No API key is required. Caching and persistence are handled by trackinsightService.ts.
 */

export const TI_BASE_URL = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary';

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
    super(`Yahoo Finance returned no data for symbol "${symbol}"`, 404);
    this.name = 'TiNotFoundError';
  }
}

export function buildFundUrl(symbol: string, baseUrl: string = TI_BASE_URL): string {
  const encoded = encodeURIComponent(symbol.trim().toUpperCase());
  return `${baseUrl}/${encoded}?modules=summaryDetail%2CfundProfile%2CtopHoldings`;
}

export async function fetchEtfInfo(
  symbol: string,
  baseUrl: string = TI_BASE_URL,
): Promise<TiEtfInfo> {
  if (!symbol.trim()) throw new TiError('Ticker symbol is required');

  const url = buildFundUrl(symbol, baseUrl);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new TiOfflineError(err);
  }

  if (!response.ok) {
    if (response.status === 404) throw new TiNotFoundError(symbol);
    if (response.status === 429) throw new TiError('Yahoo Finance rate limit reached', 429);
    throw new TiError(
      `Yahoo Finance request failed with HTTP ${response.status} for symbol "${symbol}"`,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TiError('Yahoo Finance response was not valid JSON');
  }

  if (!body || typeof body !== 'object') throw new TiNotFoundError(symbol);
  const record = body as Record<string, unknown>;
  if (
    record.quoteSummary &&
    typeof record.quoteSummary === 'object' &&
    (record.quoteSummary as Record<string, unknown>).error
  ) {
    const err = (record.quoteSummary as Record<string, unknown>).error as Record<string, unknown>;
    if (typeof err.description === 'string' && err.description) throw new TiNotFoundError(symbol);
  }

  return validateTiEtfInfo(body, symbol);
}

export function validateTiEtfInfo(raw: unknown, symbolHint?: string): TiEtfInfo {
  if (!raw || typeof raw !== 'object') return {};
  const root = raw as Record<string, unknown>;

  // Yahoo Finance wraps data in quoteSummary.result[0]
  let result: Record<string, unknown> = {};
  if (root.quoteSummary && typeof root.quoteSummary === 'object') {
    const qs = root.quoteSummary as Record<string, unknown>;
    if (Array.isArray(qs.result) && qs.result.length > 0) {
      result = qs.result[0] as Record<string, unknown>;
    }
  }

  const summaryDetail = (result.summaryDetail as Record<string, unknown>) ?? {};
  const fundProfile = (result.fundProfile as Record<string, unknown>) ?? {};
  const topHoldingsData = (result.topHoldings as Record<string, unknown>) ?? {};

  const symbol = symbolHint?.trim().toUpperCase() ?? undefined;

  const fundCurrency = firstString(
    rawValue(summaryDetail.currency),
    rawValue(summaryDetail.financialCurrency),
  );

  const domicileCountry = firstString(rawValue(fundProfile.domicile));

  const exchange = firstString(rawValue(summaryDetail.exchange));

  const aum = parseNumericValue(rawValue(summaryDetail.totalAssets) ?? rawValue(summaryDetail.nav));

  const holdings = Array.isArray(topHoldingsData.holdings) ? topHoldingsData.holdings : null;
  const holdingsCount = holdings ? holdings.length : null;

  const topHoldings = parseTopHoldings(holdings);

  const sectors = parseSectors(
    Array.isArray(topHoldingsData.sectorWeightings) ? topHoldingsData.sectorWeightings : null,
  );

  return {
    symbol,
    exchange,
    domicileCountry,
    fundCurrency,
    aum,
    inceptionDate: null,
    holdingsCount,
    sectors,
    topHoldings,
  };
}

function rawValue(v: unknown): unknown {
  if (v && typeof v === 'object' && 'raw' in (v as Record<string, unknown>)) {
    return (v as Record<string, unknown>).raw;
  }
  return v;
}

function parseSectors(raw: unknown): Array<{ industry: string; exposure: string }> | null {
  if (!Array.isArray(raw)) return null;
  const result: Array<{ industry: string; exposure: string }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [key, val] of Object.entries(entry as Record<string, unknown>)) {
      if (!key) continue;
      const weight = rawValue(val);
      const pct =
        typeof weight === 'number' ? `${(weight * 100).toFixed(1)}%` : String(weight ?? '');
      result.push({ industry: key, exposure: pct });
    }
  }
  return result.length > 0 ? result : null;
}

function parseTopHoldings(raw: unknown): Array<{ asset: string; weightPercentage: string }> | null {
  if (!Array.isArray(raw)) return null;
  const result = raw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => {
      const weight = rawValue(entry.holdingPercent ?? entry.weight);
      return {
        asset:
          typeof entry.holdingName === 'string'
            ? entry.holdingName
            : typeof entry.name === 'string'
              ? entry.name
              : typeof entry.symbol === 'string'
                ? entry.symbol
                : '',
        weightPercentage:
          typeof weight === 'number'
            ? `${(weight * 100).toFixed(2)}%`
            : typeof weight === 'string'
              ? weight
              : '',
      };
    })
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
