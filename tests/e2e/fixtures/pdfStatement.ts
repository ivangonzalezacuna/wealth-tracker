import type { StatementLine } from '../../../src/import/pdfStatement';

// Entirely synthetic balances, names and identifiers; no user document data.
export function statementFixture(): StatementLine[] {
  const pages: [number, [number, string][]][] = [
    [1, [[50, 'TRADE REPUBLIC']]],
    [1, [[50, 'DATUM 01.10.2026 DEPOT SYNTHETIC-PRIVATE']]],
    [1, [[50, 'VERMÖGENSÜBERSICHT']]],
    [1, [[50, 'zum 30.09.2026']]],
    [
      1,
      [
        [50, 'PORTFOLIO'],
        [650, 'KURSWERT IN EUR'],
      ],
    ],
    [
      1,
      [
        [50, 'Brokerage'],
        [650, '1.234,56'],
      ],
    ],
    [
      1,
      [
        [50, 'Cash'],
        [650, '100,00'],
      ],
    ],
    [
      1,
      [
        [50, 'GESAMT'],
        [650, '1.334,56 EUR'],
      ],
    ],
    [1, [[50, 'BROKERAGE']]],
    [
      1,
      [
        [
          50,
          'Aufstellung über die Brokerage Wertpapiere in Deinem Depot SYNTHETIC-PRIVATE zum 30.09.2026.',
        ],
      ],
    ],
    [
      1,
      [
        [50, 'STK. / NOMINALE'],
        [200, 'WERTPAPIERBEZEICHNUNG'],
        [450, 'KURS PRO STÜCK'],
        [650, 'KURSWERT IN EUR'],
      ],
    ],
    [
      1,
      [
        [50, '10'],
        [200, 'Synthetic fund'],
        [450, '123,45'],
        [650, '1.234,56'],
      ],
    ],
    [1, [[200, 'ISIN: DE0000000016']]],
    [
      1,
      [
        [200, 'Irland'],
        [450, '30.09.2026'],
      ],
    ],
    [
      1,
      [
        [50, 'ANZAHL POSITIONEN: 1'],
        [650, '1.234,56 EUR'],
      ],
    ],
    [1, [[50, 'CASH']]],
    [1, [[50, 'Seite 1 von 2']]],
    [2, [[50, 'TRADE REPUBLIC']]],
    [2, [[50, 'Aufstellung über das Cash in Deinem Konto zum 30.09.2026.']]],
    [
      2,
      [
        [50, 'PRODUKT'],
        [650, 'SALDO'],
      ],
    ],
    [
      2,
      [
        [50, 'Cashkonto'],
        [650, '100,00 EUR'],
      ],
    ],
    [2, [[50, 'Seite 2 von 2']]],
  ];
  return pages.map(([page, cells], i) => ({
    page,
    y: 800 - i * 25,
    cells: cells.map(([x, text]) => ({ x, text })),
  }));
}

export function syntheticPdf(lines = statementFixture()): Uint8Array {
  const escaped = (s: string) => s.replace(/[\\()]/g, '\\$&');
  const stream = (page: number) =>
    lines
      .filter((l) => l.page === page)
      .flatMap((l) =>
        l.cells.map((c) => `BT /F1 8 Tf 1 0 0 1 ${c.x} ${l.y} Tm (${escaped(c.text)}) Tj ET`),
      )
      .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 840 900] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream(1).length} >>\nstream\n${stream(1)}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 840 900] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${stream(2).length} >>\nstream\n${stream(2)}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(pdf, (c) => c.charCodeAt(0));
}
