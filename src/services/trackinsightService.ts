/**
 * Trackinsight metadata service — cache-first enrichment backed by the Trackinsight provider.
 * Single entry-point for all ETF metadata resolution. Never throws to callers.
 *
 * Unlike FMP, Trackinsight requires no API key and has no documented daily request limit.
 * The service is gated only by the ti_integration_enabled setting.
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

export function configureTiService(opts: { enabled: boolean }): void {
  _enabled = opts.enabled;
}

function isReady(): boolean {
  return _enabled;
}

async function fetchAndPersist(isin: string): Promise<HoldingMetadata | null> {
  if (!isReady()) return null;

  try {
    const url = buildFundUrl(isin);
    const rawInfo = await fetchEtfInfo(isin);
    const now = new Date().toISOString();
    recordTiFetch(now, url).catch(() => {});
    recordTiRequest(now, url, serializeDebugPayload(rawInfo)).catch(() => {});

    const info = validateTiEtfInfo(rawInfo, isin);
    const record: HoldingMetadata = {
      isin,
      symbol: info.symbol ?? undefined,
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
      provider: 'trackinsight',
    };
    await upsertHoldingMetadata(record).catch(() => {});
    return record;
  } catch (err) {
    const now = new Date().toISOString();
    const message =
      err instanceof Error ? err.message : 'Unexpected Trackinsight metadata enrichment failure';
    const url = buildFundUrl(isin);
    recordTiRequest(now, url, `ERROR: ${message}`).catch(() => {});
    if (
      err instanceof TiError ||
      err instanceof TiOfflineError ||
      err instanceof TiNotFoundError ||
      err instanceof Error
    ) {
      recordTiError(now, message).catch(() => {});
      console.warn(`[trackinsightService] Could not fetch metadata for ${isin}: ${message}`);
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

export async function lookupHoldingMetadata(isin: string): Promise<HoldingMetadata | null> {
  if (!isReady()) return null;
  try {
    const cached = await getHoldingMetadata(isin);
    if (cached !== null) {
      recordTiCacheHit().catch(() => {});
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
  isins: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ enriched: number; failed: number; skipped: number }> {
  if (!isReady()) return { enriched: 0, failed: 0, skipped: isins.length };

  let enriched = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < isins.length; i++) {
    const isin = isins[i];

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
