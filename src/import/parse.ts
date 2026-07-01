/**
 * Generic profile-driven CSV parser.
 *
 * Consumes an ImportProfile (plain data) and produces canonical Transaction[].
 * The same parser works for any bank - behaviour is controlled entirely by the profile.
 */

import { builtInProfiles } from './profiles/index';
import type {
  ImportProfile,
  Transaction,
  DecimalMode,
  DateFormat,
  ParseResult,
  UnmappedType,
  PreviewSummary,
} from '../types';

// ── Low-level CSV helpers (shared with legacy csv.js) ──────────

/** Split a single CSV line respecting quoted fields. */
export function csvLine(line: string, sep = ','): string[] {
  const r: string[] = [];
  let cur = '',
    inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQ = !inQ;
    } else if (line[i] === sep && !inQ) {
      r.push(cur);
      cur = '';
    } else cur += line[i];
  }
  r.push(cur);
  return r;
}

/** Detect whether the CSV uses semicolons or commas as delimiter. */
export function detectSeparator(headerLine: string): string {
  const bySemi = csvLine(headerLine, ';');
  const byComma = csvLine(headerLine, ',');
  return bySemi.length > byComma.length ? ';' : ',';
}

// ── Number parsing ─────────────────────────────────────────────

/**
 * Parse a numeric string with configurable decimal style.
 */
