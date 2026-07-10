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
  const intByMonth: Record<string, number> = {}; // YYYY-MM → summed net amount
  const intTaxByMonth: Record<string, number> = {}; // YYYY-MM → summed tax (negative = paid)
  const monthly: Record<string, number> = {};
  const monthlyBy: Record<string, Record<string, number>> = {};
  let totalInterest = 0;
  const interestBySource: Record<string, number> = {};
  const taxBySource: Record<string, number> = {};

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
      const intMonth = tx.date.slice(0, 7); // YYYY-MM
      intByMonth[intMonth] = (intByMonth[intMonth] || 0) + tx.amount;
      const src = tx.source || 'unknown';
      interestBySource[src] = (interestBySource[src] || 0) + tx.amount;
      // Tax withheld on savings interest (e.g. TR INTEREST_PAYMENT rows
      // carry a negative tx.tax when Kapitalertragsteuer was deducted).
      if (tx.tax) {
        taxBySource[src] = (taxBySource[src] || 0) + tx.tax;
        intTaxByMonth[intMonth] = (intTaxByMonth[intMonth] || 0) + tx.tax;
      }
    } else if (tx.type === TxType.TAX) {
      // TAX rows: refunds (e.g. TR TAX_OPTIMIZATION) or standalone tax charges.
      // For N26 with mergeTaxIntoInterest, TAX rows are already folded into INTEREST.
      const taxVal = tx.tax || tx.amount || 0;
      const src = tx.source || 'unknown';
      taxBySource[src] = (taxBySource[src] || 0) + taxVal;
    }
  }

  // Override name from holding settings (preferred over transaction-derived name)
  for (const h of getHoldings()) {
    if (h.name && etfs[h.isin]) {
      etfs[h.isin].name = h.name;
    }
  }

  divHist.sort((a, b) => b.date.localeCompare(a.date));

  // Build monthly-aggregated interest history (one entry per YYYY-MM)
  // intTaxByMonth values: negative = tax paid, positive = net refund
  const intHist: IntHistEntry[] = Object.entries(intByMonth)
    .map(([month, net]) => {
      const taxRaw = intTaxByMonth[month] || 0; // negative = paid, positive = refund
      const tax = Math.abs(taxRaw); // always positive for display (tax paid)
      // gross = interest before tax deduction. When taxRaw < 0 (paid): gross = net + |tax|.
      // When taxRaw > 0 (net refund in this month): gross < net (refund came from prior months).
      const gross = net - taxRaw;
      return { date: month, gross, tax: taxRaw < 0 ? tax : -tax, net, amount: net };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalInv = Object.values(etfs).reduce((s, e) => s + e.cost, 0);
  const totalDivNet = Object.values(etfs).reduce((s, e) => s + e.divNet, 0);
  const totalTax = Object.values(etfs).reduce((s, e) => s + e.taxPaid, 0);
  const totalFees = Object.values(etfs).reduce((s, e) => s + (e.totalFees || 0), 0);
  const realizedPnL = Object.values(etfs).reduce((s, e) => s + (e.realizedPnL || 0), 0);
  const totalIntGross = intHist.reduce((s, i) => s + i.gross, 0);
  const totalIntTax = intHist.reduce((s, i) => s + i.tax, 0);
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
    totalIntGross,
    totalIntTax,
    totalFees,
    realizedPnL,
    interestBySource,
    taxBySource,
  };
}
