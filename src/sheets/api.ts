/**
 * Thin wrapper around Google Sheets REST API v4.
 * All calls go through getToken() so auth is handled transparently.
 */

import { getToken } from '../auth/google';

const SHEET_ID = import.meta.env.VITE_GOOGLE_SHEET_ID;
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Escape a single outbound cell value against formula injection.
 * Sheets itself never executes formulas from this app (writes use
 * valueInputOption=RAW), but a downstream re-open of an exported CSV in
 * Excel/LibreOffice applies its own leading-character heuristics on
 * import, regardless of how the value was originally stored. Prefixing
 * a leading '=', '+', '-', or '@' with an apostrophe is the standard
 * mitigation (OWASP CSV Injection guidance) and is inert everywhere
 * else: Sheets/Excel treat a leading apostrophe as "force text", it is
 * never shown to the user.
 * Only strings are touched; numbers/booleans (all real amounts in this
 * app) pass through unchanged, so this can never corrupt a numeric cell.
 */
export function sanitizeForSheets(v: string | number | boolean): string | number | boolean {
  if (typeof v !== 'string') return v;
  if (/^[=+\-@]/.test(v)) return `'${v}`;
  return v;
}

/** Apply sanitizeForSheets to every cell in a 2D values array. Pure. */
export function sanitizeRows(
  values: (string | number | boolean)[][],
): (string | number | boolean)[][] {
  return values.map((row) => row.map(sanitizeForSheets));
}

async function _headers(): Promise<Record<string, string>> {
  const token = await getToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/** Read a range, returns 2D array of values (empty array if sheet is empty). */
export async function readRange(range: string): Promise<(string | number | boolean)[][]> {
  const h = await _headers();
  const url = `${BASE}/${SHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: h });
  if (!res.ok) throw new Error(`Sheets read error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.values || [];
}

/** Overwrite a range with a 2D array of values. */
export async function writeRange(
  range: string,
  values: (string | number | boolean)[][],
): Promise<unknown> {
  const h = await _headers();
  const url = `${BASE}/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: h,
    body: JSON.stringify({ range, majorDimension: 'ROWS', values: sanitizeRows(values) }),
  });
  if (!res.ok) throw new Error(`Sheets write error: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Append rows to the end of a range. */
export async function appendRows(
  range: string,
  values: (string | number | boolean)[][],
): Promise<unknown> {
  const h = await _headers();
  const url = `${BASE}/${SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ range, majorDimension: 'ROWS', values: sanitizeRows(values) }),
  });
  if (!res.ok) throw new Error(`Sheets append error: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Clear a range. */
export async function clearRange(range: string): Promise<unknown> {
  const h = await _headers();
  const url = `${BASE}/${SHEET_ID}/values/${encodeURIComponent(range)}:clear`;
  const res = await fetch(url, { method: 'POST', headers: h });
  if (!res.ok) throw new Error(`Sheets clear error: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Ensure required sheets (tabs) exist in the spreadsheet.
 * Creates any missing tabs on first run.
 */
export async function ensureSheets(tabNames: string[]): Promise<void> {
  const h = await _headers();
  const metaR = await fetch(`${BASE}/${SHEET_ID}`, { headers: h });
  if (!metaR.ok) throw new Error(`Cannot read spreadsheet metadata: ${metaR.status}`);
  const meta = await metaR.json();
  const existing = (meta.sheets || []).map(
    (s: { properties: { title: string } }) => s.properties.title,
  );
  const missing = tabNames.filter((n) => !existing.includes(n));
  if (!missing.length) return;

  const requests = missing.map((title) => ({
    addSheet: { properties: { title } },
  }));
  const batchUrl = `${BASE}/${SHEET_ID}:batchUpdate`;
  const res = await fetch(batchUrl, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) throw new Error(`Cannot create sheets: ${res.status} ${await res.text()}`);
}
