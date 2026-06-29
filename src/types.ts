// ─── Canonical transaction types ───────────────────────────────────

export const TxType = {
  BUY: 'BUY',
  SELL: 'SELL',
  DIVIDEND: 'DIVIDEND',
  INTEREST: 'INTEREST',
  FEE: 'FEE',
  TAX: 'TAX',
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL',
  TRANSFER: 'TRANSFER',
} as const;

export type TxTypeValue = (typeof TxType)[keyof typeof TxType];

// ─── Transaction ─────────────────────────────────────────────────

export interface Transaction {
  id: string;
  date: string;
  source: string;
  category?: string;
  type: string;
  name: string;
  isin: string;
  symbol: string;
  shares: number;
  price: number;
  amount: number;
  fee: number;
  tax: number;
  currency: string;
  fxRate: number;
  note?: string;
}

// ─── Account ─────────────────────────────────────────────────────

export interface Account {
  id?: string;
  key?: string;
  label: string;
  moneyType?: string;
  institution?: string;
  color?: string;
  isPrimaryInvestment?: boolean;
  order?: number;
}

// ─── Contribution cadence ────────────────────────────────────────

export type ContribInterval = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

// ─── Holding ─────────────────────────────────────────────────────

export interface Holding {
  isin: string;
  ticker: string;
  name: string;
  color: string;
  acc: boolean;
  active: boolean;
  contribAmount: number;   // amount per execution
  interval: ContribInterval; // execution cadence
  assetClass: string;
  region: string;
  foldInto: string;
  order: number;
}

// ─── Snapshot ────────────────────────────────────────────────────

export interface Snapshot {
  date: string;
  notes?: string;
  [accountKey: string]: number | string | undefined;
}

// ─── Settings ────────────────────────────────────────────────────

export interface Settings {
  costBasisMethod?: string;
  annualReturnPct?: string;
  [key: string]: string | null | undefined;
}

// ─── Import profile ──────────────────────────────────────────────

export interface ImportProfileColumns {
  id?: string | number;
  date: string | number;
  type: string | number;
  category?: string | number;
  name?: string | number;
  symbol?: string | number;
  shares?: string | number;
  price?: string | number;
  amount: string | number;
  fee?: string | number;
  tax?: string | number;
  currency?: string | number;
  fxRate?: string | number;
  [key: string]: string | number | undefined;
}

export interface ImportProfileMatch {
  headerIncludes: string[];
}

export type DecimalMode = 'auto' | 'comma' | 'dot';
export type DateFormat = 'YYYY-MM-DD' | 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY';

export interface ImportProfile {
  id: string;
  label: string;
  delimiter?: string;
  decimal: DecimalMode;
  dateFormat: DateFormat;
  defaultCurrency: string;
  columns: ImportProfileColumns;
  typeMap: Record<string, string>;
  match?: ImportProfileMatch;
}

// ─── Cost-basis result (per-ISIN) ────────────────────────────────

export interface CostBasisResult {
  shares: number;
  costBasis: number;
  realizedPnL: number;
  totalFees: number;
  buys: number;
  exited: boolean;
}

// ─── ETF holding in portfolio data ──────────────────────────────

export interface EtfPosition {
  symbol: string;
  ticker: string;
  name: string;
  color: string;
  acc: boolean;
  active: boolean;
  shares: number;
  cost: number;
  divNet: number;
  taxPaid: number;
  buys: number;
  realizedPnL: number;
  totalFees: number;
  exited: boolean;
  costBasis?: number;
  divTax?: number;
}

// ─── Dividend history entry ──────────────────────────────────────

export interface DivHistEntry {
  date: string;
  ticker: string;
  color: string;
  gross: number;
  tax: number;
  net: number;
}

// ─── Interest history entry ──────────────────────────────────────

export interface IntHistEntry {
  date: string;
  amount: number;
}

// ─── Portfolio data (output of computePD) ────────────────────────

export interface PortfolioData {
  etfs: Record<string, EtfPosition>;
  divHist: DivHistEntry[];
  intHist: IntHistEntry[];
  monthly: Record<string, number>;
  monthlyBy: Record<string, Record<string, number>>;
  months: string[];
  totalInv: number;
  totalDivNet: number;
  totalTax: number;
  totalFees: number;
  totalInterest: number;
  realizedPnL: number;
}

// ─── Parse result ────────────────────────────────────────────────

export interface UnmappedType {
  type: string;
  count: number;
  example?: string;
}

export interface ParseResult {
  transactions: Transaction[];
  unmapped: UnmappedType[];
}

export interface PreviewSummary {
  total: number;
  byCounts: Record<string, number>;
  sample: Transaction[];
  unmapped: UnmappedType[];
}
