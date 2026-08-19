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
  SPLIT: 'SPLIT',
} as const;

export type TxTypeValue = (typeof TxType)[keyof typeof TxType];

// ─── Transaction ─────────────────────────────────────────────────

export interface Transaction {
  rowId?: bigint;
  id: string;
  date: string;
  source: string;
  category?: string;
  type: TxTypeValue;
  name: string;
  isin: string;
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
  country?: string;
  group?: string;
  color?: string;
  isPrimaryInvestment?: boolean;
  order?: number;
  annualReturnPct?: number; // per-account forecast growth assumption, default 0
  contribAmount?: number; // recurring contribution amount per execution, default 0
  contribInterval?: ContribInterval; // default 'monthly'; ignored for the primary investment account
  locked?: boolean; // true = funds not accessible until retirement (pension, AVD)
  lockedUntil?: string; // year when funds become accessible, e.g. "2055"
  extraContrib?: number; // additional contribution per execution (employer match, state subsidy, etc.)
  currency?: string; // account denomination currency, e.g. "USD"; defaults to "EUR"
}

// ─── Contribution cadence ────────────────────────────────────────

export type ContribInterval = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

// ─── Holding ─────────────────────────────────────────────────────

export interface Holding {
  isin: string;
  name: string;
  shortName: string; // max 10 chars, used in charts/legends
  color: string;
  acc: boolean;
  active: boolean;
  targetPct?: number; // strategic allocation target in %, optional
  assetClass: string;
  region: string;
  foldInto: string;
  order: number;
  ter?: number; // total expense ratio in %, e.g. 0.2 for 0.20%
  notes?: string; // optional free-text notes about this holding
}

// ─── Snapshot ────────────────────────────────────────────────────

export interface Snapshot {
  date: string;
  notes?: string;
  [accountKey: string]: number | string | undefined;
}

// ─── Settings ────────────────────────────────────────────────────

export interface Settings {
  /** Cost-basis calculation method. */
  costBasisMethod?: 'avgco' | 'fifo' | 'lifo' | 'hifo';
  /** Legacy global annual return % (numeric string); migrated to per-account annualReturnPct on load. */
  annualReturnPct?: string;
  /** Global contribution cadence (snake_case key used in the DB). */
  contribution_interval?: ContribInterval;
  /** Rebalance-plan display cadence (snake_case key used in the DB). */
  calibration_interval?: ContribInterval;
  /** Global contribution budget in EUR per interval (snake_case key used in the DB). */
  monthly_contrib_budget?: string;
  /** Legacy single-goal target net worth (numeric string). */
  targetNetWorth?: string;
  /** Legacy single-goal target date (YYYY-MM string). */
  targetDate?: string;
  /** JSON-serialised NamedGoal[]. */
  goals?: string;
  /** JSON-serialised AlertSettings. */
  alerts?: string;
  /** JSON-serialised string[] of retired account IDs. */
  retired_account_ids?: string;
  /** When '0', the Frankfurter FX integration is disabled app-wide; all other values (including absent) mean enabled. */
  fx_integration_enabled?: string;
  /** Forward-compatible escape hatch for unknown / future keys. */
  [key: string]: string | null | undefined;
}

export interface GoalMilestone {
  label?: string;
  targetAmount: string;
  targetDate?: string;
}

export interface NamedGoal {
  label: string;
  targetNetWorth: string;
  targetDate: string;
  milestones?: GoalMilestone[];
}

// ─── FX Rate Cache ────────────────────────────────────────────────

/**
 * A cached FX rate record returned by the Frankfurter service.
 *
 * `date` is the requested lookup date (YYYY-MM-DD).
 * `effectiveDate` is the provider's actual date, which may differ from
 * `date` when the requested date falls on a weekend or public holiday
 * (Frankfurter returns the prior business day's rate in that case).
 */
export interface FxRateRecord {
  base: string;
  target: string;
  date: string;
  rate: number;
  effectiveDate: string;
  fetchedAt: string;
}

// ─── FX Integration Telemetry ─────────────────────────────────────

/**
 * Lightweight operational status for the Frankfurter FX integration.
 * Stored as a single row in the `fx_telemetry` table (id=1).
 */
