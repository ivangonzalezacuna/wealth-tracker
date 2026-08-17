# Roadmap

This document outlines planned improvements to Wealth Tracker. Items are roughly ordered by impact and effort. The app is a self-hosted, client-only PWA; every feature must remain offline-capable and store only data that the user provides — no external price APIs or third-party data feeds.

---

## Short-term (next 1–3 months)

Focus: polish, usability gaps, and the most-requested missing pieces.

### Import & CSV

- ~~**Import error recovery**~~ ✅ — When a CSV batch fails to parse (wrong date format, unrecognised type, garbled number), the current flow shows aggregate error counts but does not let the user isolate and fix individual bad rows. A row-level error diff that can be exported as a pre-filtered CSV lets the user fix only the problem rows and re-import them, rather than fixing the entire source file and re-importing everything.

### Snapshots & Net Worth

- ~~**Snapshot notes in the timeline chart**~~ ✅ — Notes are surfaced as dot markers on the Net Worth chart, with the full note text visible in the tooltip on hover.

- ~~**Bulk snapshot delete**~~ ✅ — The log view supports multi-select and bulk delete for both snapshots and transactions, accessible via the "Bulk delete" toggle in the filter bar.

### Portfolio & Holdings

- ~~**Holding TER summary**~~ ✅ — An "Annual fee drag" KPI is shown on the Portfolio card, computed as the value-weighted sum of TER across all held positions.

- ~~**Per-holding notes field**~~ ✅ — Holdings evolve: an ETF might announce an index change, a merger, or a redenomination. Right now there is no place inside the app to record that context, so it lives in a separate spreadsheet or gets forgotten. A simple optional notes field on each holding configuration row provides the right home for forward-looking reminders and post-hoc explanations without adding schema complexity.

### UX / Accessibility

- ~~**Keyboard navigation for modals**~~ ✅ — All dialogs (snapshot, account, holding, transaction, confirm) implement a focus trap and restore focus to the trigger element on close.

---

## Medium-term (3–9 months)

Focus: deeper analytics, richer planning, and data quality.

### Analytics

- **Correlation / diversification score** — Knowing the allocation percentages of your holdings is not the same as knowing how correlated they are. Two holdings with identical target allocations can either hedge each other or move in lockstep. Using the monthly return series already computed from snapshots and transactions, the app can estimate pairwise correlations between holdings and produce a simple portfolio-level diversification score. The goal is not to replicate a quant tool but to surface an early-warning signal when the portfolio is effectively concentrated in one factor. This is worth designing and testing to validate whether the signal is genuinely useful.

- **Cash-flow calendar** — The app already separates dividends, interest, and contributions in the data model and in individual views. What is missing is a forward-looking, time-indexed view that shows projected income and scheduled outflows month by month: expected next dividend from each holding (extrapolated from historical frequency), contribution execution dates, and interest payment estimates. This bridges the portfolio's past (transaction history) with its future (forecast model) in a practical, action-oriented format.

### Planning & Forecasting

- ~~**Scenario comparison**~~ ✅ — Forecast now includes an expandable scenario comparison with baseline + named optimistic/pessimistic overlays and side-by-side table values so users can inspect uncertainty without leaving the app.

- ~~**Goal milestones**~~ ✅ — The existing `NamedGoal` type supports a target amount and target date, and the Net Worth tab renders a progress bar toward the final target. For long-horizon goals (e.g. a 20-year retirement target), the distance to the end is often too abstract to be motivating. Adding optional intermediate milestones — say, €100k by 2027, €300k by 2030 — keeps the progress indicator meaningful at every stage of the journey and makes it easier to spot if the pace is slipping before it becomes a hard-to-recover problem.

### Multi-account & Reporting

- ~~**Account country field & analytics donut**~~ ✅ — Accounts carry an optional country field (surfaced in the account dialog with autocomplete). The Analytics allocation section shows a "By country" donut that groups the latest snapshot balances by account country, and the Accounts donut supports a group-by toggle: by account, by country, or by account type.

- ~~**Account groups**~~ ✅ — Accounts can be grouped by purpose ("Retirement", "Liquid savings") to enable richer views: net worth by group, contribution budget per group, and forecast by group.

- ~~**Annual portfolio report**~~ ✅ — A "Annual portfolio report" card in Settings → Advanced lets the user select a calendar year and download a self-contained HTML file containing net worth, holdings, dividends, interest, realised gains, and a tax summary. The file has no external dependencies and can be printed to PDF from any browser.

### Developer Experience

- ~~**End-to-end tests (Playwright) — comprehensive coverage**~~ ✅ — Playwright E2E suite provides full coverage of all major app flows: smoke tests, snapshot/transaction CRUD and bulk delete, CSV import (preview/confirm/cancel/invalid-date/duplicate), settings (accounts CRUD, holdings CRUD, contributions, calc assumptions, portfolio behavior alerts and reinvestment rules, goals with milestones edit/delete), portfolio and analytics data assertions, portfolio sub-view navigation (holdings/contributions/dividends), transaction type and search filtering, net worth range toggles, annual report download and backup/restore round-trip, empty states across all tabs, keyboard accessibility (Escape closes all dialogs), config history, global shell behavior (theme persistence, auth state transitions, offline navigation), and resilience scenarios. CI runs cross-browser (Chromium, Firefox, WebKit) via a matrix strategy with video capture on first retry.

- ~~**Schema migration dry-run**~~ ✅ — Schema migrations run automatically on DB load and are irreversible once applied. The only way to test a new migration today is to apply it against real data or a manually prepared test fixture. A `yarn db:migrate-dry` CLI script that clones the database in memory, runs the pending migrations, and reports success or failure before any real write would make it safe to iterate on migrations during development without risking data loss.

---

## Long-term (9+ months)

Focus: broader data support.

### Data & Storage

- **Multi-currency support** — The app is currently EUR-only. Transactions already carry a per-row `fxRate` imported from broker CSVs, so foreign-currency trades are handled correctly. The missing piece is snapshots: each monthly balance is entered as a single number with no currency context, so a non-EUR savings account must be mentally converted before entry, and that conversion is lost forever. The fix is to add a per-account currency setting and a per-snapshot FX rate field: when logging a monthly snapshot, the user enters the spot rate for each non-base-currency account, and all KPI calculations use that stored rate. No external API is needed — the user supplies the rate at entry time, exactly as they already do for transaction imports. The implementation should be simple and not attempt to auto-fetch rates.
