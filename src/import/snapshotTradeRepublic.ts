import { isValidISIN, normalizeISIN } from '../model/isin';

import type {
  PdfTextItem,
  PdfTextPage,
  StatementPosition,
  SnapshotStatement,
} from './snapshotStatement';

// English is deliberately absent until the broker's actual valuation labels are verified.
export const statementLocales = {
  de: {
    title: 'VERMOGENSUBERSICHT',
    marketValue: 'KURSWERT IN EUR',
    unitPrice: 'KURS PRO STUCK',
    positionCount: /ANZAHL POSITIONEN:\s*(\d+)/,
    page: /Seite\s+(\d+)\s+von\s+(\d+)/i,
  },
};

function plain(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseStatementAmount(token: string, locale: 'de' | 'en'): number {
  const pattern =
    locale === 'de' ? /^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/ : /^(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2}$/;
  if (!pattern.test(token)) throw new Error('Invalid statement amount.');
  const value = Number(
    locale === 'de' ? token.replaceAll('.', '').replace(',', '.') : token.replaceAll(',', ''),
  );
  if (!Number.isSafeInteger(Math.round(value * 100)))
    throw new Error('Statement amount is too large.');
  return value;
}

export function statementLines(page: PdfTextPage): string[] {
  const rows: { y: number; items: PdfTextItem[] }[] = [];
  for (const item of [...page.items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (!item.text.trim()) continue;
    const last = rows[rows.length - 1];
    const row = last && Math.abs(last.y - item.y) <= 2 ? last : undefined;
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows.map((r) =>
    r.items
      .sort((a, b) => a.x - b.x)
      .map((i) => i.text.trim())
      .join(' '),
  );
}

function validDate(token: string): string {
  const [day, month, year] = token.split('.').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error('Invalid statement valuation date.');
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function matchesTradeRepublicStatement(pages: PdfTextPage[]): boolean {
  const text = plain(pages.flatMap(statementLines).join(' '));
  return /Trade Republic Bank/i.test(text) && text.includes(statementLocales.de.title);
}

export function parseTradeRepublicStatement(pages: PdfTextPage[]): SnapshotStatement {
  const byPage = pages.map(statementLines);
  const lines = byPage.flat();
  const text = plain(lines.join(' '));
  const locale = statementLocales.de;
  if (!matchesTradeRepublicStatement(pages))
    throw new Error(
      'Unsupported statement. Only verified German Trade Republic valuations are supported; English labels are not verified yet.',
    );
  if (!text.includes(locale.marketValue) || !text.includes(locale.unitPrice))
    throw new Error('The statement market-value columns could not be identified.');
  const dates = [...text.matchAll(/\bzum\s+(\d{2}\.\d{2}\.\d{4})\b/gi)].map((m) => validDate(m[1]));
  if (!dates.length || new Set(dates).size !== 1)
    throw new Error('Missing or inconsistent statement valuation date.');
  const warnings: string[] = [];
  const expectedPages = new Set<number>();
  const pageNumbers = new Set<number>();
  for (const pageLines of byPage) {
    const matches = [...pageLines.join(' ').matchAll(new RegExp(locale.page.source, 'gi'))];
    if (matches.length !== 1) throw new Error('Missing or ambiguous statement page numbers.');
    const pageNumber = Number(matches[0][1]);
    const pageCount = Number(matches[0][2]);
    if (pageNumber < 1 || pageNumber > pageCount || pageNumbers.has(pageNumber))
      throw new Error('Invalid or duplicate statement page.');
    expectedPages.add(pageCount);
    pageNumbers.add(pageNumber);
  }
  if (expectedPages.size !== 1) throw new Error('Inconsistent statement page counts.');
  const complete = [...expectedPages][0] === pages.length;
  if (!complete)
    warnings.push('Incomplete statement: some pages are missing. Account totals are not proposed.');

  const positions: StatementPosition[] = [];
  const seen = new Set<string>();
  byPage.forEach((pageLines, pageIndex) => {
    let inBrokerage = false;
    for (let i = 0; i < pageLines.length; i++) {
      const line = pageLines[i].trim();
      if (/^BROKERAGE$/i.test(line)) inBrokerage = true;
      if (/^(?:CASH|ANZAHL POSITIONEN:)/.test(line)) inBrokerage = false;
      if (!inBrokerage || !/^[\d.,]+\s+Stk\./i.test(line)) continue;
      const row = line.match(/^[\d.,]+\s+Stk\.\s+(.+?)\s+([\d.,]+)\s+([\d.,]+)(?:\s+EUR)?$/i);
      if (!row) throw new Error(`Unrecognized position columns on page ${pageIndex + 1}.`);
      const continuation: string[] = [];
      let isin = '';
      for (let j = i + 1; j < Math.min(i + 5, pageLines.length); j++) {
        if (/^[\d.,]+\s+Stk\.|^ANZAHL POSITIONEN:|^CASH$/i.test(pageLines[j])) break;
        const identifier = pageLines[j].match(/\bISIN:\s*(\S+)/i);
        if (identifier) {
          isin = normalizeISIN(identifier[1]);
          break;
        }
        continuation.push(pageLines[j].trim());
      }
      if (!isValidISIN(isin))
        throw new Error(`Missing or invalid position ISIN on page ${pageIndex + 1}.`);
      if (seen.has(isin))
        throw new Error(
          'Duplicate position ISIN. Resolve duplicate rows manually; values were not added.',
        );
      seen.add(isin);
      parseStatementAmount(row[2], 'de');
      positions.push({
        isin,
        name: [row[1], ...continuation].join(' '),
        value: parseStatementAmount(row[3], 'de'),
        page: pageIndex + 1,
      });
    }
  });
  if (!positions.length)
    throw new Error('No supported ETF positions found. Enter this statement manually.');
  const countMatches = [...text.matchAll(new RegExp(locale.positionCount.source, 'g'))];
  if (countMatches.length !== 1 || Number(countMatches[0][1]) !== positions.length)
    warnings.push(
      'Position count is missing or does not match. Missing positions remain unknown; account totals are not proposed.',
    );

  const readTotal = (label: string): number | undefined => {
    const values: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = line.match(new RegExp(`^${label}\\s+([\\d.,]+)(?:\\s+EUR)?$`, 'i'));
      if (match) values.push(parseStatementAmount(match[1], 'de'));
      else if (new RegExp(`^${label}$`, 'i').test(line)) {
        const next = lines[i + 1]?.trim().match(/^([\d.,]+)(?:\s+EUR)?$/);
        if (next) values.push(parseStatementAmount(next[1], 'de'));
      }
    }
    if (new Set(values).size > 1)
      throw new Error('Conflicting statement totals. No values were applied.');
    return values[0];
  };
  const securities = readTotal('Brokerage');
  const summaryCash = readTotal('Cash');
  const cash = readTotal('Cashkonto');
  const total = readTotal('GESAMT');
  const cents = (n: number) => Math.round(n * 100);
  if (summaryCash !== undefined && cash !== undefined && cents(summaryCash) !== cents(cash))
    throw new Error('Cash detail does not match the statement summary.');
  const sum = positions.reduce((s, p) => s + cents(p.value), 0);
  if (!warnings.length && securities !== undefined && sum !== cents(securities))
    throw new Error('ETF market values do not reconcile to the securities subtotal.');
  if (
    securities !== undefined &&
    cash !== undefined &&
    total !== undefined &&
    cents(securities) + cents(cash) !== cents(total)
  )
    throw new Error('Securities plus cash do not reconcile to the statement total.');
  if (securities === undefined || cash === undefined || total === undefined)
    warnings.push('Some account totals could not be verified. Only positions are proposed.');
  const verified = !warnings.length;
  return {
    documentType: 'trade-republic:valuation',
    date: dates[0],
    currency: 'EUR',
    positions,
    warnings,
    securities: verified ? securities : undefined,
    cash: verified ? cash : undefined,
    total: verified ? total : undefined,
  };
}
