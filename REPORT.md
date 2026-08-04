# Wealth Tracker - App Review Report

**Date:** 2026-08-03
**Scope:** Full codebase, documentation, and PR history review
**Reviewed by:** Multi-disciplinary team (UX/Wealth Management, Financial Data Modelling, Technical Quality, PR History Analysis)
**Method:** Each finding was independently identified and cross-verified against the actual source code before inclusion.

---

## Executive Summary

Wealth Tracker is a well-architected, actively maintained personal ETF and net-worth tracker. The core loop works well: monthly snapshots, CSV imports, cost-basis calculation, allocation drift analysis, and a net-worth forecast with inflation overlay. The codebase is clean, tested, and backed by a meaningful commit history that shows disciplined incremental improvement.

This review surfaces the gaps that stand out when the app is measured against the expectations of a standalone wealth-management entry point. Findings are grouped into six areas and ordered within each area by priority.

---

## Area 1: Financial Data Model Gaps

### 1.1 FX Rates Stored but Never Applied in Calculations (HIGH)

`Transaction.fxRate` is stored in the database and accepted from CSV imports, but is never read by the cost-basis engine, P&L calculations, or portfolio aggregations. All amounts are treated as EUR regardless of the original transaction currency.

- **Confirmed in:** `src/portfolio.ts` (cost-basis loop never reads `tx.fxRate`), `src/model/costbasis.ts`, PR #125 (explicitly acknowledges the limitation)
- **Impact:** Any user who holds a non-EUR ETF or imports transactions in USD/GBP will see incorrect cost basis, realized P&L, and allocation weights.
- **What is needed:** A base-currency setting and FX conversion applied at import time or at calculation time using the stored rate.

### 1.2 Unrealized P&L Requires Manual Per-ETF Market Value Entry (MEDIUM)

Unrealized gain/loss for each position is only shown when the user manually enters current market values in the ETF breakdown section of the snapshot form. If this is skipped, the holdings table shows no unrealized P&L and the drift table falls back to cost basis.

- **Confirmed in:** `src/views/portfolio.ts` `extractSnapEtfValues()`, `src/model/drift.ts:58-61`, `src/types.ts` (`unrealizedPnL?: number | null`)
- **Impact:** The majority of sessions show stale or absent unrealized P&L data. Cost-basis-based drift can be significantly misleading for high-gain positions.
- **What is needed:** At minimum, a clear prompt or reminder on the snapshot form to complete the ETF breakdown; ideally, a price-feed integration or last-price carry-forward.

### 1.3 No Corporate Action Support: Stock Splits, Mergers, Spinoffs (MEDIUM)

`TxType` defines nine transaction types (BUY, SELL, DIVIDEND, INTEREST, FEE, TAX, DEPOSIT, WITHDRAWAL, TRANSFER). There is no SPLIT, SPINOFF, or RIGHTS type. When a holding undergoes a 2:1 split or a spinoff, users must manually adjust share counts and cost basis with no guided workflow.

- **Confirmed in:** `src/types.ts:3-13`, `src/model/costbasis.ts` (no split logic)
- **Impact:** Any user holding a position that splits will have a wrong cost-per-share figure and incorrect IRR until they manually fix it. The existing `foldInto` field partially handles ETF mergers but is limited to a direct ISIN replacement and is unverified against real data (confirmed in README Known Limitations).
- **What is needed:** A SPLIT transaction type that adjusts shares and unit cost without altering total cost basis, and a SPINOFF type that allocates cost basis proportionally.

### 1.4 Allocation Drift Falls Back to Cost Basis When Market Values Are Missing (MEDIUM) - PARTIALLY RESOLVED

`computeDrift()` prefers snapshot market values but silently falls back to cost basis when they are not present. The fallback is mentioned in a tooltip but is not prominently flagged.

