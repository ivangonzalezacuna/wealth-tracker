import { PDFDocument, StandardFonts } from 'pdf-lib';

export function fakeIsin(index: number): string {
  const base = `ZZ${String(index).padStart(9, '0')}`;
  const digits = [...`${base}0`]
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join('');
  const sum = [...digits].reverse().reduce((total, digit, i) => {
    const n = Number(digit) * (i % 2 ? 2 : 1);
    return total + (n > 9 ? n - 9 : n);
  }, 0);
  return `${base}${(10 - (sum % 10)) % 10}`;
}

export const FAKE_ISINS = Array.from({ length: 7 }, (_, i) => fakeIsin(i + 1));
export const FAKE_VALUES = [101.11, 202.22, 303.33, 404.44, 505.55, 606.66, 707.77];
export const FAKE_SECURITIES = 2831.08;
export const FAKE_CASH = 876.54;
export const FAKE_TOTAL = 3707.62;

export function syntheticStatementLines(date = '31.01.2024'): string[][] {
  const amount = (value: number) =>
    value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [
    [
      'Trade Republic Bank GmbH',
      'VERMÖGENSÜBERSICHT',
      `zum ${date}`,
      'PORTFOLIO',
      'KURSWERT IN EUR',
      `Brokerage ${amount(FAKE_SECURITIES)}`,
      `Cash ${amount(FAKE_CASH)}`,
      `GESAMT ${amount(FAKE_TOTAL)} EUR`,
      'BROKERAGE',
      'STK. / NOMINALE WERTPAPIERBEZEICHNUNG KURS PRO STÜCK KURSWERT IN EUR',
      ...FAKE_ISINS.flatMap((isin, i) => [
        `1,123456 Stk. Fictional fund ${i + 1} USD (Acc) 10,00 ${amount(FAKE_VALUES[i])}`,
        ...(i === 2 ? ['Synthetic wrapped name'] : []),
        `ISIN: ${isin}`,
      ]),
      'ANZAHL POSITIONEN: 7',
      'CASH',
      'Seite 1 von 2',
    ],
    [
      'Trade Republic Bank GmbH',
      `Aufstellung über das Cash in deinem Konto zum ${date}.`,
      'PRODUKT SALDO',
      `Cashkonto ${amount(FAKE_CASH)} EUR`,
      'Seite 2 von 2',
    ],
  ];
}

export function syntheticPages(lines = syntheticStatementLines()) {
  return lines.map((page) => ({
    items: page.map((text, i) => ({ text, x: 30, y: 800 - i * 18 })),
  }));
}

export function syntheticLargeStatementLines(count = 200): string[][] {
  const pages: string[][] = [];
  const format = (value: number) =>
    value.toLocaleString('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  for (let start = 0; start < count; start += 15) {
    const lines =
      start === 0
        ? [
            'Trade Republic Bank GmbH',
            'VERMÖGENSÜBERSICHT',
            'zum 31.01.2024',
            'KURSWERT IN EUR',
            `Brokerage ${format(count)}`,
            'Cash 10,00',
            `GESAMT ${format(count + 10)} EUR`,
          ]
        : [];
    lines.push('BROKERAGE', 'KURS PRO STÜCK KURSWERT IN EUR');
    for (let i = start; i < Math.min(start + 15, count); i++)
      lines.push(`1 Stk. Invented large fund ${i + 1} 1,00 1,00`, `ISIN: ${fakeIsin(i + 1)}`);
    pages.push(lines);
  }
  pages.push([`ANZAHL POSITIONEN: ${count}`, 'CASH', 'Cashkonto 10,00 EUR']);
  pages.forEach((lines, i) => lines.push(`Seite ${i + 1} von ${pages.length}`));
  return pages;
}

export async function syntheticPdf(lines = syntheticStatementLines()): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle('Wholly synthetic statement fixture');
  document.setAuthor('Synthetic fixture generator');
  document.setCreationDate(new Date('2024-01-01T00:00:00Z'));
  document.setModificationDate(new Date('2024-01-01T00:00:00Z'));
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const pageLines of lines) {
    const page = document.addPage([900, 850]);
    pageLines.forEach((text, i) => page.drawText(text, { x: 30, y: 800 - i * 18, size: 10, font }));
  }
  return document.save();
}
