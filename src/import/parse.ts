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
  TxTypeValue,
  DecimalMode,
  DateFormat,
  ParseResult,
  UnmappedType,
  PreviewSummary,
} from '../types';

// ── Low-level CSV helpers ───────────────────────────────────────

/** Split a single CSV line respecting quoted fields.
 *  Handles RFC 4180 `""` escaping (a doubled quote inside a quoted field
 *  is a literal `"`), so a field like `"Say ""Hi"""` round-trips as
 *  `Say "Hi"` instead of silently dropping both quote characters. */
function csvLine(line: string, sep = ','): string[] {
  const r: string[] = [];
  let cur = '',
    inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQ && line[i + 1] === '"') {
        // Escaped quote: emit one literal " and skip the pair
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (line[i] === sep && !inQ) {
      r.push(cur);
      cur = '';
    } else cur += line[i];
  }
  r.push(cur);
  return r;
}

/** Detect whether the CSV uses semicolons or commas as delimiter. */
function detectSeparator(headerLine: string): string {
  const bySemi = csvLine(headerLine, ';');
  const byComma = csvLine(headerLine, ',');
  return bySemi.length > byComma.length ? ';' : ',';
}

// ── Number parsing ─────────────────────────────────────────────

export function parseNumber(s: string | null | undefined, mode: DecimalMode = 'auto'): number {
  if (!s) return 0;
  let str = s.trim();
  if (!str) return 0;

  if (mode === 'comma' || (mode === 'auto' && isGermanNumber(str))) {
    // German: dots are thousands, comma is decimal
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (mode === 'dot') {
    // Standard: commas are thousands, dot is decimal
    str = str.replace(/,/g, '');
  }
  // mode === 'auto' and not German → assume dot-decimal (default parseFloat)
  const n = parseFloat(str);
  return isNaN(n) ? NaN : n;
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

export function isValidIsoDate(s: string): boolean {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= maxDay;
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

  if (c) {
    const compound = `${t}|${c}`;
    if (typeMap[compound]) return typeMap[compound];
  }
  if (typeMap[t]) return typeMap[t];

  return null;
}

/** Re-join raw lines so a quoted field containing a literal newline isn't
 *  split into two rows. A line is a genuine row boundary only when it has
 *  an even number of `"` characters seen so far (i.e. no quote is left
 *  "open" across the line break). */
function joinQuotedLines(rawLines: string[]): string[] {
  const out: string[] = [];
  const parts: string[] = [];
  let openQuotes = 0;

  for (const line of rawLines) {
    parts.push(line);
    // Count only the new line's quotes incrementally (O(n) total vs O(n²)).
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') openQuotes++;
    }
    if (openQuotes % 2 === 0) {
      out.push(parts.join('\n'));
      parts.length = 0;
      openQuotes = 0;
    }
  }
  if (parts.length > 0) out.push(parts.join('\n')); // unbalanced trailing quote - best-effort passthrough
  return out;
}

/** Escape a field so `|` can be safely used as an internal separator. */
function escapeKeyPart(v: string | number | null | undefined): string {
  return String(v ?? '').replace(/\|/g, '%7C');
}

/** Lightweight stable hash (FNV-1a, 32-bit) for deterministic row IDs. */
function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ── Profile detection ──────────────────────────────────────────

export function detectProfile(
  headerLine: string,
  profiles?: ImportProfile[],
): ImportProfile | null {
  const pool = profiles || builtInProfiles;
  const lower = headerLine.toLowerCase();
  const separator = detectSeparator(headerLine);
  const headers = csvLine(headerLine, separator).map((h) => h.trim());
  const headerIndexExact = new Map<string, number>();
  const headerIndexLower = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (!headerIndexExact.has(header)) headerIndexExact.set(header, i);
    const normalized = header.toLowerCase();
    if (!headerIndexLower.has(normalized)) headerIndexLower.set(normalized, i);
  }
  const hasHeader = (source: string | number | undefined): boolean => {
    if (source === undefined) return false;
    if (typeof source === 'number') return source >= 0 && source < headers.length;
    return headerIndexExact.has(source) || headerIndexLower.has(source.toLowerCase());
  };
  const requiredColumns = ['date', 'type', 'amount'] as const;

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
  if (!bestProfile) return null;

  for (const column of requiredColumns) {
    if (!hasHeader(bestProfile.columns[column])) return null;
  }

  return bestProfile;
}

// ── Generic parser ─────────────────────────────────────────────

