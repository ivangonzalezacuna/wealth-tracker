import type { BackupFile } from '../../../src/backup/exportImport';
import type { Holding, Snapshot, Transaction } from '../../../src/types';

/** 30 months (2023-01 → 2025-06) of snapshots and savings-plan buys for chart interaction tests. */
export function chartBackup(): BackupFile {
  const holdings: Holding[] = ['ALPHA', 'BETA'].map((shortName, i) => ({
    isin: `IE00CHART00${i}`,
    name: `Chart fund ${shortName}`,
    shortName,
    color: i ? '#0F6E56' : '#185FA5',
    acc: true,
    active: true,
    targetPct: 50,
    assetClass: 'Equity',
    region: 'Global',
    foldInto: '',
    order: i,
    ter: 0.2,
  }));
  const snapshots: Snapshot[] = [];
  const transactions: Transaction[] = [];
  for (let m = 0; m < 30; m++) {
    const date = new Date(Date.UTC(2023, m, 1)).toISOString().slice(0, 7);
    for (const [i, h] of holdings.entries()) {
      transactions.push({
        id: `buy-${m}-${i}`,
        date: `${date}-05`,
        source: 'traderepublic',
        type: 'BUY',
        name: h.name,
        isin: h.isin,
        shares: 1,
        price: 100 * (i + 1),
        amount: -100 * (i + 1),
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 1,
      });
    }
    transactions.push({
      id: `div-${m}`,
      date: `${date}-20`,
      source: 'traderepublic',
      type: 'DIVIDEND',
      name: holdings[0].name,
      isin: holdings[0].isin,
      shares: 0,
      price: 0,
      amount: 10,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 1,
    });
    snapshots.push({
      date,
      broker: 320 * (m + 1),
      cash: 4000 + 50 * m,
      [`etf_${holdings[0].isin}`]: 110 * (m + 1),
      [`etf_${holdings[1].isin}`]: 210 * (m + 1),
    });
  }
  return {
    app: 'wealth-tracker',
    schemaVersion: 4,
    exportedAt: '2025-07-01T12:00:00.000Z',
    data: {
      accounts: [
        {
          id: 'broker',
          label: 'Broker',
          moneyType: 'investment',
          isPrimaryInvestment: true,
          annualReturnPct: 5,
          color: '#185FA5',
          group: 'Investments',
        },
        {
          id: 'cash',
          label: 'Savings',
          moneyType: 'cash',
          annualReturnPct: 2,
          color: '#0F6E56',
          group: 'Savings',
        },
      ],
      holdings,
      settings: { fx_integration_enabled: '0' },
      snapshots,
      transactions,
      importMeta: {},
      fxRates: [],
    },
  };
}
