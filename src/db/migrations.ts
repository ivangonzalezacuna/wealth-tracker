/**
 * Schema migrations - each entry migrates from version N-1 → N.
 *
 * Index 0 is unused (version 0 means "no DB yet", handled by SCHEMA_DDL).
 * Each migration is an array of SQL statements run in a transaction.
 */

export const MIGRATIONS: string[][] = [
  // [0] placeholder - version 0 → 1 is handled by SCHEMA_DDL in schema.ts
  [],
  // [1] version 1 → 2: remove symbol from transactions, rename ticker→short_name in holdings
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
];
