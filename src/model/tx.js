/**
 * Canonical transaction types and typedef.
 *
 * @readonly
 * @enum {string}
 */
export const TxType = /** @type {const} */ ({
  BUY:        'BUY',
  SELL:       'SELL',
  DIVIDEND:   'DIVIDEND',
  INTEREST:   'INTEREST',
  FEE:        'FEE',
  TAX:        'TAX',
  DEPOSIT:    'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL',
  TRANSFER:   'TRANSFER',
});

/**
 * @typedef {Object} Transaction
 * @property {string}  id
 * @property {string}  date       - ISO date string (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
 * @property {string}  source     - e.g. 'trade_republic'
 * @property {string}  type       - one of TxType values
 * @property {string}  [category] - raw source category (e.g. TR 'TRADING')
 * @property {string}  [assetClass]
 * @property {string}  [name]     - instrument name
 * @property {string}  [isin]     - ISIN identifier
 * @property {number}  [shares]   - number of shares (positive)
 * @property {number}  [price]    - price per share
 * @property {number}  amount     - signed, in account currency
 * @property {number}  [fee]      - fee amount (positive = cost)
 * @property {number}  [tax]      - tax amount (positive = cost)
 * @property {string}  currency   - account currency code (e.g. 'EUR')
 * @property {number}  [fxRate]   - FX rate if converted
 * @property {string}  [note]
 */
