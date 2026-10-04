import type { StatementLine } from '../../../src/import/pdfStatement';

// Independently authored two-page A4 report. All names, identifiers and balances
// are synthetic, not copied from a customer's statement.
export function realisticStatementFixture(): StatementLine[] {
  const rows: [number, number, [number, string][]][] = [
    [
      1,
      795,
      [
        [30, 'TRADE'],
        [66, 'REPUBLIC'],
      ],
    ],
    [
      1,
      770,
      [
        [30, 'Synthetic Person'],
        [350, 'DATUM 01.10.2026'],
      ],
    ],
    [
      1,
      757,
      [
        [30, 'Example Street 1'],
        [350, 'DEPOT SYNTHETIC-PRIVATE'],
      ],
    ],
    [1, 735, [[30, 'VERMÖGENSÜBERSICHT']]],
    [1, 718, [[30, 'zum 30.09.2026']]],
    [
      1,
      686,
      [
        [30, 'PORTFOLIO'],
        [480, 'KURSWERT IN EUR'],
      ],
    ],
    [
      1,
      665,
      [
        [30, 'Brokerage'],
        [523, '1.234,56'],
      ],
    ],
    [
      1,
      645,
      [
        [30, 'Cash'],
        [530, '100,00'],
      ],
    ],
    [
      1,
      625,
      [
        [30, 'GESAMT'],
        [504, '1.334,56 EUR'],
      ],
    ],
    [1, 590, [[30, 'BROKERAGE']]],
    [
      1,
      572,
      [[30, 'Aufstellung über die Brokerage Wertpapiere in Deinem Depot SYNTHETIC-PRIVATE']],
    ],
    [1, 560, [[30, 'zum 30.09.2026.']]],
    [
      1,
      535,
      [
        [30, 'STK./NOMINALE'],
        [145, 'WERTPAPIERBEZEICHNUNG'],
        [335, 'KURS PRO'],
        [480, 'KURSWERT IN'],
      ],
    ],
    [
      1,
      523,
      [
        [335, 'STÜCK'],
        [480, 'EUR'],
      ],
    ],
    [
      1,
      505,
      [
        [30, '12,345678 Stk.'],
        [145, 'Synthetic Global Equity USD (Acc)'],
        [335, '19,00'],
        [460, '234,56'],
      ],
    ],
    [
      1,
      493,
      [
        [145, 'ISIN: DE0000000016'],
        [335, '30.09.2026'],
      ],
    ],
    [1, 481, [[145, 'Registered synthetic fund, Irland']]],
    [1, 469, [[145, 'Investment company, accumulating']]],
    [
      1,
      449,
      [
        [30, '5 Stk.'],
        [145, 'Synthetic European Equity EUR (Acc)'],
        [335, '20,00'],
        [460, '100,00'],
      ],
    ],
    [
      1,
      437,
      [
        [145, 'ISIN: DE0000000024'],
        [335, '30.09.2026'],
      ],
    ],
    [1, 425, [[145, 'Registered synthetic fund, Luxemburg']]],
    [1, 413, [[145, 'Investment company, accumulating']]],
    [
      1,
      393,
      [
        [30, '7,5 Stk.'],
        [145, 'Synthetic Technology USD (Acc)'],
        [335, '20,00'],
        [460, '150,00'],
      ],
    ],
    [
      1,
      381,
      [
        [145, 'ISIN: DE0000000032'],
        [335, '30.09.2026'],
      ],
    ],
    [1, 369, [[145, 'Registered synthetic fund, Irland']]],
    [1, 357, [[145, 'Investment company, accumulating']]],
    [
      1,
      337,
      [
        [30, '7 Stk.'],
        [145, 'Synthetic Bonds EUR (Acc)'],
        [335, '25,00'],
        [460, '175,00'],
      ],
    ],
    [
      1,
      325,
      [
        [145, 'ISIN: DE0000000040'],
        [335, '30.09.2026'],
      ],
    ],
    [1, 313, [[145, 'Registered synthetic fund, Luxemburg']]],
    [1, 301, [[145, 'Investment company, accumulating']]],
    [
      1,
      281,
      [
        [30, '8 Stk.'],
        [145, 'Synthetic Small Companies USD (Acc)'],
        [335, '25,00'],
        [460, '200,00'],
      ],
    ],
    [
      1,
      269,
      [
        [145, 'ISIN: DE0000000057'],
        [335, '30.09.2026'],
      ],
    ],
    [1, 257, [[145, 'Registered synthetic fund, Irland']]],
    [1, 245, [[145, 'Investment company, accumulating']]],
    [
      1,
      225,
      [
        [30, '5 Stk.'],
        [145, 'Synthetic Infrastructure EUR (Acc)'],
        [335, '25,00'],
        [460, '125,00'],
      ],
    ],
    [
      1,
      213,
      [
        [145, 'ISIN: DE0000000065'],
        [335, '30.09.2026'],
      ],
    ],
    [1, 201, [[145, 'Registered synthetic fund, Luxemburg']]],
    [1, 189, [[145, 'Investment company, accumulating']]],
    [
      1,
      169,
      [
        [30, '10 Stk.'],
        [145, 'Synthetic Emerging Markets USD (Acc)'],
        [335, '25,00'],
        [460, '250,00'],
      ],
    ],
    [
      1,
      157,
      [
        [145, 'ISIN: DE0000000073'],
        [335, '30.09.2026'],
      ],
    ],
    [1, 145, [[145, 'Registered synthetic fund, Irland']]],
    [1, 133, [[145, 'Investment company, accumulating']]],
    [
      1,
      111,
      [
        [145, 'ANZAHL POSITIONEN: 7'],
        [434, '1.234,56 EUR'],
      ],
    ],
    [1, 80, [[30, 'CASH']]],
    [
      1,
      30,
      [
        [30, 'Erstellt am 01.10.2026, 08:15:00'],
        [480, 'Seite 1 von 2'],
      ],
    ],
    [
      2,
      795,
      [
        [30, 'TRADE'],
        [66, 'REPUBLIC'],
      ],
    ],
    [2, 770, [[30, 'Synthetic Person']]],
    [2, 757, [[30, 'Example Street 1']]],
    [2, 718, [[30, 'Aufstellung über das Cash in deinem Konto zum 30.09.2026.']]],
    [
      2,
      685,
      [
        [30, 'PRODUKT'],
        [480, 'SALDO'],
      ],
    ],
    [
      2,
      665,
      [
        [30, 'Cashkonto'],
        [510, '100,00 EUR'],
      ],
    ],
    [
      2,
      30,
      [
        [30, 'Erstellt am 01.10.2026, 08:15:00'],
        [480, 'Seite 2 von 2'],
      ],
    ],
  ];
  return rows.map(([page, y, cells]) => ({
    page,
    y,
    cells: cells.map(([x, text]) => ({ x, text })),
  }));
}

