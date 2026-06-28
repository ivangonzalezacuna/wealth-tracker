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
  return rows.map(r => ({
    id:       r.transaction_id || '',
    date:     r.date,
    category: r.category || '',
    type:     r.type     || '',
    name:     r.name     || '',
    symbol:   r.symbol   || '',
    shares:   parseNum(r.shares),
    price:    parseNum(r.price),
    amount:   parseNum(r.amount),
    tax:      parseNum(r.tax),
  })).filter(t => t.date && t.type);
}