- **Confirmed in:** `src/model/drift.ts:55-61`
- **Impact:** For long-held positions with large unrealized gains, cost-basis-derived allocation percentages can be significantly wrong. A position that was 15 % of portfolio at purchase may now be 30 % or 5 % at market prices, but the drift card will show 15 %.
- **What is needed:** A more prominent warning when cost basis is being used as a fallback, and optionally a column showing the valuation mode per row.
- **Resolution:** A card-level warning banner is shown when any row uses cost-basis mode. Each affected row now also shows an inline info icon next to the actual % value, with a tooltip explaining the limitation. The remaining improvement (a dedicated "Valuation" column) is a future enhancement.

---

## Area 2: Portfolio Analytics and Performance

### 2.1 No Time-Weighted Return (TWR) Metric (MEDIUM)

The app calculates CAGR and XIRR (money-weighted IRR). Neither metric isolates manager skill from contribution timing. IRR rewards investors who contributed large sums before strong market periods, regardless of strategy quality.

- **Confirmed in:** `src/model/insights.ts` (only `xirr()` and `cagr()` functions exist), `src/views/networth.ts:215`
- **Impact:** Users cannot benchmark their strategy against passive alternatives or compare across periods with different contribution patterns. TWR is the industry-standard metric for this purpose.
- **What is needed:** A TWR calculation using snapshot-to-snapshot return chaining, which is compatible with the existing monthly snapshot data structure.

### 2.2 No Benchmark Comparison (MEDIUM)

Returns (CAGR, IRR, YoY) are shown in isolation. There is no way to overlay or compare against a market index (MSCI World, S&P 500, STOXX 600, etc.).

- **Confirmed in:** `src/views/networth.ts`, `src/model/insights.ts` (no benchmark data structure or calculation)
- **Impact:** Users cannot assess whether their investment decisions have added or destroyed value relative to simply buying a passive index. This is the single most important context for evaluating an investment strategy.
- **What is needed:** An optional user-configured benchmark ticker (or a hardcoded set of common indices) with return data shown alongside portfolio metrics on the Net Worth tab.

### 2.3 No Risk Metrics (MEDIUM)

The app tracks returns but not risk. There is no volatility, standard deviation, Sharpe ratio, Sortino ratio, maximum drawdown, or correlation analysis anywhere in the codebase.

- **Confirmed in:** Codebase-wide search for "volatility", "sharpe", "drawdown", "correlation" returns no results in calculation files.
- **Impact:** A user with a 7 % annual return cannot tell whether that return required 5 % volatility or 30 %. Risk-adjusted return is a foundational wealth management concept and its absence limits the app's utility for serious portfolio evaluation.
- **What is needed:** At minimum, annualized volatility of monthly net-worth changes and a maximum drawdown figure, both computable from the existing snapshot history without any external data.

### 2.4 No Per-Account Performance Analytics (MEDIUM)

CAGR and IRR are computed at the portfolio level only. There is no way to see which account (broker) is performing better or compare the IRR of the pension account versus the ETF brokerage.

- **Confirmed in:** `src/model/insights.ts`, `src/views/networth.ts` (IRR uses aggregate investment value)
- **Impact:** Users with multiple accounts and brokers cannot identify which relationships or strategies are working and optimize their allocation accordingly.
- **What is needed:** Per-account CAGR derived from per-account snapshot values, and optionally per-account IRR for investment-type accounts.

### 2.5 No Dividend Income Forecasting or Yield Projection (LOW)

The forecast on the Net Worth tab projects asset value growth. There is no separate projection of future dividend or interest income based on current yield and portfolio size.

- **Confirmed in:** `src/model/forecast.ts` (only net worth projection), `src/views/dividends.ts` (historical data only)
- **Impact:** Income investors and those planning for retirement using dividend income cannot answer "What will my annual dividend income be in 10 years?"
- **What is needed:** A simple forward projection: current yield rate multiplied by the projected portfolio value series from the existing forecast engine.

---

## Area 3: Tax and Compliance

### 3.1 No Tax-Loss Harvesting Identification (MEDIUM)

The app shows realized P&L from closed positions and unrealized P&L when market values are manually entered, but contains no logic to identify positions with harvestable unrealized losses. There are no alerts, flags, or suggestions related to tax optimization.

