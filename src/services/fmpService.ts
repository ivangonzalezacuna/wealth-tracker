/**
 * FMP metadata service — cache-first enrichment backed by the FMP provider.
 * Single entry-point for all ETF metadata resolution. Never throws to callers.
 */

import type { HoldingMetadata } from '../types';
import {
  buildEtfInfoUrl,
  buildSearchUrl,
  fetchEtfInfo,
  FmpAuthError,
  FmpError,
  FmpOfflineError,
  redactApiKey,
  searchByIsin,
  validateFmpEtfInfo,
} from './fmp';
import {
  getDailyFetchCount,
  getHoldingMetadata,
  recordFmpCacheHit,
  recordFmpError,
  recordFmpFetch,
  recordFmpRequest,
  upsertHoldingMetadata,
} from '../db';

const FMP_DAILY_LIMIT = 250;
const FMP_REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

let _enabled = false;
let _apiKey = '';

export function configureFmpService(opts: { enabled: boolean; apiKey: string }): void {
  _enabled = opts.enabled;
  _apiKey = opts.apiKey;
}

function isReady(): boolean {
  return _enabled && !!_apiKey;
}

async function isWithinDailyLimit(): Promise<boolean> {
  try {
    return (await getDailyFetchCount()) < FMP_DAILY_LIMIT;
  } catch {
    return false;
  }
}

async function fetchAndPersist(isin: string): Promise<HoldingMetadata | null> {
  if (!isReady()) return null;
  if (!(await isWithinDailyLimit())) {
    console.warn(`[fmpService] Daily limit reached — skipping fetch for ${isin}`);
    return null;
  }

  let lastRequestUrl = '';
  try {
    const searchUrl = buildSearchUrl(isin, _apiKey);
    const redactedSearchUrl = redactApiKey(searchUrl);
    lastRequestUrl = redactedSearchUrl;
    const searchResults = await searchByIsin(isin, _apiKey);
    const searchAt = new Date().toISOString();
    recordFmpFetch(searchAt, redactedSearchUrl).catch(() => {});
    recordFmpRequest(searchAt, redactedSearchUrl, serializeDebugPayload(searchResults)).catch(
      () => {},
    );

    if (searchResults.length === 0) return null;
    const { symbol } = searchResults[0];

    if (!(await isWithinDailyLimit())) {
      console.warn(`[fmpService] Daily limit reached after search — skipping etf/info for ${isin}`);
      return null;
    }

    const infoUrl = buildEtfInfoUrl(symbol, _apiKey);
    const redactedInfoUrl = redactApiKey(infoUrl);
    lastRequestUrl = redactedInfoUrl;
    const rawInfo = await fetchEtfInfo(symbol, _apiKey);
    const now = new Date().toISOString();
    recordFmpFetch(now, redactedInfoUrl).catch(() => {});
    recordFmpRequest(now, redactedInfoUrl, serializeDebugPayload(rawInfo)).catch(() => {});

    const info = validateFmpEtfInfo(rawInfo);
    const record: HoldingMetadata = {
      isin,
      symbol,
      exchange: info.exchange ?? undefined,
      domicileCountry: info.domicileCountry,
      fundCurrency: info.fundCurrency,
      aum: info.aum,
      inceptionDate: info.inceptionDate,
      holdingsCount: info.holdingsCount,
      sectors: info.sectorsList,
      topHoldings: info.topHoldings,
      fetchedAt: now,
      lastRefreshedAt: now,
      provider: 'fmp',
    };
    await upsertHoldingMetadata(record).catch(() => {});
    return record;
  } catch (err) {
    const now = new Date().toISOString();
    const message =
      err instanceof Error ? err.message : 'Unexpected FMP metadata enrichment failure';
    if (lastRequestUrl) {
      recordFmpRequest(now, lastRequestUrl, `ERROR: ${message}`).catch(() => {});
    }
    if (
      err instanceof FmpAuthError ||
      err instanceof FmpOfflineError ||
      err instanceof FmpError ||
      err instanceof Error
    ) {
      recordFmpError(now, message).catch(() => {});
      console.warn(`[fmpService] Could not fetch metadata for ${isin}: ${message}`);
      return null;
    }
    recordFmpError(now, message).catch(() => {});
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

export async function lookupHoldingMetadata(isin: string): Promise<HoldingMetadata | null> {
  if (!isReady()) return null;
  try {
    const cached = await getHoldingMetadata(isin);
    if (cached !== null) {
      recordFmpCacheHit().catch(() => {});
      return cached;
    }
  } catch {
    // Cache read failure should not block a live fetch.
  }
  return fetchAndPersist(isin);
}

export async function refreshHoldingMetadata(isin: string): Promise<HoldingMetadata | null> {
  if (!isReady()) return null;
  return fetchAndPersist(isin);
}

export async function canRefreshMetadata(isin: string): Promise<boolean> {
  if (!isReady()) return false;
  if (!(await isWithinDailyLimit())) return false;
  try {
    const cached = await getHoldingMetadata(isin);
    if (!cached || !cached.lastRefreshedAt) return true;
    const lastRefresh = new Date(cached.lastRefreshedAt).getTime();
    if (!Number.isFinite(lastRefresh)) return true;
    return Date.now() - lastRefresh > FMP_REFRESH_COOLDOWN_MS;
  } catch {
    return true;
  }
}

export async function bulkEnrichHoldings(
  isins: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ enriched: number; failed: number; skipped: number }> {
  if (!isReady()) return { enriched: 0, failed: 0, skipped: isins.length };

  let enriched = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < isins.length; i++) {
    const isin = isins[i];
    if (!(await isWithinDailyLimit())) {
      skipped += isins.length - i;
      break;
    }

    try {
      const cached = await getHoldingMetadata(isin);
      if (cached) {
        skipped += 1;
        onProgress?.(i + 1, isins.length);
        continue;
      }
    } catch {
      // Ignore cache read failures and continue with the live fetch.
    }

    const result = await fetchAndPersist(isin);
    if (result) enriched += 1;
    else failed += 1;
    onProgress?.(i + 1, isins.length);

    if (i < isins.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return { enriched, failed, skipped };
}
