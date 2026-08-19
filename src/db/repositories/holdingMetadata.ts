import { getDb, persistDb } from '../connection';
import type { HoldingMetadata } from '../../types';

export async function getHoldingMetadata(isin: string): Promise<HoldingMetadata | null> {
  const db = await getDb();
  const result = db.exec(
    `SELECT isin, symbol, exchange, domicile_country, fund_currency, aum, inception_date,
            holdings_count, sectors, top_holdings, fetched_at, last_refreshed_at, provider
       FROM holding_metadata
      WHERE isin = ?`,
    [isin],
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  return rowToHoldingMetadata(result[0].values[0]);
}

export async function upsertHoldingMetadata(record: HoldingMetadata): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT OR REPLACE INTO holding_metadata (
       isin, symbol, exchange, domicile_country, fund_currency, aum, inception_date,
       holdings_count, sectors, top_holdings, fetched_at, last_refreshed_at, provider
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.isin,
      record.symbol ?? null,
      record.exchange ?? null,
      record.domicileCountry ?? null,
      record.fundCurrency ?? null,
      record.aum ?? null,
      record.inceptionDate ?? null,
      record.holdingsCount ?? null,
      record.sectors ? JSON.stringify(record.sectors) : null,
      record.topHoldings ? JSON.stringify(record.topHoldings) : null,
      record.fetchedAt,
      record.lastRefreshedAt,
      record.provider,
    ],
  );
  await persistDb();
}

export async function getAllHoldingMetadata(): Promise<HoldingMetadata[]> {
  const db = await getDb();
  const result = db.exec(
    `SELECT isin, symbol, exchange, domicile_country, fund_currency, aum, inception_date,
            holdings_count, sectors, top_holdings, fetched_at, last_refreshed_at, provider
       FROM holding_metadata
      ORDER BY isin ASC`,
  );
  if (result.length === 0) return [];
  return result[0].values.map(rowToHoldingMetadata);
}

export async function deleteHoldingMetadata(isin: string): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM holding_metadata WHERE isin = ?', [isin]);
  await persistDb();
}

export async function clearAllHoldingMetadata(): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM holding_metadata');
  await persistDb();
}

function rowToHoldingMetadata(row: unknown[]): HoldingMetadata {
  return {
    isin: String(row[0] ?? ''),
    symbol: stringOrUndefined(row[1]),
    exchange: stringOrUndefined(row[2]),
    domicileCountry: stringOrUndefined(row[3]),
    fundCurrency: stringOrUndefined(row[4]),
    aum: row[5] == null ? null : Number(row[5]),
    inceptionDate: row[6] == null ? null : String(row[6]),
    holdingsCount: row[7] == null ? null : Number(row[7]),
    sectors: parseJsonArray(row[8]),
    topHoldings: parseJsonArray(row[9]),
    fetchedAt: String(row[10] ?? ''),
    lastRefreshedAt: String(row[11] ?? ''),
    provider: String(row[12] ?? 'fmp'),
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return value == null || value === '' ? undefined : String(value);
}

function parseJsonArray<T>(value: unknown): T[] | null {
  if (value == null || value === '') return null;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}
