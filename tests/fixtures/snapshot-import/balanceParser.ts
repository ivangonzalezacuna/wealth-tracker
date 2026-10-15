import type { SnapshotParser } from '../../../src/import/snapshotStatement';

// Test-only format: this is not a supported bank report.
export const fictionalBalanceParser: SnapshotParser = {
  id: 'fictional:savings',
  label: 'Fictional savings report',
  mapping: {
    kind: 'balances',
    slots: [{ key: 'closing', label: 'Closing balance', moneyTypes: ['cash', 'savings'] }],
  },
  matches: (pages) =>
    pages.some((page) => page.items.some((item) => item.text === 'FICTIONAL SAVINGS REPORT')),
  parse: (pages) => {
    const lines = pages.flatMap((page) => page.items.map((item) => item.text));
    const date = lines.find((line) => /^\d{4}-\d{2}-\d{2}$/.test(line));
    const balance = lines.find((line) => /^EUR \d+\.\d{2}$/.test(line));
    if (!date || !balance) throw new Error('Incomplete fictional savings report.');
    return {
      documentType: 'fictional:savings',
      date,
      currency: 'EUR',
      positions: [],
      balances: { closing: Number(balance.slice(4)) },
      warnings: [],
    };
  },
};

export const fictionalBalanceLines = ['FICTIONAL SAVINGS REPORT', '2024-01-31', 'EUR 1234.56'];