export function parseWithProfile(text: string, profile: ImportProfile): ParseResult {
  const lines = joinQuotedLines(text.trim().split('\n'));
  if (lines.length < 2)
    return {
      transactions: [],
      unmapped: [],
      dateErrors: [],
      numberErrors: [],
      errorLines: [],
      headerLine: lines[0] ?? '',
    };

  // Resolve delimiter
  const sep = profile.delimiter === 'auto' ? detectSeparator(lines[0]) : profile.delimiter || ',';

  // Parse header
  const hdrs = csvLine(lines[0], sep).map((h) => h.trim());
  const headerIndexExact = new Map<string, number>();
  const headerIndexLower = new Map<string, number>();
  for (let i = 0; i < hdrs.length; i++) {
    const header = hdrs[i];
    if (!headerIndexExact.has(header)) headerIndexExact.set(header, i);
    const lower = header.toLowerCase();
    if (!headerIndexLower.has(lower)) headerIndexLower.set(lower, i);
  }
  const findHeaderIndex = (source: string): number => {
    const exact = headerIndexExact.get(source);
    if (exact !== undefined) return exact;
    return headerIndexLower.get(source.toLowerCase()) ?? -1;
  };

  // Build column index lookup: canonical field → column index
  const colIdx: Record<string, number> = {};
  for (const [canonical, source] of Object.entries(profile.columns)) {
    if (typeof source === 'number') {
      colIdx[canonical] = source;
    } else if (typeof source === 'string') {
      const idx = findHeaderIndex(source);
      if (idx >= 0) colIdx[canonical] = idx;
    }
  }

  const transactions: Transaction[] = [];
  const unmappedCounts: Record<string, number> = {};
  const dateErrorCounts: Record<string, number> = {};
  const numberErrorCounts: Record<string, { field: string; raw: string; count: number }> = {};
  const idHashCounts: Record<string, number> = {}; // preserve duplicates with identical row hash
  const errorLines: string[] = [];
  const headerLine = lines[0];

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
    if (!date) {
      dateErrorCounts['(empty)'] = (dateErrorCounts['(empty)'] || 0) + 1;
      errorLines.push(lines[i]);
      continue;
    }
    if (!isValidIsoDate(date)) {
      const key = rawDate || '(empty)';
      dateErrorCounts[key] = (dateErrorCounts[key] || 0) + 1;
      errorLines.push(lines[i]);
      continue;
    }

    // Type mapping
    const rawType = get('type');
    const rawCategory = get('category');
    const canonicalType = mapType(rawType, rawCategory, profile.typeMap);

    if (canonicalType === null) {
      // Unmapped - still include the row, tagged as unmapped
      const sourceKey = rawCategory ? `${rawType}|${rawCategory}` : rawType;
      const upperKey = sourceKey.toUpperCase() || 'EMPTY';
      unmappedCounts[upperKey] = (unmappedCounts[upperKey] || 0) + 1;

      // When skipUnmapped is set, exclude rows not in typeMap entirely
      if (profile.skipUnmapped) continue;
    }

    // The canonical type for the tx: use mapped value or preserve raw (uppercased)
    const txType = (canonicalType || (rawType || '').toUpperCase() || 'UNKNOWN') as TxTypeValue;

    /** Parse a number field, tracking non-empty cells that fail to parse. */
    let hadNumberError = false;
    const parseField = (field: string): number => {
      const raw = get(field);
      const n = parseNumber(raw, profile.decimal);
      if (isNaN(n) && raw && raw.trim()) {
        const key = `${field}|${raw.trim()}`;
        if (numberErrorCounts[key]) {
          numberErrorCounts[key].count++;
        } else {
          numberErrorCounts[key] = { field, raw: raw.trim(), count: 1 };
        }
        hadNumberError = true;
        return 0;
      }
      return n;
    };

    const amount = parseField('amount');
    const tax = parseField('tax');
    const isin = get('isin') || get('symbol');
    const shares = parseField('shares');
    const price = parseField('price');
    const fee = parseField('fee');
    const fxRate = parseField('fxRate');

    if (hadNumberError) errorLines.push(lines[i]);

    // Generate a deterministic ID when the CSV provides none.
    // Profiles that lack an id column must declare `idColumns`.
    // The suffix is derived from row content (not a session counter), so
    // re-imports in separate sessions remain stable per logical row.
    let id = get('id');
    if (!id && profile.idColumns) {
      const baseKey = profile.idColumns
        .map((col) => {
          const idx = findHeaderIndex(col);
          return escapeKeyPart(idx >= 0 ? (vals[idx] || '').trim() : '');
        })
        .join('|');
      const rowFingerprint = [
        profile.id,
        date,
        txType,
        rawCategory,
        get('name'),
        isin,
        shares,
        price,
        amount,
        fee,
        tax,
        get('currency') || profile.defaultCurrency,
        fxRate,
      ]
        .map(escapeKeyPart)
        .join('|');
      const rowHash = stableHash(rowFingerprint);
      const hashKey = `${baseKey}|${rowHash}`;
      idHashCounts[hashKey] = (idHashCounts[hashKey] || 0) + 1;
      const occurrenceSuffix = idHashCounts[hashKey] > 1 ? `:${idHashCounts[hashKey]}` : '';
      id = `${profile.id}|${baseKey}#${rowHash}${occurrenceSuffix}`;
    }

    const canonicalTax = txType === 'TAX' ? (tax !== 0 ? tax : amount) : tax;
    const canonicalAmount = txType === 'TAX' ? canonicalTax : amount;

    transactions.push({
      id,
      date,
      source: profile.id,
      category: rawCategory,
      type: txType,
      name: get('name'),
      isin,
      shares,
      price,
      amount: canonicalAmount,
      fee,
      tax: canonicalTax,
      currency: get('currency') || profile.defaultCurrency,
      fxRate,
    });
  }

  // Filter rows that somehow still have no date or type (shouldn't happen after above guards)
  let filtered = transactions.filter((t) => t.date && t.type);

  if (profile.mergeTaxIntoInterest) {
    const interestByMonth: Record<string, Transaction> = {};
    const taxRowsByMonth: Record<string, Transaction[]> = {};
    const rest: Transaction[] = [];
    const shiftMonth = (month: string, offset: number): string => {
      const [y, m] = month.split('-').map(Number);
      const d = new Date(y, m - 1 + offset, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    for (const tx of filtered) {
      if (tx.type === 'INTEREST') {
        const month = tx.date.slice(0, 7);
        if (interestByMonth[month]) {
          interestByMonth[month].amount += tx.amount;
        } else {
          interestByMonth[month] = tx;
        }
      } else if (tx.type === 'TAX') {
        const month = tx.date.slice(0, 7);
        (taxRowsByMonth[month] ??= []).push(tx);
      } else {
        rest.push(tx);
      }
    }

    const unmatchedTaxRows: Transaction[] = [];
    for (const [month, taxes] of Object.entries(taxRowsByMonth)) {
      const interest = interestByMonth[month];
      if (interest) {
        for (const tax of taxes) {
          interest.tax = (interest.tax || 0) + tax.amount;
          interest.amount += tax.amount;
        }
      } else {
        unmatchedTaxRows.push(...taxes);
      }
    }

    for (const tax of unmatchedTaxRows) {
      const taxMonth = tax.date.slice(0, 7);
      const prevMonth = shiftMonth(taxMonth, -1);
      const nextMonth = shiftMonth(taxMonth, 1);
      const candidate = interestByMonth[prevMonth] || interestByMonth[nextMonth];
      if (candidate) {
        candidate.tax = (candidate.tax || 0) + tax.amount;
        candidate.amount += tax.amount;
      } else {
        rest.push(tax);
      }
    }

    filtered = [...Object.values(interestByMonth), ...rest];
  }

  const unmapped: UnmappedType[] = Object.entries(unmappedCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
  const dateErrors = Object.entries(dateErrorCounts)
    .map(([raw, count]) => ({ raw, count }))
    .sort((a, b) => b.count - a.count);
  const numberErrors = Object.values(numberErrorCounts).sort((a, b) => b.count - a.count);

  return { transactions: filtered, unmapped, dateErrors, numberErrors, errorLines, headerLine };
}

/**
 * Generate a preview summary for parsed results.
 */
export function previewSummary(parsed: ParseResult): PreviewSummary {
  const { transactions, unmapped, dateErrors, numberErrors, errorLines, headerLine } = parsed;
  const byCounts: Record<string, number> = {};
  for (const tx of transactions) {
    byCounts[tx.type] = (byCounts[tx.type] || 0) + 1;
  }
  return {
    total: transactions.length,
    byCounts,
    unmapped,
    dateErrors,
    numberErrors,
    errorLines,
    headerLine,
    sample: transactions.slice(0, 10),
  };
}
