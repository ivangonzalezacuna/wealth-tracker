/**
 * Schema migrations - MIGRATIONS[v] upgrades schema version v-1 to v.
 *
 * Index 0 is unused (version 0 means "no DB yet", handled by SCHEMA_DDL).
 * Each migration is an array of SQL statements run in a transaction.
 */

export const MIGRATIONS: string[][] = [
  // [0] placeholder - version 0 → 1 is handled by SCHEMA_DDL in schema.ts
  [],
  // [1] version 0 → 1: remove symbol from transactions, rename ticker→short_name in holdings
  [
    // Transactions: recreate without symbol column
    `CREATE TABLE IF NOT EXISTS transactions_v2 (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      isin TEXT NOT NULL DEFAULT '',
      shares REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      fee REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      fx_rate REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT ''
    )`,
    `INSERT INTO transactions_v2 (id, date, source, type, name, isin, shares, price, amount, fee, tax, currency, fx_rate, note)
     SELECT id, date, source, type, name, COALESCE(NULLIF(isin,''), symbol), shares, price, amount, fee, tax, currency, fx_rate, note FROM transactions`,
    `DROP TABLE transactions`,
    `ALTER TABLE transactions_v2 RENAME TO transactions`,
    `CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date)`,
    `CREATE INDEX IF NOT EXISTS idx_tx_isin ON transactions(isin)`,
    // Holdings: recreate with short_name instead of ticker
    `CREATE TABLE IF NOT EXISTS holdings_v2 (
      isin TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      short_name TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '',
      acc INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      contrib_amount REAL NOT NULL DEFAULT 0,
      contrib_interval TEXT NOT NULL DEFAULT 'weekly',
      asset_class TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      fold_into TEXT NOT NULL DEFAULT '',
      "order" INTEGER NOT NULL DEFAULT 0
    )`,
    `INSERT INTO holdings_v2 (isin, name, short_name, color, acc, active, contrib_amount, contrib_interval, asset_class, region, fold_into, "order")
     SELECT isin, name, ticker, color, acc, active, contrib_amount, contrib_interval, asset_class, region, fold_into, "order" FROM holdings`,
    `DROP TABLE holdings`,
    `ALTER TABLE holdings_v2 RENAME TO holdings`,
  ],
  // [2] placeholder - no version 1 → 2 migration; this slot aligns indices with schema versions
  [],
  // [3] version 2 → 3: add locked, locked_until, extra_contrib columns to accounts
  [
    `ALTER TABLE accounts ADD COLUMN locked INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE accounts ADD COLUMN locked_until TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE accounts ADD COLUMN extra_contrib REAL NOT NULL DEFAULT 0`,
  ],
  // [4] version 3 → 4: add category column to transactions
  [`ALTER TABLE transactions ADD COLUMN category TEXT NOT NULL DEFAULT ''`],
  // [5] version 4 → 5: add ter column to holdings
  [`ALTER TABLE holdings ADD COLUMN ter REAL NOT NULL DEFAULT 0`],
  // [6] version 5 → 6: replace per-holding contrib_amount/contrib_interval with a single
  //     strategic target_pct, and add a global calibration_interval setting.
  //     Existing contrib-weight data is converted to target_pct percentages.
  [
    // Step 1: create the new holdings table without contrib columns
    `CREATE TABLE IF NOT EXISTS holdings_v6 (
      isin TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      short_name TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '',
      acc INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      target_pct REAL NOT NULL DEFAULT 0,
      asset_class TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      fold_into TEXT NOT NULL DEFAULT '',
      "order" INTEGER NOT NULL DEFAULT 0,
      ter REAL NOT NULL DEFAULT 0
    )`,
    // Step 2: insert rows with target_pct derived from old contrib weights.
    // Each active holding's annualised contrib share of the total becomes target_pct.
    // Interval multipliers: weekly=52, biweekly=26, monthly=12, quarterly=4.
    // Holdings with zero contrib or inactive get target_pct 0.
    `INSERT INTO holdings_v6 (isin, name, short_name, color, acc, active, target_pct, asset_class, region, fold_into, "order", ter)
     SELECT
       isin, name, short_name, color, acc, active,
       CASE
         WHEN active = 1 AND contrib_amount > 0 AND (
           SELECT SUM(
             contrib_amount * CASE contrib_interval
               WHEN 'weekly' THEN 52
               WHEN 'biweekly' THEN 26
               WHEN 'monthly' THEN 12
               WHEN 'quarterly' THEN 4
               ELSE 12
             END)
           FROM holdings
           WHERE active = 1 AND contrib_amount > 0
         ) > 0
         THEN ROUND(
           contrib_amount * CASE contrib_interval
             WHEN 'weekly' THEN 52
             WHEN 'biweekly' THEN 26
             WHEN 'monthly' THEN 12
             WHEN 'quarterly' THEN 4
             ELSE 12
           END * 100.0 / (
             SELECT SUM(
               contrib_amount * CASE contrib_interval
                 WHEN 'weekly' THEN 52
                 WHEN 'biweekly' THEN 26
                 WHEN 'monthly' THEN 12
                 WHEN 'quarterly' THEN 4
                 ELSE 12
               END)
             FROM holdings
             WHERE active = 1 AND contrib_amount > 0
           ), 1)
         ELSE 0
       END,
       asset_class, region, fold_into, "order", ter
     FROM holdings`,
    // Step 3: swap tables
    `DROP TABLE holdings`,
    `ALTER TABLE holdings_v6 RENAME TO holdings`,
    // Step 4: seed the global calibration_interval setting (default monthly)
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('calibration_interval', 'monthly')`,
  ],
  // [7] version 6 → 7: add a global contribution_interval setting for budget cadence.
  [`INSERT OR IGNORE INTO settings (key, value) VALUES ('contribution_interval', 'monthly')`],
  // [8] version 7 → 8: add notes column to holdings.
  [`ALTER TABLE holdings ADD COLUMN notes TEXT NOT NULL DEFAULT ''`],
  // [9] version 8 → 9: add country column to accounts.
  [`ALTER TABLE accounts ADD COLUMN country TEXT NOT NULL DEFAULT ''`],
  // [10] version 9 → 10: add group column to accounts.
  [`ALTER TABLE accounts ADD COLUMN "group" TEXT NOT NULL DEFAULT ''`],
  // [11] version 10 → 11: add FX integration support (rates cache, account currency, telemetry).
  [
    `CREATE TABLE IF NOT EXISTS fx_rates (
      base TEXT NOT NULL,
      target TEXT NOT NULL,
      date TEXT NOT NULL,
      rate REAL NOT NULL,
      effective_date TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (base, target, date)
    )`,
    `ALTER TABLE accounts ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR'`,
    `CREATE TABLE IF NOT EXISTS fx_telemetry (
      id INTEGER PRIMARY KEY,
      last_fetch_at TEXT NOT NULL DEFAULT '',
      last_error_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      fetch_count INTEGER NOT NULL DEFAULT 0,
      cache_hit_count INTEGER NOT NULL DEFAULT 0
    )`,
    `INSERT OR IGNORE INTO fx_telemetry (id) VALUES (1)`,
  ],
  // [12] version 11 → 12: add FX prefetch telemetry counters.
  [
    `ALTER TABLE fx_telemetry ADD COLUMN prefetch_attempt_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE fx_telemetry ADD COLUMN prefetch_success_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE fx_telemetry ADD COLUMN prefetch_failure_count INTEGER NOT NULL DEFAULT 0`,
  ],
  // [13] version 12 → 13: track last attempted Frankfurter request URL.
  [`ALTER TABLE fx_telemetry ADD COLUMN last_request_url TEXT NOT NULL DEFAULT ''`],
  // [14] version 13 → 14: add normalization telemetry counters.
  [
    `ALTER TABLE fx_telemetry ADD COLUMN normalize_attempt_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE fx_telemetry ADD COLUMN normalize_success_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE fx_telemetry ADD COLUMN normalize_failure_count INTEGER NOT NULL DEFAULT 0`,
  ],
  // [15] version 14 → 15: add monthly FX telemetry table.
  [
    `CREATE TABLE IF NOT EXISTS fx_telemetry_monthly (
      month TEXT PRIMARY KEY,
      fetch_count INTEGER NOT NULL DEFAULT 0,
      cache_hit_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0
    )`,
  ],
  // [16] version 15 → 16: add FMP ETF metadata cache and telemetry tables.
  [
    `CREATE TABLE IF NOT EXISTS holding_metadata (
      isin TEXT PRIMARY KEY,
      symbol TEXT,
      exchange TEXT,
      domicile_country TEXT,
      fund_currency TEXT,
      aum REAL,
      inception_date TEXT,
      holdings_count INTEGER,
      sectors TEXT,
      top_holdings TEXT,
      fetched_at TEXT NOT NULL DEFAULT '',
      last_refreshed_at TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'fmp'
    )`,
    `CREATE TABLE IF NOT EXISTS fmp_telemetry (
      id INTEGER PRIMARY KEY,
      last_fetch_at TEXT NOT NULL DEFAULT '',
      last_request_url TEXT NOT NULL DEFAULT '',
      last_error_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      fetch_count INTEGER NOT NULL DEFAULT 0,
      cache_hit_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      daily_fetch_date TEXT NOT NULL DEFAULT '',
      daily_fetch_count INTEGER NOT NULL DEFAULT 0
    )`,
    `INSERT OR IGNORE INTO fmp_telemetry (id) VALUES (1)`,
  ],
  // [17] version 16 → 17: add persisted FMP request debug log.
  [`ALTER TABLE fmp_telemetry ADD COLUMN request_log_json TEXT NOT NULL DEFAULT '[]'`],
];
