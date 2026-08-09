import { TxType } from './tx';
import type { Transaction, CostBasisResult } from '../types';
import { ZERO_THRESHOLD } from './holdings';
import { toBase } from '../fx';

/**
 * Average-cost basis engine.
 * Processes date-sorted canonical transactions for a single ISIN.
 */
function computeAvgCost(txs: Transaction[]): CostBasisResult {
  let shares = 0;
  let costBasis = 0;
  let realizedPnL = 0;
  let buys = 0;
  let totalFees = 0;

  for (const tx of txs) {
    const fee = Math.abs(toBase(tx.fee || 0, tx.currency, tx.fxRate));
    totalFees += fee;

    if (tx.type === TxType.BUY) {
      const cost = Math.abs(toBase(tx.amount, tx.currency, tx.fxRate)) + fee;
      shares += Math.abs(tx.shares || 0);
      costBasis += cost;
      buys += 1;
    } else if (tx.type === TxType.SPLIT) {
      // SPLIT: tx.shares holds the ratio (e.g. 2 for a 2:1 split).
      // Share count is multiplied by the ratio; total cost basis is unchanged.
      const ratio = Math.abs(tx.shares || 0);
      if (ratio > 0 && shares > 0) {
        shares *= ratio;
        // costBasis stays the same; cost-per-share is implicitly reduced
      }
    } else if (tx.type === TxType.SELL) {
      const sharesSold = Math.abs(tx.shares || 0);
      if (shares <= ZERO_THRESHOLD || sharesSold <= 0) continue;

      const avg = costBasis / shares;
      const soldCost = avg * sharesSold;
      const proceeds = Math.abs(toBase(tx.amount, tx.currency, tx.fxRate)) - fee;
      realizedPnL += proceeds - soldCost;
      shares -= sharesSold;
      costBasis -= soldCost;

      // Clamp to avoid floating-point negative
      if (shares < ZERO_THRESHOLD) {
        shares = 0;
        costBasis = 0;
      }
      if (costBasis < 0) costBasis = 0;
    }
  }

  const exited = shares < ZERO_THRESHOLD;
  if (exited) {
    shares = 0;
    costBasis = 0;
  }

  return { shares, costBasis, realizedPnL, exited, buys, totalFees };
}

interface Lot {
  shares: number;
  unitCost: number;
}

/**
 * FIFO cost basis engine.
 * Maintains a lots queue per ISIN; BUY pushes lots, SELL consumes oldest first.
 */
function computeFIFO(txs: Transaction[]): CostBasisResult {
  const lots: Lot[] = [];
  let realizedPnL = 0;
  let buys = 0;
  let totalFees = 0;

  for (const tx of txs) {
    const fee = Math.abs(toBase(tx.fee || 0, tx.currency, tx.fxRate));
    totalFees += fee;

    if (tx.type === TxType.BUY) {
      const s = Math.abs(tx.shares || 0);
      if (s <= 0) continue;
      const cost = Math.abs(toBase(tx.amount, tx.currency, tx.fxRate)) + fee;
      lots.push({ shares: s, unitCost: cost / s });
      buys += 1;
    } else if (tx.type === TxType.SPLIT) {
      // SPLIT: tx.shares holds the ratio. Multiply each lot's shares by ratio,
      // divide unitCost by ratio so total cost basis stays the same.
      const ratio = Math.abs(tx.shares || 0);
      if (ratio > 0 && lots.length > 0) {
        for (const lot of lots) {
          lot.shares *= ratio;
          lot.unitCost /= ratio;
        }
      }
    } else if (tx.type === TxType.SELL) {
      let sharesSold = Math.abs(tx.shares || 0);
      if (sharesSold <= 0) continue;

      const proceeds = Math.abs(toBase(tx.amount, tx.currency, tx.fxRate)) - fee;
      let consumedCost = 0;
      const totalSharesSold = sharesSold;

      while (sharesSold > ZERO_THRESHOLD && lots.length > 0) {
        const lot = lots[0];
        if (lot.shares <= sharesSold + ZERO_THRESHOLD) {
          consumedCost += lot.shares * lot.unitCost;
          sharesSold -= lot.shares;
          lots.shift();
        } else {
          consumedCost += sharesSold * lot.unitCost;
          lot.shares -= sharesSold;
          sharesSold = 0;
        }
      }

      // Proportional proceeds if we couldn't sell all (defensive)
      const effectiveProceeds =
        totalSharesSold > ZERO_THRESHOLD
          ? proceeds * ((totalSharesSold - Math.max(sharesSold, 0)) / totalSharesSold)
          : 0;
      realizedPnL += effectiveProceeds - consumedCost;
    }
  }

  let shares = lots.reduce((s, l) => s + l.shares, 0);
  let costBasis = lots.reduce((s, l) => s + l.shares * l.unitCost, 0);

  const exited = shares < ZERO_THRESHOLD;
  if (exited) {
    shares = 0;
    costBasis = 0;
  }

  return { shares, costBasis, realizedPnL, exited, buys, totalFees };
}

/**
 * Run the cost-basis engine on date-sorted canonical transactions grouped by ISIN.
 */
export function computeCostBasis(
  txs: Transaction[],
  method: 'avgco' | 'fifo' = 'avgco',
): Record<string, CostBasisResult> {
  // Group transactions by ISIN
  const byIsin: Record<string, Transaction[]> = {};
  for (const tx of txs) {
    if (tx.type !== TxType.BUY && tx.type !== TxType.SELL && tx.type !== TxType.SPLIT) continue;
    const key = tx.isin || '';
    if (!key) continue;
    if (!byIsin[key]) byIsin[key] = [];
    byIsin[key].push(tx);
  }

  const engine = method === 'fifo' ? computeFIFO : computeAvgCost;
  const result: Record<string, CostBasisResult> = {};
  for (const [isin, isinTxs] of Object.entries(byIsin)) {
    result[isin] = engine(isinTxs);
  }
  return result;
}

// Export for testing
export { computeAvgCost as _computeAvgCost, computeFIFO as _computeFIFO };
