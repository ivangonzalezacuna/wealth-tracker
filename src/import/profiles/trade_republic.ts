import { TxType } from '../../model/tx';
import type { ImportProfile } from '../../types';

/**
 * Built-in import profile for Trade Republic Transaktionsexport CSV.
 */
export const tradeRepublicProfile: ImportProfile = {
  id:    'trade_republic',
  label: 'Trade Republic',

  delimiter:       'auto',
  decimal:         'auto',
  dateFormat:      'YYYY-MM-DD',
  defaultCurrency: 'EUR',

  columns: {
    id:       'transaction_id',
    date:     'date',
    type:     'type',
    category: 'category',
    name:     'name',
    symbol:   'symbol',
    shares:   'shares',
    price:    'price',
    amount:   'amount',
    fee:      'fee',
    tax:      'tax',
    currency: 'currency',
    fxRate:   'fx_rate',
  },

  /**
   * Type mapping -- compound keys (`TYPE|CATEGORY`) are tried first,
   * then plain `TYPE`.  Matches the Phase-1 `mapTRType()` exactly.
   */
  typeMap: {
    'BUY|TRADING':   TxType.BUY,
    'SELL|TRADING':  TxType.SELL,
    'BUY':           TxType.BUY,
    'SELL':          TxType.SELL,
    'DIVIDEND':      TxType.DIVIDEND,
    'INTEREST_PAYMENT': TxType.INTEREST,
    'FEE':           TxType.FEE,
    'TAX':           TxType.TAX,
    'DEPOSIT':       TxType.DEPOSIT,
    'WITHDRAWAL':    TxType.WITHDRAWAL,
    'TRANSFER':      TxType.TRANSFER,
  },

  match: {
    headerIncludes: ['transaction_id', 'symbol', 'amount'],
  },
};
