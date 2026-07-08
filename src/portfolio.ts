import { getISIN, getMETAMap } from './constants';
import { getHoldings } from './store/config';
import { TxType } from './model/tx';
import { computeCostBasis } from './model/costbasis';
import type { Transaction, PortfolioData, EtfPosition, DivHistEntry, IntHistEntry } from './types';

interface ComputeOptions {
  method?: 'avgco' | 'fifo';
}

/**
 * Compute portfolio data from canonical transactions.
 */
export function computePD(rows: Transaction[], opts: ComputeOptions = {}): PortfolioData {
  const method = opts.method || 'avgco';

  // ISIN → shortName map, ISIN → { color, acc, active } metadata
  const ISIN_NAMES = getISIN() as Record<string, string>;
  const META = getMETAMap() as Record<string, { color?: string; acc?: boolean; active?: boolean }>;

  // Sort by date (stable for same-date events - preserves input order)
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  // Run cost-basis engine on BUY+SELL events
  const basisByIsin = computeCostBasis(sorted, method);

  // Build etfs map, divHist, intHist, monthly (BUYs only for DCA)
  const etfs: Record<string, EtfPosition> = {};
  const divHist: DivHistEntry[] = [];
  const intHist: IntHistEntry[] = [];
  const monthly: Record<string, number> = {};
  const monthlyBy: Record<string, Record<string, number>> = {};
  let totalInterest = 0;
  let taxRefunds = 0;

  // Ensure all ISINs from basis engine are represented
  for (const [isin, basis] of Object.entries(basisByIsin)) {
    const shortName = ISIN_NAMES[isin] || isin;
    const meta = META[isin] || {};
    etfs[isin] = {
      isin,
      shortName,
      name: '',
      color: meta.color || '#898781',
      acc: meta.acc !== false,
      active: meta.active !== false,
      cost: basis.costBasis,
      shares: basis.shares,
      divNet: 0,
      taxPaid: 0,
      buys: basis.buys,
      realizedPnL: basis.realizedPnL,
      totalFees: basis.totalFees,
      exited: basis.exited,
    };
  }

  for (const tx of sorted) {
    const isin = tx.isin || '';
    const shortName = ISIN_NAMES[isin] || isin;
    const meta = META[isin] || {};

    if (tx.type === TxType.BUY) {
      // Ensure entry exists (basis engine already created it, but fill name)
      if (etfs[isin]) {
        if (!etfs[isin].name && tx.name) etfs[isin].name = tx.name;
      }
      // DCA monthly - BUYs only. Fee is included so this figure matches
      // pd.totalInv (costbasis.ts uses |amount| + fee) - the fee is cash
      // that genuinely left the account for this purchase.
      const cost = Math.abs(tx.amount) + Math.abs(tx.fee || 0);
      const m = tx.date.slice(0, 7);
      monthly[m] = (monthly[m] || 0) + cost;
      if (!monthlyBy[m]) monthlyBy[m] = {};
      monthlyBy[m][isin] = (monthlyBy[m][isin] || 0) + cost;
    } else if (tx.type === TxType.SELL) {
      // Fill name for SELL events too
      if (etfs[isin] && !etfs[isin].name && tx.name) etfs[isin].name = tx.name;
    } else if (tx.type === TxType.DIVIDEND) {
      if (!etfs[isin]) {
        etfs[isin] = {
          isin,
          shortName,
          name: tx.name,
          color: meta.color || '#898781',
          acc: false,
          active: false,
          cost: 0,
          shares: 0,
          divNet: 0,
          taxPaid: 0,
          buys: 0,
          realizedPnL: 0,
          totalFees: 0,
          exited: false,
        };
      }
      if (!etfs[isin].name && tx.name) etfs[isin].name = tx.name;
      const taxAbs = Math.abs(tx.tax || 0);
      etfs[isin].divNet += tx.amount;
      etfs[isin].taxPaid += taxAbs;
      divHist.push({
        date: tx.date,
        isin,
        shortName: shortName || isin,
        gross: tx.amount + taxAbs,
        net: tx.amount,
        tax: taxAbs,
        color: meta.color || '#898781',
      });
    } else if (tx.type === TxType.INTEREST || tx.type === 'INTEREST_PAYMENT') {
      totalInterest += tx.amount;
      intHist.push({ date: tx.date, amount: tx.amount });
    } else if (tx.type === TxType.TAX) {
      // TAX rows: positive tax field = refund (reduces net tax); negative = additional charge.
      // Sign convention: taxPaid accumulates absolute charges; refunds subtract.
      // e.g. TAX_OPTIMIZATION with tax: +3.44 means a refund → reduces totalTax by 3.44.
      taxRefunds += tx.tax || 0;
    }
  }

  // Override name from holding settings (preferred over transaction-derived name)
  for (const h of getHoldings()) {
    if (h.name && etfs[h.isin]) {
      etfs[h.isin].name = h.name;
    }
  }

  divHist.sort((a, b) => b.date.localeCompare(a.date));
  intHist.sort((a, b) => b.date.localeCompare(a.date));

  const totalInv = Object.values(etfs).reduce((s, e) => s + e.cost, 0);
  const totalDivNet = Object.values(etfs).reduce((s, e) => s + e.divNet, 0);
  const totalTax = Object.values(etfs).reduce((s, e) => s + e.taxPaid, 0) - taxRefunds;
  const totalFees = Object.values(etfs).reduce((s, e) => s + (e.totalFees || 0), 0);
  const realizedPnL = Object.values(etfs).reduce((s, e) => s + (e.realizedPnL || 0), 0);
  const months = Object.keys(monthly).sort();

  return {
    etfs,
    divHist,
    intHist,
    monthly,
    monthlyBy,
    months,
    totalInv,
    totalDivNet,
    totalTax,
    totalInterest,
    totalFees,
    realizedPnL,
  };
}