- **Confirmed in:** `src/views/portfolio.ts` (P&L display only), `src/model/costbasis.ts` (no harvesting logic)
- **Impact:** Users miss opportunities to realize losses that offset gains, potentially paying more tax than necessary each year.
- **What is needed:** A tax-loss harvesting section in the portfolio view that surfaces positions with significant unrealized losses relative to their cost basis, with the caveat that tax advice must come from a professional.

### 3.2 No Tax Jurisdiction or Holding-Period Tracking (MEDIUM)

The `tax` field in a transaction is a plain number. There is no metadata about the originating jurisdiction, applicable tax treaty, or how long the position has been held (important for long-term vs. short-term capital-gains tax treatment in many jurisdictions).

- **Confirmed in:** `src/types.ts:30` (`tax: number`), no jurisdiction field anywhere in the schema
- **Impact:** Tax reporting is manual. Users in Germany (Abgeltungsteuer), the UK (CGT), or the US (short/long-term distinction) cannot generate a compliant tax summary from the app's data.
- **What is needed:** An optional jurisdiction field on the account (not per-transaction) and a per-lot holding-period calculation derived from BUY date to SELL date using the existing lot data.

### 3.3 No Expense Ratio (TER/OCF) Tracking (LOW)

The `Holding` interface stores `isin`, `name`, `assetClass`, `region`, and `color`, but no total expense ratio (TER) or ongoing charges figure (OCF).

- **Confirmed in:** `src/types.ts:62-75` (Holding interface), `src/views/settings.ts:612-629` (ASSET_CLASSES, no fee field)
- **Impact:** Users cannot calculate the annual fee drag on their portfolio, identify expensive holdings, or compare the cost of equivalent ETFs.
- **What is needed:** An optional `ter` field on the `Holding` type, populated by the user, with a "total annual fee drag" KPI tile on the portfolio summary card.

### 3.4 No Structured Tax Export (LOW) - RESOLVED

The only data export available is a full JSON backup. There is no CSV or structured export formatted for use in tax preparation software (e.g., ELSTER in Germany, HMRC format in the UK).

- **Confirmed in:** `src/backup/exportImport.ts` (only full JSON backup), no reporting module exists
- **Impact:** Users must manually copy dividend, interest, and realized P&L data into their tax filing software. This is the most time-consuming part of the annual workflow.
- **What is needed:** A "Tax year summary" export that outputs realized gains/losses, dividend income, and interest income for a selectable calendar year in a simple CSV format.
- **Resolution:** A "Tax year summary" export has been added to the Settings backup card. Users select a calendar year from a dropdown populated from their transaction history, then click "Tax year summary" to download `tax-summary-{year}.csv`. The CSV contains five sections: realized gains/losses (per-SELL, using the average-cost method), dividend income (gross, tax withheld, net), interest income, fee and tax payments, and a totals summary. The export logic lives in `src/taxExport.ts` and is exposed via `window.__exportTaxSummary`.

---

## Area 4: UX and Workflow Friction

### 4.1 Snapshot Form Does Not Auto-Populate from Previous Month (MEDIUM)

When the user opens the `+ Update` tab to log a new month, all account value fields are blank. The user must open their broker app and re-enter each balance from scratch.

- **Confirmed in:** `src/main.ts:1531-1585` (`renderSnapForm()` - input fields are always rendered empty for new entries; `editSnap()` does pre-fill when editing an existing snapshot, showing the pre-fill mechanism already exists)
- **Impact:** A typical user with 3-5 accounts spends roughly 2-3 extra minutes per monthly session re-entering values they could have pre-populated from the prior month and simply updated.
- **What is needed:** Pre-populate each account's input field with its value from the most recent snapshot. The user then only changes values that have actually moved. The ETF breakdown would similarly carry forward the prior values.

### 4.2 No UI to Record a Sale (HIGH - UX Risk)

Selling shares is explicitly described as unsupported in the README. The cost-basis engine processes SELL transactions, but there is no form in the UI to record one. Users with sell events can only import them via broker CSV.

