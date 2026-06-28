/**
 * Generic profile-driven CSV parser.
 *
 * Consumes an ImportProfile (plain data) and produces canonical Transaction[].
 * The same parser works for any bank — behaviour is controlled entirely by the profile.
 */

import { builtInProfiles } from './profiles/index.js';

// ── Low-level CSV helpers (shared with legacy csv.js) ──────────

/** Split a single CSV line respecting quoted fields. */
export function csvLine(line, sep = ',') {
  const r = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQ = !inQ; }
    else if (line[i] === sep && !inQ) { r.push(cur); cur = ''; }
    else cur += line[i];
  }
  r.push(cur);
  return r;
}

/** Detect whether the CSV uses semicolons or commas as delimiter. */
export function detectSeparator(headerLine) {
  const bySemi  = csvLine(headerLine, ';');
  const byComma = csvLine(headerLine, ',');
  return bySemi.length > byComma.length ? ';' : ',';
}

// ── Number parsing ─────────────────────────────────────────────

/**
 * Parse a numeric string with configurable decimal style.
 * @param {string} s      - raw value
 * @param {'auto'|'dot'|'comma'} mode - decimal interpretation
 * @returns {number}
 */
export function parseNumber(s, mode = 'auto') {
  if (!s) return 0;
  s = s.trim();

  if (mode === 'comma' || (mode === 'auto' && isGermanNumber(s))) {
    // German: dots are thousands, comma is decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (mode === 'dot') {
    // Standard: commas are thousands, dot is decimal
    s = s.replace(/,/g, '');
  }
  // mode === 'auto' and not German → assume dot-decimal (default parseFloat)
  return parseFloat(s) || 0;
}

/** Detect German number format: 1.234,56 or plain 12,34. */
function isGermanNumber(s) {
  return /^-?\d{1,3}(\.\d{3})*,\d+$/.test(s) || /^-?\d+,\d+$/.test(s);
}

// ── Date parsing ───────────────────────────────────────────────

/**
 * Parse a date string into ISO yyyy-mm-dd according to the given format.
 * Supports: YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY, MM/DD/YYYY, ISO (passthrough).
 * @param {string} s
 * @param {string} fmt
 * @returns {string} ISO date string or empty string on failure
 */
export function parseDate(s, fmt) {
  if (!s) return '';
  s = s.trim();

  // If it already contains 'T', it's an ISO datetime — take the date part
  if (s.includes('T')) return s.slice(0, 10);

  switch (fmt) {
    case 'YYYY-MM-DD':
    case 'ISO': {
      // Validate rough shape
      const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!m) return s; // best-effort passthrough
      return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }
    case 'DD.MM.YYYY': {
      const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (!m) return s;
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    case 'DD/MM/YYYY': {
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!m) return s;
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    case 'MM/DD/YYYY': {
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!m) return s;
      return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
    default:
      return s; // unknown format — passthrough
  }
}

// ── Type mapping ───────────────────────────────────────────────

/**
 * Map a source type (+ optional category) to canonical TxType via profile.typeMap.
 * Tries compound key `TYPE|CATEGORY` first, then plain `TYPE`.
 * Returns the mapped value or `null` if unmapped.
 */
function mapType(rawType, rawCategory, typeMap) {
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
 * @param {string} headerLine - raw first line of the CSV
 * @param {import('./profile.js').ImportProfile[]} [profiles] - profiles to search (defaults to built-ins)
 * @returns {import('./profile.js').ImportProfile|null}
 */
export function detectProfile(headerLine, profiles) {
  const pool = profiles || builtInProfiles;
  const lower = headerLine.toLowerCase();

  let bestProfile = null;
  let bestScore   = 0;

  for (const p of pool) {
    const hints = p.match?.headerIncludes;
    if (!hints || hints.length === 0) continue;

    let hits = 0;
    for (const h of hints) {
      if (lower.includes(h.toLowerCase())) hits++;
    }
    if (hits === hints.length && hits > bestScore) {
      bestScore   = hits;
      bestProfile = p;
    }
  }
  return bestProfile;
}

// ── Generic parser ─────────────────────────────────────────────

/**
 * Parse CSV text using the given import profile.
 *
 * @param {string} text - raw CSV content
 * @param {import('./profile.js').ImportProfile} profile
 * @returns {{ transactions: import('../model/tx.js').Transaction[], unmapped: { type: string, count: number }[] }}
 */
export function parseWithProfile(text, profile) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { transactions: [], unmapped: [] };

  // Resolve delimiter
  const sep = profile.delimiter === 'auto'
    ? detectSeparator(lines[0])
    : profile.delimiter;

  // Parse header
  const hdrs = csvLine(lines[0], sep).map(h => h.trim());

  // Build column index lookup: canonical field → column index
  const colIdx = {};
  for (const [canonical, source] of Object.entries(profile.columns)) {
    if (typeof source === 'number') {
      colIdx[canonical] = source;
    } else {
      const idx = hdrs.findIndex(h => h === source);
      if (idx >= 0) colIdx[canonical] = idx;
    }
  }

  const transactions = [];
  const unmappedCounts = {};

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    const vals = csvLine(lines[i], sep);
    const get = (field) => {
      const idx = colIdx[field];
      return idx !== undefined ? (vals[idx] || '').trim() : '';
    };

    // Date is mandatory
    const rawDate = get('date');
    const date = parseDate(rawDate, profile.dateFormat);
    if (!date) continue;

    // Type mapping
    const rawType     = get('type');
    const rawCategory = get('category');
    const canonicalType = mapType(rawType, rawCategory, profile.typeMap);

    if (canonicalType === null) {
      // Unmapped — still include the row, tagged as unmapped
      const sourceKey = rawCategory ? `${rawType}|${rawCategory}` : rawType;
      const upperKey = sourceKey.toUpperCase() || 'EMPTY';
      unmappedCounts[upperKey] = (unmappedCounts[upperKey] || 0) + 1;
    }

    // The canonical type for the tx: use mapped value or preserve raw (uppercased)
    const txType = canonicalType || (rawType || '').toUpperCase() || 'UNKNOWN';

    transactions.push({
      id:       get('id'),
      date,
      source:   profile.id,
      category: rawCategory,
      type:     txType,
      name:     get('name'),
      symbol:   get('symbol'),
      shares:   parseNumber(get('shares'), profile.decimal),
      price:    parseNumber(get('price'), profile.decimal),
      amount:   parseNumber(get('amount'), profile.decimal),
      fee:      parseNumber(get('fee'), profile.decimal),
      tax:      parseNumber(get('tax'), profile.decimal),
      currency: get('currency') || profile.defaultCurrency,
      fxRate:   parseNumber(get('fxRate'), profile.decimal),
    });
  }

  // Filter rows that somehow still have no date or type (shouldn't happen after above guards)
  const filtered = transactions.filter(t => t.date && t.type);

  const unmapped = Object.entries(unmappedCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return { transactions: filtered, unmapped };
}

/**
 * Generate a preview summary for parsed results.
 * @param {{ transactions: import('../model/tx.js').Transaction[], unmapped: { type: string, count: number }[] }} parsed
 * @returns {{ total: number, byCounts: Record<string, number>, unmapped: { type: string, count: number }[], sample: import('../model/tx.js').Transaction[] }}
 */
export function previewSummary(parsed) {
  const { transactions, unmapped } = parsed;
  const byCounts = {};
  for (const tx of transactions) {
    byCounts[tx.type] = (byCounts[tx.type] || 0) + 1;
  }
  return {
    total:    transactions.length,
    byCounts,
    unmapped,
    sample:   transactions.slice(0, 10),
  };
}
