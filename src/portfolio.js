import { getISIN, getMETAMap } from './constants.js';
import { TxType } from './model/tx.js';
import { computeCostBasis } from './model/costbasis.js';

/**
 * Compute portfolio data from canonical transactions.
 *
 * @param {import('./model/tx.js').Transaction[]} rows - transactions (need not be pre-sorted)
 * @param {{ method?: 'avgco' | 'fifo' }} [opts]
 */
export function computePD(rows, opts = {}) {
  const method = opts.method || 'avgco';

  const ISIN = getISIN();
  const META = getMETAMap();

  // Sort by date (stable for same-date events — preserves input order)
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  // Run cost-basis engine on BUY+SELL events
  const basisByIsin = computeCostBasis(sorted, method);

  // Build etfs map, divHist, intHist, monthly (BUYs only for DCA)
  const etfs      = {};
  const divHist   = [];
  const intHist   = [];
  const monthly   = {};
  const monthlyBy = {};
  let totalInterest = 0;

  // Ensure all ISINs from basis engine are represented
  for (const [sym, basis] of Object.entries(basisByIsin)) {
    const ticker = ISIN[sym] || '';
    const meta   = META[ticker] || {};
    etfs[sym] = {
      symbol:      sym,
      ticker:      ticker || sym.slice(-4),
      name:        '',
      color:       meta.color || '#898781',
      acc:         meta.acc !== false,
      active:      meta.active !== false,
      cost:        basis.costBasis,
      shares:      basis.shares,
      divNet:      0,
      taxPaid:     0,
      buys:        basis.buys,
      realizedPnL: basis.realizedPnL,
      totalFees:   basis.totalFees,
      exited:      basis.exited,
    };
  }

  for (const tx of sorted) {
    const sym    = tx.symbol || tx.isin || '';
    const ticker = ISIN[sym] || '';
    const meta   = META[ticker] || {};

    if (tx.type === TxType.BUY) {
      // Ensure entry exists (basis engine already created it, but fill name)
      if (etfs[sym]) {
        if (!etfs[sym].name && tx.name) etfs[sym].name = tx.name;
      }
      // DCA monthly — BUYs only
      const cost = Math.abs(tx.amount);
      const m = tx.date.slice(0, 7);
      monthly[m]   = (monthly[m] || 0) + cost;
      if (!monthlyBy[m]) monthlyBy[m] = {};
      monthlyBy[m][sym] = (monthlyBy[m][sym] || 0) + cost;

    } else if (tx.type === TxType.SELL) {
      // Fill name for SELL events too
      if (etfs[sym] && !etfs[sym].name && tx.name) etfs[sym].name = tx.name;

    } else if (tx.type === TxType.DIVIDEND) {
      if (!etfs[sym]) {
        etfs[sym] = {
          symbol: sym, ticker, name: tx.name,
          color: meta.color || '#898781',
          acc: false, active: false,
          cost: 0, shares: 0, divNet: 0, taxPaid: 0, buys: 0,
          realizedPnL: 0, totalFees: 0, exited: false,
        };
      }
      if (!etfs[sym].name && tx.name) etfs[sym].name = tx.name;
      const taxAbs = Math.abs(tx.tax || 0);
      etfs[sym].divNet  += tx.amount;
      etfs[sym].taxPaid += taxAbs;
      divHist.push({
        date: tx.date, ticker: ticker || sym, name: tx.name,
        gross: tx.amount + taxAbs, net: tx.amount, tax: taxAbs,
        color: meta.color || '#898781',
      });

    } else if (tx.type === TxType.INTEREST || tx.type === 'INTEREST_PAYMENT') {
      totalInterest += tx.amount;
      intHist.push({ date: tx.date, amount: tx.amount });
    }
  }

  divHist.sort((a, b) => b.date.localeCompare(a.date));
  intHist.sort((a, b) => b.date.localeCompare(a.date));

  const totalInv      = Object.values(etfs).reduce((s, e) => s + e.cost, 0);
  const totalDivNet   = Object.values(etfs).reduce((s, e) => s + e.divNet, 0);
  const totalTax      = Object.values(etfs).reduce((s, e) => s + e.taxPaid, 0);
  const totalFees     = Object.values(etfs).reduce((s, e) => s + (e.totalFees || 0), 0);
  const realizedPnL   = Object.values(etfs).reduce((s, e) => s + (e.realizedPnL || 0), 0);
  const months        = Object.keys(monthly).sort();

  return { etfs, divHist, intHist, monthly, monthlyBy, months,
           totalInv, totalDivNet, totalTax, totalInterest,
           totalFees, realizedPnL };
}