- **Confirmed in:** `src/main.ts` (no sell form), README Known Limitations section, `src/types.ts:6` (SELL exists in enum)
- **Impact:** Users who sell a position (to rebalance, for emergency cash, or upon ETF closure) have no in-app workflow. They must rely on CSV imports, and if their broker is not Trade Republic or N26, they cannot import at all.
- **What is needed:** A manual "Record sale" form with date, ISIN, shares, proceeds, and fee fields. This mirrors the existing snapshot form pattern and would be straightforward to implement using the existing cost-basis engine.

### 4.3 Only Two Broker Import Profiles (MEDIUM)

The import engine is designed to be bank-agnostic and adding a new profile requires only a data file (as documented in the README), but only Trade Republic and N26 are shipped by default.

- **Confirmed in:** `src/import/profiles/` (only `trade_republic.ts` and `n26.ts`), `src/import/profiles/index.ts`
- **Impact:** Users at DEGIRO, Scalable Capital, Interactive Brokers, Fineco, or any other broker cannot import CSV data without writing their own profile. This significantly limits the app's addressable audience.
- **What is needed:** Community-contributed profiles for the most common European brokers (DEGIRO, Scalable Capital, Consorsbank, Comdirect). The profile format is already well-defined and documented.

### 4.4 No Holdings Search or Text Filter (LOW) - RESOLVED

The holdings table supports pagination and a held/closed/all toggle, but has no text search or ISIN filter box.

- **Confirmed in:** `src/views/portfolio.ts:364-476` (filter buttons only, no search input)
- **Impact:** Users with 20+ positions cannot quickly find a specific holding without scrolling through paginated results.
- **What is needed:** A simple text input that filters the holdings table by ISIN or name, similar to the existing snapshot notes search on the Log tab.
- **Resolution:** A text search input has been added to the holdings filter bar. Typing filters the holdings list by ISIN or name (case-insensitive) and resets pagination to page 1.

### 4.5 Only One Financial Goal Supported (LOW)

Settings allow one target net worth and one target date. There is no support for multiple named goals (e.g., house down payment by 2028, retirement by 2050, emergency fund top-up by 2025).

- **Confirmed in:** `src/views/settings.ts:1060-1130` (single goal card), `src/types.ts:87-90` (Settings interface stores `targetNetWorth` and `targetDate` as single values)
- **Impact:** Users with multiple savings objectives cannot track progress per goal. All forecasting and ETA calculation references a single target.
- **What is needed:** A goals list (label, target amount, target date) with per-goal progress tracking on the Net Worth tab.

### 4.6 No Withdrawal or Drawdown Scenario in Forecast (MEDIUM)

The net-worth forecast on the Net Worth tab projects forward using contributions and a return rate. There is no way to model planned withdrawals (retirement spending, planned purchases).

- **Confirmed in:** `src/model/forecast.ts` (only positive contribution and compound growth, no withdrawal parameter), `src/views/networth.ts:668` (`_renderForecastChart`)
- **Impact:** Users approaching or in retirement cannot use the forecast to answer "Will my portfolio last until age 90 if I withdraw €2,000/month?" This is the most common retirement planning question.
- **What is needed:** An optional annual withdrawal rate field in the forecast parameters. The existing `forecastMultiAccountSeries` function would need a negative contribution component.

### 4.7 No Rebalancing Drift Alerts or Notifications (LOW) - PARTIALLY RESOLVED

The portfolio drift card computes allocation deviation visually but generates no alert when drift exceeds a user-defined threshold. Users must manually navigate to the Portfolio tab to check.

- **Confirmed in:** `src/model/drift.ts` (`ON_TARGET_DRIFT_EPS = 0.5` for the rebalance plan, no notification mechanism), `src/views/portfolio.ts:771`
- **Impact:** The rebalancing workflow relies on the user proactively checking the drift card each month. An alert (PWA notification or a badge on the tab) would reduce the cognitive load of the monthly workflow.
- **What is needed:** A badge or prominent indicator on the Portfolio tab when any holding's drift exceeds a configurable threshold (e.g., 5 percentage points).
- **Resolution:** A small orange dot badge now appears on the Portfolio tab button whenever max allocation drift exceeds 5 percentage points. The badge disappears when drift returns to within threshold. The threshold is fixed at 5 pp (matching existing drift card status labels); a user-configurable threshold remains a future enhancement.