// Preserve the small fixture API used by existing reader and workflow tests.
export function statementFixture(): StatementLine[] {
  const rows: [number, [number, string][]][] = [
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
        [200, 'ANZAHL POSITIONEN: 1'],
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
  return rows.map(([page, cells], i) => ({
    page,
    y: 800 - i * 25,
    cells: cells.map(([x, text]) => ({ x, text })),
  }));
}

export function syntheticPdf(lines = statementFixture()): Uint8Array {
  const escaped = (s: string) => s.replace(/[\\()]/g, '\\$&');
  const scaleX = lines.some((l) => l.cells.some((c) => c.x > 595)) ? 0.75 : 1;
  // Alternate metrically compatible fonts between glyphs. PDF.js must extract
  // real fragments with font-measured advances, not reuse our authored cells.
  const stream = (page: number) =>
    '0 0 0 rg 30 809 10 10 re f\n' +
    lines
      .filter((l) => l.page === page)
      .flatMap((l) =>
        l.cells.map((c) => {
          const glyphs = [...c.text];
          return `BT /F1 7 Tf 1 0 0 1 ${c.x * scaleX} ${l.y} Tm ${glyphs
            .map((glyph, i) => `/F${1 + (i % 2)} 7 Tf (${escaped(glyph)}) Tj`)
            .join(' ')} ET`;
        }),
      )
      .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream(1).length} >>\nstream\n${stream(1)}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${stream(2).length} >>\nstream\n${stream(2)}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>',
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
