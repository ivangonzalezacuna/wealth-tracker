import type { BackupFile } from '../../src/backup/exportImport';
import type { Holding, Snapshot, Transaction } from '../../src/types';

export type ReviewState = 'complete' | 'partial' | 'cost' | 'single' | 'everyday';

export function reviewBackup(state: ReviewState = 'complete'): BackupFile {
  const colors = ['#185FA5', '#0F6E56', '#BA7517', '#A32D2D'];
  const holdings: Holding[] = Array.from({ length: 14 }, (_, i) => ({
    isin: `IE00TEST${String(i).padStart(4, '0')}`,
    name: `Synthetic ${i === 0 ? 'international diversified retirement fund with a long name' : `fund ${i}`}`,
    shortName: `FUND${i}`,
    color: colors[i % colors.length],
    acc: i % 2 === 0,
    active: i < 12,
    targetPct: i < 12 ? (i === 0 ? 45 : 5) : 0,
    assetClass: 'Equity',
    region: 'Global',
    foldInto: '',
    order: i,
    ter: 0.2,
  }));
  const transactions: Transaction[] = [];
  const snapshots: Snapshot[] = [];
  for (let m = 0; m < 40; m++) {
    const date = new Date(Date.UTC(2023, m, 1)).toISOString().slice(0, 7);
    for (const [i, holding] of holdings.entries()) {
      transactions.push({
        id: `buy-${m}-${i}`,
        date: `${date}-05`,
        source: 'traderepublic',
        category: 'Savings plan',
        type: 'BUY',
        name: holding.name,
        isin: holding.isin,
        shares: 1,
        price: 100,
        amount: -100,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 1,
      });
    }
    for (const type of ['DIVIDEND', 'INTEREST'] as const) {
      transactions.push({
        id: `${type}-${m}`,
        date: `${date}-20`,
        source: 'traderepublic',
        type,
        name: type === 'DIVIDEND' ? holdings[1].name : 'Savings interest',
        isin: type === 'DIVIDEND' ? holdings[1].isin : '',
        shares: 0,
        price: 0,
        amount: 20,
        fee: 0,
        tax: 3,
        currency: 'EUR',
        fxRate: 1,
      });
    }
    const snapshot: Snapshot = {
      date,
      broker: 1600 * (m + 1),
      cash: 5000 + 100 * m,
      pension: 20000 + 200 * m,
      notes: 'Synthetic review data only',
    };
    if (state !== 'cost') {
      for (const [i, holding] of holdings.entries()) {
        if (i < 12 && (state !== 'partial' || i === 0))
          snapshot[`etf_${holding.isin}`] = (m + 1) * 110;
      }
    }
    snapshots.push(snapshot);
  }
  for (const holding of holdings.slice(12)) {
    transactions.push({
      ...transactions[0],
      id: `sell-${holding.isin}`,
      date: '2026-04-25',
      type: 'SELL',
      isin: holding.isin,
      name: holding.name,
      shares: 40,
      price: 105,
      amount: 4200,
    });
  }
  const backup: BackupFile = {
    app: 'wealth-tracker',
    schemaVersion: 4,
    exportedAt: '2026-05-01T12:00:00.000Z',
    data: {
      accounts: [
        {
          id: 'broker',
          label: 'International household investment account',
          moneyType: 'investment',
          isPrimaryInvestment: true,
          annualReturnPct: 5,
          color: colors[0],
          group: 'Investments',
        },
        {
          id: 'cash',
          label: 'Everyday savings and emergency buffer',
          moneyType: 'cash',
          annualReturnPct: 2,
          color: colors[1],
          group: 'Savings',
        },
        {
          id: 'pension',
          label: 'Locked workplace retirement pension',
          moneyType: 'pension',
          annualReturnPct: 4,
          locked: true,
          lockedUntil: '2055',
          color: colors[2],
          group: 'Retirement',
        },
      ],
      holdings,
      settings: {
        monthly_contrib_budget: '600',
        contribution_interval: 'monthly',
        calibration_interval: 'monthly',
        fx_integration_enabled: '0',
        goals: JSON.stringify([
          {
            label: 'Household financial independence',
            targetNetWorth: '500000',
            targetDate: '2040-06',
            milestones: [{ label: 'First milestone', targetAmount: '150000' }],
          },
          { label: 'Emergency buffer', targetNetWorth: '200000', targetDate: '2035-06' },
        ]),
      },
      snapshots: state === 'single' ? snapshots.slice(-1) : snapshots,
      transactions,
      importMeta: {},
      fxRates: [],
    },
  };
  if (state === 'everyday') {
    backup.data.holdings = holdings.slice(0, 3).map((holding, i) => ({
      ...holding,
      targetPct: i === 0 ? 60 : 20,
    }));
    const isins = new Set(backup.data.holdings.map((holding) => holding.isin));
    backup.data.transactions = transactions.filter((tx) => !tx.isin || isins.has(tx.isin));
    for (const snapshot of backup.data.snapshots) {
      for (const key of Object.keys(snapshot)) {
        if (key.startsWith('etf_') && !isins.has(key.slice(4))) delete snapshot[key];
      }
      snapshot.broker = Number(snapshot.etf_IE00TEST0000) * 3 + 500;
    }
  }
  return backup;
}