---

## Area 5: Asset and Account Coverage

### 5.1 No Support for Non-ISIN Assets: Crypto, Direct Real Estate, Commodities (HIGH)

The entire asset model is built around ISIN-identified holdings. There is no way to track cryptocurrency wallets, directly-owned real estate (equity minus mortgage), physical gold, or any asset that does not have an ISIN.

- **Confirmed in:** `src/types.ts:62-75` (Holding requires ISIN), `src/model/holdings.ts` (ISIN_RE validation), `src/views/settings.ts:712`
- **Impact:** For most European investors under age 40, Bitcoin, Ethereum, or a property constitutes a significant share of their total net worth. Excluding these makes the "net worth" figure incomplete.
- **What is needed:** A separate "manual asset" account type (or a non-ISIN holding type) where users enter a current value. This is already partially possible by adding a snapshot account with no holdings, but there is no first-class UX for it and no way to track cost basis.

### 5.2 No Crypto Exchange or Property Import Profiles (LOW)

Following on from 5.1, even if manual tracking is added, there are no import profiles for Coinbase, Binance, or any crypto tax/accounting export format.

- **Confirmed in:** `src/import/profiles/index.ts` (only two profiles)
- **Impact:** Crypto holders must manually enter all transactions if they want cost basis and realized P&L for their crypto portion.

---

## Area 6: Technical Quality

### 6.1 Repository Functions Perform DELETE then INSERT Without a SQLite Transaction (HIGH) - RESOLVED

`saveAccounts()`, `saveHoldings()`, `restoreTransactions()`, and `replaceAllSettings()` all follow the pattern: `db.run('DELETE FROM table')` followed by a loop of `INSERT` statements, with no enclosing `BEGIN`/`COMMIT`. If the process crashes, loses the IDB lock, or throws mid-loop, the table is left empty (data deleted) with no inserts applied.

- **Confirmed in:** `src/db/repositories/config.ts:22-50` (`saveAccounts`), `src/db/repositories/config.ts:62-90` (`saveHoldings`), `src/db/repositories/config.ts:117-131` (`replaceAllSettings`), `src/db/repositories/snapshots.ts:40-52` (`saveSnapshots`), `src/db/repositories/transactions.ts:72-101` (`restoreTransactions`)
- **Impact:** Partial writes are silent. The user is not informed of data loss. On the next load, the affected table is empty.
- **Resolution:** All five functions now wrap the DELETE+INSERT batch in `BEGIN` / `COMMIT` / `ROLLBACK` so partial writes are prevented.

### 6.2 Prepared Statements Not Freed in a try-finally Block (MEDIUM) - RESOLVED

`stmt.free()` is called unconditionally at the end of `saveAccounts`, `saveHoldings`, and `saveSnapshots`. If any `stmt.run(...)` call inside the loop throws, execution jumps out of the function and `stmt.free()` is never called, leaking the prepared statement.

- **Confirmed in:** `src/db/repositories/config.ts:45`, `src/db/repositories/config.ts:84`, `src/db/repositories/snapshots.ts:52` (no try-finally wrapping stmt)
- **Resolution:** All five functions now call `stmt.free()` inside a `finally` block, ensuring the statement is always freed even if an INSERT throws.

### 6.3 CSP Allows `'unsafe-inline'` Styles; No HSTS Header (MEDIUM) - PARTIALLY RESOLVED

The Content-Security-Policy in `netlify.toml` includes `style-src 'self' 'unsafe-inline'`, which allows any inline `style` attribute to execute without restriction. No `Strict-Transport-Security` header is set.