export interface FxTelemetry {
  /** ISO timestamp of the last successful live fetch from Frankfurter, or '' if none yet. */
  lastFetchAt: string;
  /** URL of the last attempted live request to Frankfurter, or '' if none yet. */
  lastRequestUrl: string;
  /** ISO timestamp of the last provider/network error, or '' if none yet. */
  lastErrorAt: string;
  /** Message of the last error, or '' if none yet. */
  lastError: string;
  /** Total number of live fetches performed (cache misses that reached the provider). */
  fetchCount: number;
  /** Total number of cache hits served without a live fetch. */
  cacheHitCount: number;
  /** Total number of month-end prefetch requests attempted for non-base currencies. */
  prefetchAttemptCount: number;
  /** Total number of month-end prefetch lookups that resolved a rate. */
  prefetchSuccessCount: number;
  /** Total number of month-end prefetch lookups that returned no rate. */
  prefetchFailureCount: number;
  /** Total number of snapshot normalization rate lookups attempted. */
  normalizeAttemptCount: number;
  /** Total number of snapshot normalization rate lookups that resolved a rate. */
  normalizeSuccessCount: number;
  /** Total number of snapshot normalization rate lookups that returned no rate. */
  normalizeFailureCount: number;
}

/**
 * Per-month operational counters for the Frankfurter FX integration.
 * Stored in `fx_telemetry_monthly`, one row per YYYY-MM.
 */
export interface FxTelemetryMonthly {
  /** Calendar month in YYYY-MM format. */
  month: string;
  /** Live network fetches performed this month. */
  fetchCount: number;
  /** Cache hits served without a live fetch this month. */
  cacheHitCount: number;
  /** Network/provider errors this month. */
  errorCount: number;
}

// ─── Alert Settings ──────────────────────────────────────

export interface AlertSettings {
  driftThresholdPct?: number; // percentage points, e.g. 5 for 5pp drift alert badge
}

// ─── Import profile ──────────────────────────────────────────────

export interface ImportProfileColumns {
  id?: string | number;
  date: string | number;
  type: string | number;
  category?: string | number;
  name?: string | number;
  isin?: string | number;
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
  skipUnmapped?: boolean; // when true, rows whose type is not in typeMap are excluded
  idColumns?: string[]; // CSV column names used to build a deterministic ID when no id column exists
  mergeTaxIntoInterest?: boolean; // when true, same-month TAX rows are merged into INTEREST rows
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
  isin: string;
  shortName: string;
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
  marketValue?: number | null;
  unrealizedPnL?: number | null;
}

// ─── Dividend history entry ──────────────────────────────────────

export interface DivHistEntry {
  date: string;
  isin: string;
  shortName: string;
  color: string;
  gross: number;
  tax: number;
  net: number;
}

// ─── Interest history entry ──────────────────────────────────────

export interface IntHistEntry {
  date: string;
  gross: number;
  tax: number;
  net: number;
  amount: number; // alias for net (backward compat)
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
  totalIntGross: number;
  totalIntTax: number;
  realizedPnL: number;
  interestBySource: Record<string, number>;
  taxBySource: Record<string, number>;
}

// ─── Parse result ────────────────────────────────────────────────

export interface UnmappedType {
  type: string;
  count: number;
  example?: string;
}

export interface DateErrorRow {
  raw: string;
  count: number;
}

export interface NumberErrorRow {
  field: string; // e.g. 'amount', 'shares'
  raw: string; // original cell value that failed to parse
  count: number;
}

export interface ParseResult {
  transactions: Transaction[];
  unmapped: UnmappedType[];
  dateErrors: DateErrorRow[];
  numberErrors: NumberErrorRow[];
  /** Raw CSV lines (no header) that were skipped or had number parse errors. */
  errorLines: string[];
  /** The raw header line from the source CSV, for reconstructing a downloadable error file. */
  headerLine: string;
}

export interface PreviewSummary {
  total: number;
  byCounts: Record<string, number>;
  sample: Transaction[];
  unmapped: UnmappedType[];
  dateErrors: DateErrorRow[];
  numberErrors: NumberErrorRow[];
  /** Raw CSV lines (no header) that were skipped or had number parse errors. */
  errorLines: string[];
  /** The raw header line from the source CSV. */
  headerLine: string;
}
