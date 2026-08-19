# Roadmap

This document outlines planned improvements to Wealth Tracker. Items are roughly ordered by impact and effort. The app is a self-hosted, client-only PWA; every feature must remain offline-capable. External data integrations are limited to strictly on-demand fetches where the benefit is clear and the data is cached locally — no background polling, no live price feeds, no dependency on external uptime for core functionality.

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

- **Multi-currency support** — The app is currently EUR-only. Transactions already carry a per-row `fxRate` imported from broker CSVs, so foreign-currency trades are handled correctly. The missing piece is snapshots: each monthly balance is entered as a single number with no currency context, so a non-EUR savings account must be mentally converted before entry, and that conversion is lost forever. The fix is to add a per-account currency setting and make snapshot normalization use the FX rate for the last day of the applicable month. That month-end lookup should stay completely hidden from users: they enter balances in the account's own currency, and the app resolves and stores the needed FX context behind the scenes as the long-term canonical behavior.

### External Data Integration (POC)

The app is intentionally slim and offline-capable. External data fetching remains limited to two strictly on-demand integrations: FX rate help and ETF metadata enrichment. No background polling, no scheduled jobs, no live price feeds, and no dependency on external uptime for core portfolio tracking. All fetched data must be cached locally so the app continues to work offline after the first successful lookup.

> **POC scope** — these two integrations will be evaluated together. If either proves unreliable, too complex, or of limited practical value, it will be dropped. The rest of the app must remain fully functional without them.

#### Delivery principles

- Validate each provider contract before schema or UI work is finalized. Assumptions about endpoints, payload shapes, rate limits, and fallback semantics must be verified against provider docs first.
- Keep manual user data authoritative. External data may prefill, enrich, or normalize, but must not silently overwrite user-entered values.
- Treat fetched data as optional enhancements. Missing API data must degrade gracefully to existing local behavior.
- Persist cache provenance, including the requested identifier/date, the provider's effective date/value where relevant, and the local fetch timestamp.
- Keep secrets out of backups and source control. Any API credential storage needs explicit redaction/export rules.
- Deliver in small phases so each step can ship independently without blocking core usage.

#### FX rates — Frankfurter (ECB-sourced, no API key)