- **Confirmed in:** `netlify.toml:15` (CSP value), absence of HSTS in headers block
- **Impact:** `'unsafe-inline'` for styles weakens the CSP against CSS injection. Missing HSTS means a user on a hostile network could be downgraded to HTTP on their first visit before the browser learns the site is HTTPS-only.
- **Resolution:** HSTS header (`max-age=63072000; includeSubDomains; preload`) added to `netlify.toml`. The `'unsafe-inline'` style-src issue remains open because Chart.js injects inline styles at runtime; a nonce-based approach would require changes to the Chart.js integration.

### 6.4 Backup Restore Does Not Protect Against Partial Writes (MEDIUM)

`restoreFromBackup()` in `main.ts` runs a sequence of `await setAccounts(...)`, `await setHoldings(...)`, `await replaceSettings(...)`, `await saveSnapshots(...)`, `await restoreTransactions(...)` inside a `try`/`finally`. The `finally` only clears the sync flag. If `setAccounts` succeeds but `setHoldings` throws, the in-database accounts are replaced with the backup's accounts while holdings remain the old values, creating an inconsistent state.

- **Confirmed in:** `src/main.ts:808-856` (no rollback, `finally` only clears `_syncing`)
- **Impact:** A failed mid-restore leaves the database in an indeterminate state that is difficult to diagnose and recover from.
- **What is needed:** Wrap the entire restore sequence in a single SQLite transaction so that either all writes succeed or none do. The error should be surfaced to the user with a "Restore failed - original data preserved" message.

### 6.5 No Storage Quota Monitoring (LOW)

IDB quota errors are caught silently (see 6.6) but the app never proactively checks available storage. Users on iOS or in private browsing mode have much lower IDB quotas and will hit the limit sooner.

- **Confirmed in:** `src/db/connection.ts` (no `navigator.storage.estimate()` calls), `src/cache/db.ts`
- **What is needed:** A one-time `navigator.storage.estimate()` check on startup and a persistent warning banner if available quota is below a safe threshold (e.g., below 10 MB with the db already at 5 MB).

### 6.6 IDB Cache Write Failures Are Silently Ignored (MEDIUM) - PARTIALLY RESOLVED

IDB (IndexedDB) cache writes in `src/cache/db.ts` catch all errors and discard them (`catch { // Quota or other IDB error - degrade gracefully }`). The main sync path in `main.ts` also wraps post-import cache writes in a bare `try/catch` with no user-visible feedback. This is intentional for quota resilience, but a failure after the user has confirmed an import means the next app load will show stale data with no warning.

- **Confirmed in:** `src/cache/db.ts:131-133` (`setCachedConfig`), `src/main.ts:604-607` (post-import cache write in a silent catch)
- **Impact:** The risk is narrower than a general "silent data loss" bug. The authoritative DB write (Google Sheets via Drive) must have already succeeded. The symptom is stale cache data on next boot, not lost transactions. However, users on low-storage devices (private mode, iOS) will not understand why data appears to have disappeared after a reload.
- **What is needed:** Log a console warning with enough context to diagnose quota failures, and display a one-time "Local cache could not be saved. Reopen the app while online to reload from your backup." banner if the IDB write fails after an import or settings save.
- **Resolution:** `setCachedConfig`, `setCachedSnapshots`, and `setCachedTransactions` now return a boolean indicating success. The main sync, post-import, and config-change paths check the return value and display a one-time dismissible warning banner ("Local cache could not be saved. Reopen the app while online to reload from your backup.") when any of these writes fail. Storage quota monitoring (finding 6.5) remains open.

---

## Area 7: Additional Findings (Post-Review Verification)

The following issues were identified during codebase verification of the original report findings and were not present in the initial review.

### 7.1 Custom Import Profiles Cannot Be Persisted or Reused (MEDIUM)

`src/import/profile.ts` exports `buildProfileFromMapping()`, described in a comment as "the extension point for the future interactive column-mapper UI." However, there is no storage mechanism for user-defined profiles (no DB table, no IDB key, no export field). Even if the mapping UI were built, profiles would be lost on every page reload.

