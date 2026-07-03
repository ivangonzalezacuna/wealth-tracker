import { TxType } from '../../model/tx';
import type { ImportProfile } from '../../types';

/**
 * Built-in import profile for Trade Republic Transaktionsexport CSV.
 */
export const tradeRepublicProfile: ImportProfile = {
  id: 'trade_republic',
  label: 'Trade Republic',

  delimiter: 'auto',
  decimal: 'auto',
  dateFormat: 'YYYY-MM-DD',
  defaultCurrency: 'EUR',

  columns: {
    id: 'transaction_id',
    date: 'date',
    type: 'type',
    category: 'category',
    name: 'name',
    symbol: 'symbol',
    shares: 'shares',
    price: 'price',
    amount: 'amount',
    fee: 'fee',
    tax: 'tax',
    currency: 'currency',
    fxRate: 'fx_rate',
  },

  /** Compound keys (`TYPE|CATEGORY`) are tried first, then plain `TYPE`. */
  typeMap: {
    'BUY|TRADING': TxType.BUY,
    'SELL|TRADING': TxType.SELL,
    BUY: TxType.BUY,
    SELL: TxType.SELL,
    DIVIDEND: TxType.DIVIDEND,
    INTEREST_PAYMENT: TxType.INTEREST,
    FEE: TxType.FEE,
    CUSTOMER_INPAYMENT: TxType.DEPOSIT,
    TRANSFER_INBOUND: TxType.DEPOSIT,
    TRANSFER_INSTANT_INBOUND: TxType.DEPOSIT,
    CUSTOMER_OUTPAYMENT: TxType.WITHDRAWAL,
    TRANSFER_OUTBOUND: TxType.WITHDRAWAL,
    TAX_OPTIMIZATION: TxType.TAX,
  },

  match: {
    headerIncludes: ['transaction_id', 'symbol', 'amount'],
  },
};