export function parseNumber(s: string | null | undefined, mode: DecimalMode = 'auto'): number {
  if (!s) return 0;
  let str = s.trim();

  if (mode === 'comma' || (mode === 'auto' && isGermanNumber(str))) {
    // German: dots are thousands, comma is decimal
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (mode === 'dot') {
    // Standard: commas are thousands, dot is decimal
    str = str.replace(/,/g, '');
  }
  // mode === 'auto' and not German → assume dot-decimal (default parseFloat)
  return parseFloat(str) || 0;
}

/** Detect German number format: 1.234,56 or plain 12,34. */
function isGermanNumber(s: string): boolean {
  return /^-?\d{1,3}(\.\d{3})*,\d+$/.test(s) || /^-?\d+,\d+$/.test(s);
}

// ── Date parsing ───────────────────────────────────────────────

/**
 * Parse a date string into ISO yyyy-mm-dd according to the given format.
 */
export function parseDate(s: string | null | undefined, fmt: string): string {
  if (!s) return '';
  const str = s.trim();

  // If it already contains 'T', it's an ISO datetime - take the date part
  if (str.includes('T')) return str.slice(0, 10);

  switch (fmt) {
    case 'YYYY-MM-DD':
    case 'ISO': {
      const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!m) return str; // best-effort passthrough
      return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }
    case 'DD.MM.YYYY': {
      const m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (!m) return str;
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    case 'DD/MM/YYYY': {
      const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!m) return str;
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    case 'MM/DD/YYYY': {
      const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!m) return str;
      return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
    default:
      return str; // unknown format - passthrough
  }
}

// ── Type mapping ───────────────────────────────────────────────

/**
 * Map a source type (+ optional category) to canonical TxType via profile.typeMap.
 * Tries compound key `TYPE|CATEGORY` first, then plain `TYPE`.
 * Returns the mapped value or `null` if unmapped.
 */
function mapType(
  rawType: string,
  rawCategory: string,
  typeMap: Record<string, string>,
): string | null {
  const t = (rawType || '').toUpperCase();
  const c = (rawCategory || '').toUpperCase();

  // Compound key first
  if (c) {
    const compound = `${t}|${c}`;
    if (typeMap[compound]) return typeMap[compound];
  }
  // Plain type
  if (typeMap[t]) return typeMap[t];

  // Unmapped
  return null;
}

// ── Profile detection ──────────────────────────────────────────

/**
 * Auto-detect the best matching profile for a header line.
 */
export function detectProfile(
  headerLine: string,
  profiles?: ImportProfile[],
): ImportProfile | null {
  const pool = profiles || builtInProfiles;
  const lower = headerLine.toLowerCase();

  let bestProfile: ImportProfile | null = null;
  let bestScore = 0;

  for (const p of pool) {
    const hints = p.match?.headerIncludes;
    if (!hints || hints.length === 0) continue;

    let hits = 0;
    for (const h of hints) {
      if (lower.includes(h.toLowerCase())) hits++;
    }
    if (hits === hints.length && hits > bestScore) {
      bestScore = hits;
      bestProfile = p;
    }
  }
  return bestProfile;
}

// ── Generic parser ─────────────────────────────────────────────

/**
 * Parse CSV text using the given import profile.
 */
export function parseWithProfile(text: string, profile: ImportProfile): ParseResult {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { transactions: [], unmapped: [] };

  // Resolve delimiter
  const sep = profile.delimiter === 'auto' ? detectSeparator(lines[0]) : profile.delimiter || ',';

  // Parse header
  const hdrs = csvLine(lines[0], sep).map((h) => h.trim());

  // Build column index lookup: canonical field → column index
  const colIdx: Record<string, number> = {};
  for (const [canonical, source] of Object.entries(profile.columns)) {
    if (typeof source === 'number') {
      colIdx[canonical] = source;
    } else {
      const idx = hdrs.findIndex((h) => h === source);
      if (idx >= 0) colIdx[canonical] = idx;
    }
  }

  const transactions: Transaction[] = [];
  const unmappedCounts: Record<string, number> = {};

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    const vals = csvLine(lines[i], sep);
    const get = (field: string): string => {
      const idx = colIdx[field];
      return idx !== undefined ? (vals[idx] || '').trim() : '';
    };

    // Date is mandatory
    const rawDate = get('date');
    const date = parseDate(rawDate, profile.dateFormat);
    if (!date) continue;

    // Type mapping
    const rawType = get('type');
    const rawCategory = get('category');
    const canonicalType = mapType(rawType, rawCategory, profile.typeMap);

    if (canonicalType === null) {
      // Unmapped - still include the row, tagged as unmapped
      const sourceKey = rawCategory ? `${rawType}|${rawCategory}` : rawType;
      const upperKey = sourceKey.toUpperCase() || 'EMPTY';
      unmappedCounts[upperKey] = (unmappedCounts[upperKey] || 0) + 1;
    }

    // The canonical type for the tx: use mapped value or preserve raw (uppercased)
    const txType = canonicalType || (rawType || '').toUpperCase() || 'UNKNOWN';

    transactions.push({
      id: get('id'),
      date,
      source: profile.id,
      category: rawCategory,
      type: txType,
      name: get('name'),
      isin: get('symbol'),
      symbol: get('symbol'),
      shares: parseNumber(get('shares'), profile.decimal),
      price: parseNumber(get('price'), profile.decimal),
      amount: parseNumber(get('amount'), profile.decimal),
      fee: parseNumber(get('fee'), profile.decimal),
      tax: parseNumber(get('tax'), profile.decimal),
      currency: get('currency') || profile.defaultCurrency,
      fxRate: parseNumber(get('fxRate'), profile.decimal),
    });
  }

  // Filter rows that somehow still have no date or type (shouldn't happen after above guards)
  const filtered = transactions.filter((t) => t.date && t.type);

  const unmapped: UnmappedType[] = Object.entries(unmappedCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return { transactions: filtered, unmapped };
}

/**
 * Generate a preview summary for parsed results.
 */
export function previewSummary(parsed: ParseResult): PreviewSummary {
  const { transactions, unmapped } = parsed;
  const byCounts: Record<string, number> = {};
  for (const tx of transactions) {
    byCounts[tx.type] = (byCounts[tx.type] || 0) + 1;
  }
  return {
    total: transactions.length,
    byCounts,
    unmapped,
    sample: transactions.slice(0, 10),
  };
}