- **Confirmed in:** `src/import/profile.ts` (`buildProfileFromMapping` is never called from `main.ts` or any view), `src/import/profiles/index.ts` (only built-in profiles exposed)
- **Impact:** Users who configure a custom broker format cannot save or share it. Related to finding 4.3; without persistence, any custom-profile UI is unusable.
- **What is needed:** A `custom_profiles` key in the IDB cache (or a DB table), serialization in the backup JSON, and a settings card to create/edit/delete custom profiles.

### 7.2 IRR Calculation Ignores SELL Proceeds as Inflows (HIGH) - PARTIALLY RESOLVED

The IRR tooltip in `src/views/networth.ts:215` states: "SELL and dividend cash movements stay inside the account value and are not counted separately." The cash-flow series passed to `xirr()` uses BUY outflows and the current account value as the terminal inflow. When a user sells a position and the proceeds leave the tracked account, those cash flows are not modelled as explicit inflows, potentially overstating IRR for portfolios with significant realized exits.

- **Confirmed in:** `src/model/insights.ts` (IRR cash-flow construction), `src/views/networth.ts:215` (tooltip acknowledges the limitation)
- **Impact:** For users who sold positions and withdrew proceeds, the IRR figure overstates investment performance. The tooltip partially acknowledges this but does not make the limitation prominent enough for a user to catch it.
- **What is needed:** At minimum, expand the tooltip to clearly warn that IRR is only reliable when sell proceeds remain within the tracked account. Ideally, construct the IRR cash-flow series from individual BUY and SELL transaction records where available, falling back to the current approach otherwise.
- **Resolution:** The IRR info-tip now explicitly states that if sell proceeds were withdrawn from tracked accounts, those cash flows are not modelled as inflows, and the IRR figure may overstate performance for portfolios with significant realized exits. Full cash-flow reconstruction from BUY/SELL transaction records remains a future improvement.

### 7.3 No Confirmation Dialog on Snapshot Delete (MEDIUM) - RESOLVED

Deleting a snapshot in the Log tab does not show a confirmation dialog. Account and holding deletions in Settings use `confirmDialog`, but the snapshot delete action bypasses this guard.

- **Confirmed in:** `src/views/log.ts` (delete handler calls the repository directly), `src/views/settings.ts` (uses `confirmDialog` for account and holding deletes)
- **Impact:** A single misclick permanently deletes a month's snapshot with no undo. Snapshots are the primary data source for the net-worth chart and IRR calculation; losing one distorts both.
- **Resolution:** Already implemented. `delSnap()` in `src/main.ts` calls `confirmDialog` with a danger variant before deleting. Finding was outdated at time of review.

### 7.4 Config Audit Log Is Never Surfaced in the UI (LOW)

`src/db/repositories/config.ts` writes to a `config_history` table for every account, holding, and settings change. The table is populated correctly but there is no view, tab, or settings card where a user can inspect the log.

- **Confirmed in:** `src/db/schema.ts:84-92` (table defined), `src/store/config.ts:180-454` (writes on every config save), no read path outside tests
- **Impact:** The audit capability exists at the data layer but provides no user value. Users who accidentally misconfigure accounts cannot see what changed or when.
- **What is needed:** A read-only "Config history" section in Settings (collapsible) that lists the last N entries from `config_history` with timestamp and summary.

---

## Area 8: Known Limitations (Documented, Pending Resolution)

The following limitations are already acknowledged in the README or PR history and are listed here for completeness and to indicate they are active roadmap items rather than unknown gaps.

| Limitation                                        | Current Status                                                                             | Priority                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Multi-currency FX conversion                      | FX rate stored, never applied. UI warning in PR #125.                                      | High - needs base-currency setting and conversion. |
| Selling shares via UI                             | SELL recognized by engine, no UI form. Documented in README.                               | High - blocks rebalancing and exit workflows.      |
| ETF merger/consolidation (foldInto)               | Code path exists, tested on synthetic data only. In-UI warning shown when foldInto is set. | Medium - unverified against real data.             |
| More broker import profiles                       | Only Trade Republic and N26. Framework is open.                                            | Medium - community contribution opportunity.       |
| IRR accuracy when sell proceeds leave the account | Tooltip acknowledges the limitation but does not quantify the distortion.                  | Medium - see finding 7.2.                          |
| Custom import profiles not persistable            | `buildProfileFromMapping()` exists but has no storage or UI.                               | Medium - see finding 7.1.                          |

