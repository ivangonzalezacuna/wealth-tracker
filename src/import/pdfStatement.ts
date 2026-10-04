import { isValidISIN } from '../model/isin';
import type { Account, Snapshot } from '../types';

export interface Cell {
  x: number;
  text: string;
  width?: number;
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

const PDF_MESSAGES = {
  file: 'Choose a PDF file, or enter balances manually.',
  size: 'The PDF is too large. Use a smaller statement, or enter balances manually.',
  limit: 'The PDF exceeds supported processing limits. Enter balances manually.',
  timeout: 'PDF processing timed out. Try again, or enter balances manually.',
  password:
    'Encrypted PDFs are unsupported. Use an unencrypted statement, or enter balances manually.',
  text: 'No usable selectable text was found. Scanned PDFs are unsupported; enter balances manually.',
  layout:
    'The PDF layout is unsupported. Use a complete German Trade Republic statement, or enter balances manually.',
  date: 'The statement dates are inconsistent or unsupported. Use a completed month-end statement.',
  summary: 'The statement summary does not reconcile. Use a complete EUR statement.',
  positions: 'The securities are incomplete or do not reconcile. Use a complete statement.',
  cash: 'The cash section is missing or inconsistent. Use a complete EUR statement.',
  pages: 'The statement pages are missing or inconsistent. Use the complete PDF.',
  numeric: 'A statement amount or quantity is invalid. Use a German EUR statement.',
  loading: 'The PDF could not be loaded. Try another PDF, or enter balances manually.',
  cancelled: 'PDF import was cancelled.',
} as const;

export type PdfValidationCode = keyof typeof PDF_MESSAGES;

function validationMessage(code: PdfValidationCode): string {
  return `[${code}] ${PDF_MESSAGES[code]}`;
}

export class PdfValidationError extends Error {
  readonly code: PdfValidationCode;
  constructor(code: PdfValidationCode) {
    super(Object.hasOwn(PDF_MESSAGES, code) ? validationMessage(code) : PDF_ERROR);
    this.name = 'PdfValidationError';
    this.code = code;
  }
}

export function safePdfMessage(error: unknown): string {
  return error instanceof PdfValidationError && Object.hasOwn(PDF_MESSAGES, error.code)
    ? validationMessage(error.code)
    : PDF_ERROR;
}

function reject(code: PdfValidationCode = 'layout'): never {
  throw new PdfValidationError(code);
}

export function germanCents(raw: string): number {
  const match = /^(0|[1-9]\d{0,2}(?:\.\d{3})*|[1-9]\d*),(\d{2})(?: EUR)?$/.exec(raw);
  if (!match) return reject('numeric');
  const cents = Number(match[1].replaceAll('.', '')) * 100 + Number(match[2]);
  if (!Number.isSafeInteger(cents)) return reject('numeric');
  return cents;
}

function validQuoteDate(raw: string, valuationDate: string): boolean {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
  if (!match) return false;
  const [, dd, mm, yyyy] = match;
  const [day, month, year] = [Number(dd), Number(mm), Number(yyyy)];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= new Date(year, month, 0).getDate() &&
    `${yyyy}-${mm}-${dd}` <= valuationDate
  );
}

