function csvLine(line) {
  const r = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQ = !inQ; }
    else if (line[i] === ',' && !inQ) { r.push(cur); cur = ''; }
    else cur += line[i];
  }
  r.push(cur);
  return r;
}

/** Parse a TR Transaktionsexport CSV string into transaction objects. */
export function parseCSV(text) {
  const lines = text.trim().split('\n');
  const hdrs  = csvLine(lines[0]).map(h => h.trim());
  const rows  = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = csvLine(lines[i]);
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
    shares:   parseFloat(r.shares) || 0,
    price:    parseFloat(r.price)  || 0,
    amount:   parseFloat(r.amount) || 0,
    tax:      parseFloat(r.tax)    || 0,
  })).filter(t => t.date && t.type);
}