**Service candidate:** [Frankfurter](https://frankfurter.dev) — open-source, ECB-backed, no authentication, with a public API at `https://api.frankfurter.dev`.

**Why:** Transaction imports from brokers already carry `fxRate`, but users may need help validating or filling missing FX context. Snapshot normalization also needs a consistent historical rate when account balances are entered in a non-reporting currency.

**Planned direction:**

- Add a dedicated `fx_rates` cache keyed by requested currency pair and date, with provider response metadata.
- Keep the integration latent in single-currency setups: if all accounts and transactions are already in the reporting currency, no FX UI appears and no call is made.
- Resolve cache first, then fetch only the exact dates and pairs needed by transaction entry, imports, or snapshot storage.
- Keep `fxRate` editable by the user. Provider values are suggestions or normalization inputs, not locked values.
- Use the same FX cache for both transaction assistance and snapshot normalization, so the app has one auditable source of historical conversion context.

#### ETF metadata — Financial Modeling Prep (FMP, free API key)

**Service candidate:** [Financial Modeling Prep](https://financialmodelingprep.com) — free tier, ISIN search support, and ETF-oriented endpoints.

**Why:** Holdings already store manual portfolio configuration (`name`, `shortName`, `TER`, `asset class`, `region`, `notes`). External metadata is only justified where it adds clear analytical value that cannot be inferred from the user's own ledger.

**Metadata direction:**

- Keep externally fetched metadata in a separate `holding_metadata` store rather than merging it into the manual holding contract.
- Prioritize fields that enable analysis or validation: ticker/symbol, exchange, domicile/country, fund currency, AUM, inception date, holdings count, sector or industry classification where useful, and top underlying positions.
- Deprioritize low-value fields such as long descriptions or latest prices unless a later view proves they are useful.
- Display fetched metadata as read-only supporting context, ideally in a collapsed section, so the core holding dialog stays focused.
- Support one-off per-holding refresh plus a bulk enrichment action for holdings that do not yet have metadata.

#### Phased implementation roadmap

##### Current execution status (split by integration track)

This status is intentionally split so progress is not conflated across providers.

**Track 1 — Frankfurter (FX)**

- **Phase 1 (contract validation and scope freeze)** — ✅ done.
- **Phase 2 (storage and provider infrastructure)** — ✅ done (storage/cache + backup path + integration enablement setting + telemetry storage).
- **Phase 3 (domain and service wiring)** — ✅ done (provider + service + shared FX resolution + snapshot normalization at save time).
- **Phase 4 (application integration and regression-safe rollout)** — ✅ done (FX-normalized values threaded through net worth KPIs, analytics account donut, and annual report; backup/restore of `fx_rates` cache wired).
- **Phase 5 (UI rollout)** — ✅ done (account currency field + datalist in account dialog; snapshot dialog shows per-account currency labels, live FX hint with rate, currency-specific placeholder, and month-end prefetch status; Settings integrations card with toggle and telemetry).
- **Phase 6 (tests and hardening)** — ✅ done (unit tests for snapshotFx normalization and annual report currency threading; E2E tests for FX integrations card, mixed-currency snapshot flow, net worth KPI currency indicator, and snapshot dialog placeholder).

**Track 2 — FMP (ETF metadata)**

- **Phase 1 (contract validation and scope freeze)** — ✅ done.
- **Phase 2 (storage and provider infrastructure)** — ✅ done.
- **Phase 3 (domain and service wiring)** — ✅ done.
- **Phase 4 (application integration and regression-safe rollout)** — ✅ done.
- **Phase 5 (UI rollout)** — ✅ done.
- **Phase 6 (tests and hardening)** — ✅ done.

**Current stack anchor for follow-up agents**

- **Branch:** `copilot/fxrate-external-integrations`
- **PR:** [#207](https://github.com/ivangonzalezacuna/wealth-tracker/pull/207)
- **Rule:** every next PR in this phase stack must be opened from the previous phase branch/PR head so the chain stays linear and reviewable.

**Stacked PR sequence (Frankfurter track)**

1. **PR A — Phase 2 completion:** finish remaining FX storage/config/backup/telemetry pieces. ✅ Done.
2. **PR B — Phase 3 completion + Phase 4/5 partial (based on PR A):** complete FX model/service wiring for snapshot normalization and shared lookup paths; backup/restore of fx_rates cache; account currency UI; snapshot dialog FX hints and prefetch status; Settings integrations card. ✅ Done.
3. **PR C — Phase 4 completion (based on PR B):** thread FX-normalized values through net worth, analytics, and reporting consumers.
4. **PR D — Phase 5 completion (based on PR C):** any remaining snapshot-entry UX polish and FX-related UI gaps.
5. **PR E — Phase 6 hardening (based on PR D):** finalize unit/integration/Playwright coverage and resilience checks for FX behavior.

**Later (separate stack): ETF/FMP track**

- ETF metadata work follows the same phase structure, but starts only after the Frankfurter stack lands.
- Use a fresh stack anchor (new branch + new base PR) dedicated to ETF/FMP so reviews stay isolated from FX changes.

##### Phase 1 — contract validation and scope freeze

- Verify the exact Frankfurter endpoints, response fields, business-day fallback behavior, and supported query patterns before encoding them into code or migrations.
- Verify the exact FMP endpoints and payloads needed to map `ISIN -> symbol -> profile/info/holdings`, then trim the metadata field list to the subset that adds real user value.
- Keep the canonical snapshot valuation rule for FX lookup fixed to month-end. Because snapshots are stored by month (`YYYY-MM`), the app should derive the FX lookup date as the last day of that month without changing the persisted snapshot key unless a broader migration proves worthwhile, and that detail should remain completely hidden from users.
- Decide how API credentials are stored, redacted from backups, and surfaced in settings without leaking secrets.
- Confirm which analytics or read-only UI surfaces will consume holding metadata in the first release, so schema stays minimal.

##### Phase 2 — storage and provider infrastructure

- Add the new persistence layer for `fx_rates` and `holding_metadata`, including provenance fields, refresh timestamps, and enough status data to tell whether a record is complete or stale.
- Add the minimal settings/config surface for integration enablement and credential presence without coupling it to the existing config history audit log.
- Add backup/restore rules so integration caches and metadata can be restored locally, while secrets remain excluded or redacted.
- Add lightweight integration telemetry storage for operational status (for example last successful fetch, last error, request counts, cache coverage), kept separate from config history.

##### Phase 3 — domain and service wiring

- Centralize FX lookup, caching, and normalization behind one service layer reused by imports, manual transaction entry, and snapshots.
- Extend snapshot handling so balances can be entered in the account's own currency and normalized using stored FX context at save time.
- Add a metadata enrichment service for holdings that fetches, validates, and stores additive metadata without changing the manual holding source of truth.
- Ensure every integration pathway remains optional and failures fall back to the current offline-first behavior.

##### Phase 4 — application integration and regression-safe rollout

- Thread the new snapshot and metadata model through net worth, analytics, reporting, backup/restore, and any summary cards that depend on canonical account values.
- Avoid view-specific workarounds; push normalization and metadata resolution into shared model/storage layers so behavior stays consistent across the app.
- Preserve existing behavior for EUR-only users and portfolios that never opt into external integrations.
- Keep migrations additive and reversible in spirit: existing databases should continue to open cleanly and continue to produce the same results until users opt into the new data paths.

##### Phase 5 — UI rollout

- Extend the existing dialog autocomplete/datalist pattern in the account dialog where it improves currency or institution entry, rather than introducing a new input model just for this feature.
- Update the snapshot dialog so the user enters balances in the correct account currency while the app resolves and stores the needed FX context during save.
- Add read-only, collapsible metadata display to the holding dialog so enriched fields are visible without polluting the default editing experience.
- Add an integrations area in Settings for API configuration, enrichment actions, cache state, and lightweight operational analytics such as request counts, last success, and last refresh.
- Keep every integration control explicitly user-driven: fetch, refresh, enrich, and retry actions should happen only on demand.

##### Phase 6 — tests and hardening

- Add unit coverage for provider response parsing, cache hit/miss logic, month-end FX resolution rules, secret redaction, and migration behavior.
- Add integration-level tests for snapshot normalization, manual override behavior, holding metadata enrichment, and backup/restore of the new non-secret data.
- Extend Playwright coverage for account currency flows, snapshot entry with FX assistance, holding metadata display/refresh, and settings integration controls.
- Validate that the app still behaves correctly with no API key, offline mode, empty caches, stale metadata, and provider errors.