---

## Prioritized Action Items

### Must address (highest user impact)

1. **Wrap all DELETE+INSERT sequences in SQLite transactions** (Area 6.1) - data integrity risk
2. **Add a UI form to record manual sell transactions** (Area 4.2) - blocked workflow
3. **Apply FX conversion using stored `fxRate` field** (Area 1.1) - silent data error for multi-currency users
4. **Pre-populate the monthly snapshot form from the previous month's values** (Area 4.1) - high-frequency friction

### Should address (meaningful improvement)

5. Add HSTS and evaluate removing `'unsafe-inline'` from CSP (Area 6.3)
6. Protect backup restore against partial writes (Area 6.4)
7. Free prepared statements in try-finally blocks (Area 6.2)
8. Show user-visible warning when IDB cache write fails after import or settings save (Area 6.6)
9. Add a TWR metric alongside CAGR/IRR (Area 2.1)
10. ~~Add a "tax year summary" export (Area 3.4)~~ **RESOLVED**
11. Surface allocation drift warning badge when tolerance is exceeded (Area 4.7)
12. Add a holdings text search/filter (Area 4.4)
13. Add expense ratio (TER) field to holdings and a fee-drag KPI (Area 3.3)
14. Support withdrawal/drawdown in the forecast model (Area 4.6)
15. Add a SPLIT transaction type (Area 1.3)
16. Add a confirmation dialog to snapshot delete (Area 7.3)
17. Clarify or fix IRR calculation for portfolios with withdrawn sell proceeds (Area 7.2)
18. Align all text boxes to a shared themed style instead of mixed default browser formatting

### Nice to have (long-term roadmap)

19. Benchmark comparison overlay on the Net Worth chart (Area 2.2)
20. Annualized volatility and maximum drawdown metrics (Area 2.3)
21. Multiple named goals with per-goal progress tracking (Area 4.5)
22. First-class non-ISIN asset support (crypto, real estate, commodities) (Area 5.1)
23. Per-account CAGR/IRR breakdown (Area 2.4)
24. Tax jurisdiction field on accounts for holding-period and short/long-term gain tracking (Area 3.2)
25. Tax-loss harvesting identification view (Area 3.1)
26. Dividend income forward projection (Area 2.5)
27. Storage quota monitoring (Area 6.5)
28. Additional European broker import profiles: DEGIRO, Scalable Capital, Interactive Brokers (Area 4.3)
29. Custom import profile persistence and UI (Area 7.1)
30. Surface config audit log (`config_history`) in the UI (Area 7.4)

---

## Appendix: What Is Already Working Well

This report focuses on gaps, but the following areas are solid and should be preserved:

- **Cost-basis engine:** Both average-cost and FIFO are correctly implemented with edge-case handling for partial lots and exited positions.
- **Contribution rebalance planner:** The buy-only drift correction with mixed-cadence normalization is a well-thought-out feature that handles the real-world complexity of weekly vs. monthly contributions.
- **Sync architecture:** The last-write-wins Drive sync with a 5-second debounce is appropriately simple for a single-user app. The separation of IDB cache (fast boot) from Drive sync (authoritative) is correct.
- **Dark/light theme:** Full dark mode support using `prefers-color-scheme` with Chart.js color rebinding on OS theme change.
- **PWA:** Installable, offline-capable for read operations, with a working service worker update flow.
- **Data portability:** Full JSON export/restore is well-structured, versioned with migration support, and exports everything needed to move to another instance.
- **Security:** The `drive.appdata` scope restriction, CSP (aside from `unsafe-inline`), and X-Frame-Options headers are appropriately configured.
- **Inflation-adjusted forecast:** The forecast chart includes a live inflation rate input that overlays real (purchasing-power-adjusted) projections alongside nominal projections.