export function positionedLines(
  items: { str: string; transform: number[]; width: number; hasEOL?: boolean }[],
  page: number,
): StatementLine[] {
  const rows: StatementLine[] = [];
  for (const item of [...items].sort(
    (a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
  )) {
    const [x, y] = [item.transform[4], item.transform[5]];
    if (![x, y, item.width].every(Number.isFinite) || item.width < 0) reject('layout');
    if (!item.str.trim()) continue;
    let row = rows.at(-1);
    if (row && Math.abs(row.y - y) > 2) row = undefined;
    if (!row) {
      row = { page, y, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x, width: item.width, text: item.str.replace(/\s+/g, ' ') });
  }
  // Keep individual positioned cells: joining an entire line loses the price/value boundary.
  for (const row of rows) row.cells.sort((a, b) => a.x - b.x);
  return rows;
}

// Only join touching PDF fragments. A visible gap (or an explicit space) remains
// a space, so malformed "1 234,56" never becomes a valid amount.
function cellText(cells: Cell[]): string {
  let result = '';
  let previous: Cell | undefined;
  for (const cell of [...cells].sort((a, b) => a.x - b.x)) {
    const touching =
      previous?.width !== undefined &&
      cell.x - (previous.x + previous.width) >= -0.5 &&
      cell.x - (previous.x + previous.width) <= 0.8;
    result += `${result && !touching ? ' ' : ''}${cell.text.replace(/\s+/g, ' ')}`;
    previous = cell;
  }
  return result.replace(/\s+/g, ' ').trim();
}

function logicalCells(cells: Cell[]): Cell[] {
  const grouped: Cell[] = [];
  for (const cell of [...cells].sort((a, b) => a.x - b.x)) {
    const previous = grouped.at(-1);
    const gap = previous?.width === undefined ? Infinity : cell.x - previous.x - previous.width;
    if (previous && gap >= -0.5 && gap <= 0.8 && cell.width !== undefined) {
      previous.text += cell.text;
      previous.width = cell.x + cell.width - previous.x;
    } else {
      grouped.push({ ...cell });
    }
  }
  return grouped;
}

export function parseTradeRepublic(
  lines: StatementLine[],
  pageCount: number,
  now = new Date(),
): Statement {
  if (!lines.length || !Number.isInteger(pageCount) || pageCount < 1 || pageCount > 20)
    reject('pages');
  if (
    lines.some(
      (line) =>
        !Number.isInteger(line.page) ||
        line.page < 1 ||
        line.page > pageCount ||
        !Number.isFinite(line.y) ||
        line.cells.some(
          (c) =>
            !Number.isFinite(c.x) ||
            (c.width !== undefined && (!Number.isFinite(c.width) || c.width < 0)),
        ),
    )
  )
    reject('layout');
  lines = lines
    .map((line) => ({ ...line, cells: logicalCells(line.cells) }))
    .sort((a, b) => a.page - b.page || b.y - a.y);
  const text = (line: StatementLine) => cellText(line.cells);
  const compact = (s: string) => s.replace(/\s/g, '');
  const texts = lines.map(text);
  const pages = lines.flatMap((line) => {
    const m = /(?:^| )Seite (\d+) von (\d+)$/.exec(text(line));
    return m ? [{ n: Number(m[1]), total: Number(m[2]), actual: line.page }] : [];
  });
  if (
    pages.length !== pageCount ||
    new Set(pages.map((p) => p.n)).size !== pageCount ||
    pages.some((p) => p.total !== pageCount || p.n !== p.actual)
  )
    reject('pages');
  if (
    !texts.some((s) => compact(s) === 'TRADEREPUBLIC') ||
    texts.filter((s) => compact(s) === 'VERMÖGENSÜBERSICHT').length !== 1 ||
    !texts.includes('BROKERAGE') ||
    !texts.includes('CASH')
  )
    reject('layout');
  const datePatterns = [
    /^zum (\d{2}\.\d{2}\.\d{4})$/,
    /^Aufstellung über die Brokerage Wertpapiere in [Dd]einem Depot \S+ zum (\d{2}\.\d{2}\.\d{4})\.$/,
    /^Aufstellung über das Cash in [Dd]einem Konto zum (\d{2}\.\d{2}\.\d{4})\.$/,
  ];
  const dates = datePatterns.map((pattern) => {
    const matches: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      let candidate = texts[i];
      for (let count = 1; count <= 3; count++) {
        const match = pattern.exec(candidate);
        if (match) {
          matches.push(match[1]);
          break;
        }
        const next = lines[i + count];
        const previous = lines[i + count - 1];
        if (!next || next.page !== previous.page || previous.y - next.y > 18) break;
        candidate += ` ${texts[i + count]}`;
      }
    }
    if (matches.length !== 1) reject('date');
    return matches[0];
  });
  if (new Set(dates).size !== 1) reject('date');
  const [day, month, year] = dates[0].split('.').map(Number);
  if (year < 2000 || month < 1 || month > 12 || day !== new Date(year, month, 0).getDate())
    reject('date');
  const valuationDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (valuationDate.slice(0, 7) > current) reject('date');

  const summaryHeaders = lines.filter((l) => compact(text(l)) === 'PORTFOLIOKURSWERTINEUR');
  const cashHeaders = lines.filter((l) => compact(text(l)) === 'PRODUKTSALDO');
  if (summaryHeaders.length !== 1) reject('summary');
  if (cashHeaders.length !== 1) reject('cash');
  const amountBoundary = (header: StatementLine, label: string) => {
    const right = header.cells.find((c) => compact(c.text).startsWith(label))?.x;
    const left = Math.min(...header.cells.map((c) => c.x));
    if (right === undefined || right <= left) return reject('layout');
    return (left + right) / 2;
  };
  const summaryBoundary = amountBoundary(summaryHeaders[0], 'KURS');
  const cashBoundary = amountBoundary(cashHeaders[0], 'SAL');
  const oneAmount = (label: string, boundary: number, code: PdfValidationCode): number => {
    const matches = lines.filter((l) => cellText(l.cells.filter((c) => c.x < boundary)) === label);
    if (matches.length !== 1) return reject(code);
    return germanCents(cellText(matches[0].cells.filter((c) => c.x >= boundary)));
  };
  const brokerage = oneAmount('Brokerage', summaryBoundary, 'summary');
  const cash = oneAmount('Cash', summaryBoundary, 'summary');
  const total = oneAmount('GESAMT', summaryBoundary, 'summary');
  if (!Number.isSafeInteger(brokerage + cash) || brokerage + cash !== total) reject('summary');
  if (oneAmount('Cashkonto', cashBoundary, 'cash') !== cash) reject('cash');

  const headerStarts = lines.filter((l) => compact(text(l)).startsWith('STK.'));
  if (headerStarts.length !== 1) reject('layout');
  const header = headerStarts[0];
  const nameX = header.cells.find((c) => compact(c.text).startsWith('WERT'))?.x;
  const kursColumns = header.cells.filter((c) => compact(c.text).startsWith('KURS'));
  const priceX = kursColumns[0]?.x;
  const right = kursColumns.at(-1)?.x;
  const quantityX = Math.min(...header.cells.map((c) => c.x));
  if (
    right === undefined ||
    nameX === undefined ||
    priceX === undefined ||
    !(quantityX < nameX && nameX < priceX && priceX < right)
  )
    reject('layout');
  const valueBoundary = (priceX + right) / 2;
  const zone = (line: StatementLine, left: number, rightEdge = Infinity) =>
    cellText(line.cells.filter((c) => c.x >= left - 3 && c.x < rightEdge - 3));
  let start = lines.indexOf(header) + 1;
  const headerRows = [header];
  while (
    start < lines.length &&
    lines[start].page === header.page &&
    headerRows.at(-1)!.y - lines[start].y <= 18 &&
    !/^\d/.test(zone(lines[start], quantityX, nameX)) &&
    headerRows.length < 3
  ) {
    headerRows.push(lines[start++]);
  }
  const headerLabel = (left: number, edge: number) =>
    compact(headerRows.map((l) => zone(l, left, edge)).join(' '));
  if (
    !/^STK\.\/?NOMINALE$/.test(headerLabel(quantityX, nameX)) ||
    headerLabel(nameX, priceX) !== 'WERTPAPIERBEZEICHNUNG' ||
    headerLabel(priceX, valueBoundary) !== 'KURSPROSTÜCK' ||
    headerLabel(valueBoundary, Infinity) !== 'KURSWERTINEUR'
  )
    reject('layout');
  const footers = lines.filter((l) => /^ANZAHL POSITIONEN\s*:/.test(zone(l, quantityX, priceX)));
  if (footers.length !== 1) reject('positions');
  const end = lines.indexOf(footers[0]);
  const footer = /^ANZAHL POSITIONEN\s*:\s*(0|[1-9]\d*)$/.exec(zone(footers[0], quantityX, priceX));
  if (end < start || !footer || germanCents(zone(footers[0], valueBoundary)) !== brokerage)
    reject('positions');
  const holdings: Statement['holdings'] = [];
  let holdingCents = 0;
  let pending: number | undefined;
  for (const line of lines.slice(start, end)) {
    const value = zone(line, valueBoundary);
    const quantity = zone(line, quantityX, nameX);
    const name = zone(line, nameX, priceX);
    const price = zone(line, priceX, valueBoundary);
    const isinMatch = /^ISIN\s*:\s*([A-Z0-9]{12})$/.exec(name);
    if (quantity || value) {
      if (pending !== undefined || !value || !name || isinMatch) reject('positions');
      pending = germanCents(value);
      if (!/^(0|[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)(?:,\d+)?(?: Stk\.)?$/.test(quantity))
        reject('numeric');
      if (!/^(0|[1-9]\d{0,2}(?:\.\d{3})*|[1-9]\d*),\d{2,8}(?: EUR)?$/.test(price))
        reject('numeric');
    } else if (price && !validQuoteDate(price, valuationDate)) {
      reject('date');
    }
    if (isinMatch) {
      if (
        pending === undefined ||
        !isValidISIN(isinMatch[1]) ||
        holdings.some((h) => h.isin === isinMatch[1])
      )
        reject('positions');
      holdingCents += pending;
      if (!Number.isSafeInteger(holdingCents)) reject('positions');
      holdings.push({ isin: isinMatch[1], value: pending / 100 });
      pending = undefined;
    } else if (name.includes('ISIN')) reject('positions');
  }
  if (pending !== undefined || holdings.length !== Number(footer[1]) || holdingCents !== brokerage)
    reject('positions');
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
    const configuredIds = new Set(
      accounts.map((a) => a.id).filter((id) => id && safeAccountId(id)),
    );
    if (
      Object.entries(existing).some(
        ([key, value]) =>
          key !== 'date' &&
          key !== 'notes' &&
          !key.startsWith('etf_') &&
          typeof value === 'number' &&
          Number.isFinite(value) &&
          !configuredIds.has(key),
      )
    )
      throw new Error(
        'This month contains existing balances that cannot be safely preserved as configured accounts. Resolve existing balances before importing, or use manual entry.',
      );
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
