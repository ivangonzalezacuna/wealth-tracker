import { TxType } from './model/tx.js';

function csvLine(line, sep = ',') {
  const r = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQ = !inQ; }
    else if (line[i] === sep && !inQ) { r.push(cur); cur = ''; }
    else cur += line[i];
  }
  r.push(cur);
  return r;
}

/** Detect whether the CSV uses semicolons (German format) or commas as delimiter. */
function detectSeparator(headerLine) {
  // If splitting by semicolon yields more columns than comma, it's semicolon-delimited
  const bySemi = csvLine(headerLine, ';');
  const byComma = csvLine(headerLine, ',');
  return bySemi.length > byComma.length ? ';' : ',';
}

/** Normalize a numeric string: handle German 1.234,56 format → 1234.56 */
export function parseNum(s) {
  if (!s) return 0;
  s = s.trim();
  // German format: dots as thousands separators, comma as decimal
  // Detect: if string has comma after dots, it's German (e.g. "1.234,56")
  // Also matches plain comma-decimal with no thousands (e.g. "12,34")
  if (/^\-?\d{1,3}(\.\d{3})*,\d+$/.test(s) || /^\-?\d+,\d+$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  return parseFloat(s) || 0;
}

/**
 * Map TR raw type+category to canonical TxType.
 * Sell direction comes from type, NOT the sign of amount.
 * @param {string} type - TR raw type
 * @param {string} category - TR raw category
 * @returns {string} canonical TxType
 */
function mapTRType(type, category) {
  const t = (type || '').toUpperCase();
  const c = (category || '').toUpperCase();

  if (t === 'BUY'  && c === 'TRADING')  return TxType.BUY;
  if (t === 'SELL' && c === 'TRADING')  return TxType.SELL;
  if (t === 'BUY')                      return TxType.BUY;
  if (t === 'SELL')                     return TxType.SELL;
  if (t === 'DIVIDEND')                 return TxType.DIVIDEND;
  if (t === 'INTEREST_PAYMENT')         return TxType.INTEREST;
  if (t === 'FEE')                      return TxType.FEE;
  if (t === 'TAX')                      return TxType.TAX;
  if (t === 'DEPOSIT')                  return TxType.DEPOSIT;
  if (t === 'WITHDRAWAL')               return TxType.WITHDRAWAL;
  if (t === 'TRANSFER')                 return TxType.TRANSFER;

  // Fallback: preserve original type
  return t || 'UNKNOWN';
}

/** Parse a TR Transaktionsexport CSV string into transaction objects.
 *  Handles both comma-delimited (dot-decimal) and semicolon-delimited (German) formats. */
export function parseCSV(text) {
  const lines = text.trim().split('\n');
  const sep   = detectSeparator(lines[0]);
  const hdrs  = csvLine(lines[0], sep).map(h => h.trim());
  const rows  = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = csvLine(lines[i], sep);
    const row  = {};
    hdrs.forEach((h, j) => { row[h] = (vals[j] || '').trim(); });
    if (row.date) rows.push(row);
  }
  return rows.map(r => {
    const rawType = r.type || '';
    const rawCategory = r.category || '';
    const canonicalType = mapTRType(rawType, rawCategory);
    return {
      id:       r.transaction_id || '',
      date:     r.date,
      source:   'trade_republic',
      category: rawCategory,
      type:     canonicalType,
      name:     r.name     || '',
      symbol:   r.symbol   || '',
      shares:   parseNum(r.shares),
      price:    parseNum(r.price),
      amount:   parseNum(r.amount),
      fee:      parseNum(r.fee),
      tax:      parseNum(r.tax),
      currency: r.currency || 'EUR',
      fxRate:   parseNum(r.fx_rate || r.fxRate || ''),
    };
  }).filter(t => t.date && t.type);
}
