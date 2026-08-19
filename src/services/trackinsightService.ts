/**
 * ETF metadata service — cache-first enrichment backed by Alpha Vantage.
 * Single entry-point for all ETF metadata resolution. Never throws to callers.
 *
 * The service is gated by:
 * - ti_integration_enabled
 * - ti_api_key presence
 */

import type { HoldingMetadata } from '../types';
import {
  buildFundUrl,
  fetchEtfInfo,
  TiError,
  TiNotFoundError,
  TiOfflineError,
  validateTiEtfInfo,
} from './trackinsight';
import {
  getHoldingMetadata,
  recordTiFetch,
  recordTiError,
  recordTiRequest,
  recordTiCacheHit,
  upsertHoldingMetadata,
} from '../db';

const TI_REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

let _enabled = false;
let _apiKey = '';

export function configureTiService(opts: { enabled: boolean; apiKey?: string }): void {
  _enabled = opts.enabled;
  _apiKey = (opts.apiKey ?? '').trim();
}

function isReady(): boolean {
  return _enabled && !!_apiKey;
}

function sanitizeTickerSymbol(raw?: string): string {
  if (!raw) return '';
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-_]/g, '');
}

async function fetchAndPersist(isin: string, symbol?: string): Promise<HoldingMetadata | null> {
  const ticker = sanitizeTickerSymbol(symbol);
  if (!ticker) return null;
  if (!isReady()) return null;

  try {
    const url = buildFundUrl(ticker, _apiKey);
    const rawInfo = await fetchEtfInfo(ticker, _apiKey);
    const now = new Date().toISOString();
    recordTiFetch(now, url).catch(() => {});
    recordTiRequest(now, url, serializeDebugPayload(rawInfo)).catch(() => {});

    const info = validateTiEtfInfo(rawInfo, ticker);
    const record: HoldingMetadata = {
      isin,
      symbol: info.symbol ?? ticker,
      exchange: info.exchange ?? undefined,
      domicileCountry: info.domicileCountry,
      fundCurrency: info.fundCurrency,
      aum: info.aum,
      inceptionDate: info.inceptionDate,
      holdingsCount: info.holdingsCount,
      sectors: info.sectors,
      topHoldings: info.topHoldings,
      fetchedAt: now,
      lastRefreshedAt: now,
      provider: 'alphavantage',
    };
    await upsertHoldingMetadata(record).catch(() => {});
    return record;
  } catch (err) {
    const now = new Date().toISOString();
    const message =
      err instanceof Error ? err.message : 'Unexpected Alpha Vantage metadata enrichment failure';
    const url = buildFundUrl(ticker, _apiKey);
    recordTiRequest(now, url, `ERROR: ${message}`).catch(() => {});
    if (
      err instanceof TiError ||
      err instanceof TiOfflineError ||
      err instanceof TiNotFoundError ||
      err instanceof Error
    ) {
      recordTiError(now, message).catch(() => {});
      console.warn(`[trackinsightService] Could not fetch metadata for ${isin} (${ticker}): ${message}`);
      return null;
    }
    recordTiError(now, message).catch(() => {});
    return null;
  }
}

function serializeDebugPayload(payload: unknown): string {
  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length <= 5000) return serialized;
    return `${serialized.slice(0, 5000)}… [truncated]`;
  } catch {
    return String(payload);
  }
}

export async function lookupHoldingMetadata(
  isin: string,
  symbol?: string,
): Promise<HoldingMetadata | null> {
  if (!_enabled) return null;
  try {
    const cached = await getHoldingMetadata(isin);
    if (cached !== null) {
      recordTiCacheHit().catch(() => {});
      return cached;
    }
  } catch {
    // Cache read failure should not block a live fetch.
  }
  return fetchAndPersist(isin, symbol);
}

export async function refreshHoldingMetadata(
  isin: string,
  symbol?: string,
): Promise<HoldingMetadata | null> {
  if (!_enabled) return null;
  return fetchAndPersist(isin, symbol);
}

export async function canRefreshMetadata(isin: string): Promise<boolean> {
  if (!isReady()) return false;
  try {
    const cached = await getHoldingMetadata(isin);
    if (!cached || !cached.lastRefreshedAt) return true;
    const lastRefresh = new Date(cached.lastRefreshedAt).getTime();
    if (!Number.isFinite(lastRefresh)) return true;
    return Date.now() - lastRefresh > TI_REFRESH_COOLDOWN_MS;
  } catch {
    return true;
  }
}

export async function bulkEnrichHoldings(
  holdings: Array<{ isin: string; symbol?: string }>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ enriched: number; failed: number; skipped: number }> {
  if (!_enabled) return { enriched: 0, failed: 0, skipped: holdings.length };
  if (!_apiKey) return { enriched: 0, failed: 0, skipped: holdings.length };

  let enriched = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < holdings.length; i++) {
    const { isin, symbol } = holdings[i];

    try {
      const cached = await getHoldingMetadata(isin);
      if (cached) {
        skipped += 1;
        onProgress?.(i + 1, holdings.length);
        continue;
      }
    } catch {
      // Ignore cache read failures and continue with the live fetch.
    }

    const result = await fetchAndPersist(isin, symbol);
    if (result) enriched += 1;
    else failed += 1;
    onProgress?.(i + 1, holdings.length);

    if (i < holdings.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return { enriched, failed, skipped };
}
