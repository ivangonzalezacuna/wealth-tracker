import { isValidISIN } from '../model/isin';
import type { Account, Snapshot } from '../types';

export interface Cell {
  x: number;
  text: string;
}
export interface StatementLine {
  page: number;
  y: number;
  cells: Cell[];
}
export interface Statement {
  valuationDate: string;
  cash: number;
  brokerage: number;
  total: number;
  holdings: { isin: string; value: number }[];
}
export const PDF_ERROR =
  'Unsupported or incomplete PDF. Use a complete, unencrypted German Trade Republic EUR statement with selectable text, or enter balances manually.';

function reject(): never {
  throw new Error(PDF_ERROR);
}

export function germanCents(raw: string): number {
  const match = /^(0|[1-9]\d{0,2}(?:\.\d{3})*|[1-9]\d*),(\d{2})(?: EUR)?$/.exec(raw);
  if (!match) return reject();
  const cents = Number(match[1].replaceAll('.', '')) * 100 + Number(match[2]);
  if (!Number.isSafeInteger(cents)) return reject();
  return cents;
}

export function positionedLines(
  items: { str: string; transform: number[]; width: number }[],
  page: number,
): StatementLine[] {
  const rows: StatementLine[] = [];
  for (const item of [...items].sort(
    (a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
  )) {
    const [x, y] = [item.transform[4], item.transform[5]];
    if (![x, y, item.width].every(Number.isFinite)) reject();
    if (!item.str.trim()) continue;
    let row = rows.at(-1);
    if (row && Math.abs(row.y - y) > 2) row = undefined;
    if (!row) {
      row = { page, y, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x, text: item.str.replace(/\s+/g, ' ').trim() });
  }
  // Keep individual positioned cells: joining an entire line loses the price/value boundary.
  for (const row of rows) row.cells.sort((a, b) => a.x - b.x);
  return rows;
}

export function parseTradeRepublic(
  lines: StatementLine[],
  pageCount: number,
  now = new Date(),
): Statement {
  if (!lines.length || pageCount < 1 || pageCount > 20) reject();
  const text = (line: StatementLine) => line.cells.map((c) => c.text).join(' ');
  const texts = lines.map(text);
  if (
    !texts.some((s) => s === 'TRADE REPUBLIC') ||
    texts.filter((s) => s === 'VERMÖGENSÜBERSICHT').length !== 1 ||
    !texts.includes('BROKERAGE') ||
    !texts.includes('CASH') ||
    !texts.includes('PORTFOLIO KURSWERT IN EUR') ||
    !texts.includes('PRODUKT SALDO') ||
    texts.some((s) => /\b(?:USD|GBP|CHF|US-Dollar)\b/.test(s))
  )
    reject();
  const dates = texts.flatMap((s) => {
    const m =
      /^(?:zum |Aufstellung über (?:die Brokerage Wertpapiere in Deinem Depot .+|das Cash in Deinem Konto) zum )(\d{2}\.\d{2}\.\d{4})\.?$/.exec(
        s,
      );
    return m ? [m[1]] : [];
  });
  if (dates.length !== 3 || new Set(dates).size !== 1) reject();
  const [day, month, year] = dates[0].split('.').map(Number);
  if (year < 2000 || month < 1 || month > 12 || day !== new Date(year, month, 0).getDate())
    reject();
  const valuationDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (valuationDate.slice(0, 7) > current) reject();

  const oneAmount = (label: string): number => {
    const matches = lines.filter((l) => l.cells[0]?.text === label);
    if (matches.length !== 1) return reject();
    return germanCents(
      matches[0].cells
        .slice(1)
        .map((c) => c.text)
        .join(' '),
    );
  };
  const brokerage = oneAmount('Brokerage');
  const cash = oneAmount('Cash');
  const total = oneAmount('GESAMT');
  if (
    !Number.isSafeInteger(brokerage + cash) ||
    brokerage + cash !== total ||
    oneAmount('Cashkonto') !== cash
  )
    reject();

  const headers = lines.filter(
    (l) =>
      text(l).includes('WERTPAPIERBEZEICHNUNG') &&
      text(l).includes('KURS PRO STÜCK') &&
      text(l).endsWith('KURSWERT IN EUR'),
  );
  if (headers.length !== 1) reject();
  const header = headers[0];
  const right = header.cells.find((c) => c.text.startsWith('KURSWERT'))?.x;
  const nameX = header.cells.find((c) => c.text === 'WERTPAPIERBEZEICHNUNG')?.x;
  if (right === undefined || nameX === undefined || right <= nameX) reject();
  const start = lines.indexOf(header) + 1;
  const end = lines.findIndex((l, i) => i >= start && /^ANZAHL POSITIONEN: \d+ /.test(text(l)));
  if (end < start) reject();
  const footer = /^ANZAHL POSITIONEN: (\d+) (.+)$/.exec(text(lines[end]));
  if (!footer || germanCents(footer[2]) !== brokerage) reject();
  const holdings: Statement['holdings'] = [];
  let pending: number | undefined;
  for (const line of lines.slice(start, end)) {
    const valueCells = line.cells.filter((c) => c.x >= right - 3);
    const isinMatch = /^ISIN: ([A-Z0-9]{12})(?: .*)?$/.exec(text(line));
    if (valueCells.length) {
      if (pending !== undefined) reject();
      pending = germanCents(valueCells.map((c) => c.text).join(' '));
      if (!line.cells.some((c) => c.x < nameX && /^\d+(?:,\d+)?(?: Stk\.)?$/.test(c.text)))
        reject();
    }
    if (isinMatch) {
      if (
        pending === undefined ||
        !isValidISIN(isinMatch[1]) ||
        holdings.some((h) => h.isin === isinMatch[1])
      )
        reject();
      holdings.push({ isin: isinMatch[1], value: pending / 100 });
      pending = undefined;
    } else if (text(line).includes('ISIN:')) reject();
  }
  if (
    pending !== undefined ||
    holdings.length !== Number(footer[1]) ||
    holdings.reduce((sum, h) => sum + Math.round(h.value * 100), 0) !== brokerage
  )
    reject();
  const pages = texts.flatMap((s) => {
    const m = /^Seite (\d+) von (\d+)$/.exec(s);
    return m ? [{ n: Number(m[1]), total: Number(m[2]) }] : [];
  });
  if (
    pages.length &&
    (pages.length !== pageCount ||
      new Set(pages.map((p) => p.n)).size !== pageCount ||
      pages.some((p) => p.total !== pageCount || p.n < 1 || p.n > pageCount))
  )
    reject();
  return {
    valuationDate,
    cash: cash / 100,
    brokerage: brokerage / 100,
    total: total / 100,
    holdings,
  };
}

export function mergeStatement(
  statement: Statement,
  accounts: Account[],
  knownIsins: string[],
  cashId: string,
  investmentId: string,
  excluded: string[],
  existing?: Snapshot,
): Snapshot {
  const cash = accounts.find((a) => a.id === cashId);
  const investment = accounts.find((a) => a.id === investmentId);
  const safeAccountId = (id: string) =>
    /^[a-z0-9_]{1,30}$/.test(id) &&
    !['date', 'notes', '__proto__'].includes(id) &&
    !id.startsWith('etf_');
  if (
    !cash ||
    !investment ||
    cashId === investmentId ||
    !safeAccountId(cashId) ||
    !safeAccountId(investmentId) ||
    (cash.currency || 'EUR') !== 'EUR' ||
    cash.moneyType?.toLowerCase() !== 'cash' ||
    (investment.currency || 'EUR') !== 'EUR' ||
    !investment.isPrimaryInvestment ||
    investment.moneyType?.toLowerCase() !== 'investment'
  )
    throw new Error('Select distinct EUR cash and primary investment accounts.');
  const known = new Set(knownIsins.filter(isValidISIN));
  if (statement.holdings.some((h) => !known.has(h.isin) && !excluded.includes(h.isin))) {
    throw new Error(
      'Resolve unknown securities in Settings, or explicitly exclude their breakdown values.',
    );
  }
  const snap: Snapshot = { date: statement.valuationDate.slice(0, 7) };
  if (existing?.date === snap.date) {
    if (typeof existing.notes === 'string') snap.notes = existing.notes;
    for (const a of accounts) {
      if (
        a.id &&
        safeAccountId(a.id) &&
        typeof existing[a.id] === 'number' &&
        Number.isFinite(existing[a.id])
      )
        snap[a.id] = existing[a.id];
    }
  }
  snap[cashId] = statement.cash;
  snap[investmentId] = statement.brokerage;
  for (const h of statement.holdings) {
    if (known.has(h.isin)) snap[`etf_${h.isin}`] = h.value;
  }
  return snap;
}
