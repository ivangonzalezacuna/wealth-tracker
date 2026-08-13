import { TxType } from '../types';
import type { Transaction, CostBasisResult } from '../types';
import { ZERO_THRESHOLD } from './holdings';
import { toBase } from '../fx';

function validSplitRatio(rawRatio: number, tx: Transaction): number | null {
  const ratio = Number(rawRatio);
  if (!Number.isFinite(ratio) || ratio <= ZERO_THRESHOLD) {
    console.error(
      `[costbasis] Ignoring invalid SPLIT ratio=${rawRatio} for ${tx.isin || 'UNKNOWN'} on ${tx.date}`,
    );
    return null;
  }
  return ratio;
}

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
      const buyShares = Math.abs(tx.shares || 0);
      if (buyShares <= 0) continue;
      const cost = Math.abs(toBase(tx.amount, tx.currency, tx.fxRate)) + fee;
      shares += buyShares;
      costBasis += cost;
      buys += 1;
    } else if (tx.type === TxType.SPLIT) {
      // SPLIT: tx.shares holds the ratio (e.g. 2 for a 2:1 split).
      // Share count is multiplied by the ratio; total cost basis is unchanged.
      const ratio = validSplitRatio(tx.shares, tx);
      if (ratio !== null && shares > 0) {
        shares *= ratio;
        // costBasis stays the same; cost-per-share is implicitly reduced
      }
    } else if (tx.type === TxType.SELL) {
      const sharesSold = Math.abs(tx.shares || 0);
      if (sharesSold <= 0) continue;
      if (sharesSold > shares + ZERO_THRESHOLD) {
        throw new Error(
          `Oversell detected (${tx.isin || 'UNKNOWN'} ${tx.date}): tried to sell ${sharesSold.toFixed(8)} shares, only ${shares.toFixed(8)} available.`,
        );
      }
      if (shares <= ZERO_THRESHOLD) continue;

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
 * Lot-based cost-basis engine.
 * BUY pushes lots, SELL consumes lots according to selectLotIndex.
 */
function computeLotBased(
  txs: Transaction[],
  selectLotIndex: (lots: Lot[]) => number,
): CostBasisResult {
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
      const ratio = validSplitRatio(tx.shares, tx);
      if (ratio !== null && lots.length > 0) {
        for (const lot of lots) {
          lot.shares *= ratio;
          lot.unitCost /= ratio;
        }
      }
    } else if (tx.type === TxType.SELL) {
      let sharesSold = Math.abs(tx.shares || 0);
      if (sharesSold <= 0) continue;
      const availableShares = lots.reduce((sum, lot) => sum + lot.shares, 0);
      if (sharesSold > availableShares + ZERO_THRESHOLD) {
        throw new Error(
          `Oversell detected (${tx.isin || 'UNKNOWN'} ${tx.date}): tried to sell ${sharesSold.toFixed(8)} shares, only ${availableShares.toFixed(8)} available.`,
        );
      }

      const proceeds = Math.abs(toBase(tx.amount, tx.currency, tx.fxRate)) - fee;
      let consumedCost = 0;

      while (sharesSold > ZERO_THRESHOLD && lots.length > 0) {
        const lotIdx = Math.max(0, Math.min(selectLotIndex(lots), lots.length - 1));
        const lot = lots[lotIdx];
        if (lot.shares <= sharesSold + ZERO_THRESHOLD) {
          consumedCost += lot.shares * lot.unitCost;
          sharesSold -= lot.shares;
          lots.splice(lotIdx, 1);
        } else {
          consumedCost += sharesSold * lot.unitCost;
          lot.shares -= sharesSold;
          sharesSold = 0;
        }
      }

      realizedPnL += proceeds - consumedCost;
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
 * FIFO cost basis engine.
 * Maintains a lots queue per ISIN; BUY pushes lots, SELL consumes oldest first.
 */
function computeFIFO(txs: Transaction[]): CostBasisResult {
  return computeLotBased(txs, () => 0);
}

/**
 * LIFO cost basis engine.
 * BUY pushes lots, SELL consumes newest lots first.
 */
function computeLIFO(txs: Transaction[]): CostBasisResult {
  return computeLotBased(txs, (lots) => lots.length - 1);
}

/**
 * HIFO cost basis engine.
 * BUY pushes lots, SELL consumes highest unit-cost lots first.
 */
function computeHIFO(txs: Transaction[]): CostBasisResult {
  return computeLotBased(txs, (lots) => {
    let bestIdx = 0;
    let bestUnitCost = lots[0]?.unitCost ?? 0;
    for (let i = 1; i < lots.length; i++) {
      if (lots[i].unitCost > bestUnitCost) {
        bestUnitCost = lots[i].unitCost;
        bestIdx = i;
      }
    }
    return bestIdx;
  });
}

/**
 * Run the cost-basis engine on date-sorted canonical transactions grouped by ISIN.
 */
export function computeCostBasis(
  txs: Transaction[],
  method: 'avgco' | 'fifo' | 'lifo' | 'hifo' = 'avgco',
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

  const engine =
    method === 'fifo'
      ? computeFIFO
      : method === 'lifo'
        ? computeLIFO
        : method === 'hifo'
          ? computeHIFO
          : computeAvgCost;
  const result: Record<string, CostBasisResult> = {};
  for (const [isin, isinTxs] of Object.entries(byIsin)) {
    result[isin] = engine(isinTxs);
  }
  return result;
}

// Export for testing
export {
  computeAvgCost as _computeAvgCost,
  computeFIFO as _computeFIFO,
  computeLIFO as _computeLIFO,
  computeHIFO as _computeHIFO,
};
