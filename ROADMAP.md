# Roadmap

This document outlines planned improvements to Wealth Tracker across three horizons. Items within each horizon are roughly ordered by impact and effort. The app is a self-hosted, client-only PWA; every feature must remain offline-capable and store only data that the user provides — no external price APIs or third-party data feeds.

---

## Short-term (next 1–3 months)

Focus: polish, usability gaps, and the most-requested missing pieces.

### Import & CSV
- **Broker profile manager in UI** — allow adding, editing, and removing custom import profiles from the Settings screen instead of editing source code.
- **Additional broker profiles** — add out-of-the-box profiles for common European brokers not yet covered (Degiro, Interactive Brokers, Scalable Capital) so new users do not need to create mappings manually.
- **Import error recovery** — show a row-level diff after a failed import attempt so the user can download only the rejected rows as a corrected CSV.

### Snapshots & Net Worth
- **Snapshot notes in the timeline chart** — surface the `notes` field as a visible marker or tooltip directly on the net-worth history chart (currently notes are shown only in the detail card below the chart), so context like "sold car" or "bonus received" is reachable without scrolling.
- **Bulk snapshot delete** — add a management table in Settings > Snapshots to delete one or more historical entries, which is useful after an accidental duplicate import.

### Portfolio & Holdings
- **Holding TER summary** — compute and display the weighted-average TER of the active portfolio on the Holdings card header, given that `ter` is already stored per holding.
- **Per-holding notes field** — add an optional free-text note on each holding configuration row (e.g. "index change expected Q3").

### UX / Accessibility
- **Keyboard navigation for modals** — trap focus within open modals and restore focus to the trigger element on close.

---

## Medium-term (3–9 months)

Focus: deeper analytics, richer planning, and cross-device experience.

### Analytics
- **Tax report view** — a dedicated tab or export (CSV/PDF) summarising realised capital gains, dividends, interest, and withheld tax per calendar year, grouped by account and ISIN, to simplify annual tax filing. Data is derived entirely from imported transactions.
- **Benchmark comparison** — overlay a reference return series on the growth and annual-returns charts. The series would be user-supplied (e.g. a CSV with monthly index returns) so no external API is required.
- **Correlation / diversification score** — compute pairwise return correlation between holdings from existing snapshot and transaction data, and surface a simple diversification score to highlight concentration risk.
- **Cash-flow calendar** — a monthly view showing projected dividends, interest payments, and scheduled contribution transfers, bridging the existing `divHist`/`intHist` data and the forecast model.

### Planning & Forecasting
- **Scenario comparison** — allow defining two or three named scenarios (e.g. "base", "conservative", "optimistic") with different return and contribution assumptions and render all curves on the same forecast chart.
- **Goal milestones** — allow each `NamedGoal` to carry intermediate milestone amounts so the progress bar can show percentage-to-next-milestone rather than a flat distance to the final target.

### Multi-account & Reporting
- **Account groups** — allow tagging accounts as belonging to a named group (e.g. "Retirement", "Emergency fund") and aggregate KPIs and charts by group in addition to individually.
- **PDF/HTML snapshot report** — a one-click export of the current net-worth and portfolio state as a printable HTML page or PDF, suitable for sharing with a financial adviser.
- **Recurring transaction templates** — define a recurring transaction (e.g. a monthly dividend from a fixed-income ETF) that auto-populates the import preview without needing a CSV file.

### Developer Experience
- **End-to-end tests (Playwright)** — add a minimal E2E suite covering the critical import → snapshot → analytics path, running in CI alongside the existing unit tests.
- **Schema migration dry-run** — add a CLI script (`yarn db:migrate-dry`) that applies pending migrations against a copy of the database and reports success or failure without touching the real data.

---

## Long-term (9+ months)

Focus: extensibility, collaboration, and broader platform support.

### Data & Storage
- **Multi-currency base currency** — allow choosing a base currency other than EUR; all KPIs and charts recalculate using user-supplied FX rates (importable as a CSV), making the app fully usable for non-EUR investors.
- **Alternative sync backends** — offer Dropbox or a self-hosted WebDAV endpoint alongside Google Drive so users not in the Google ecosystem can still sync across devices.

### Collaboration & Multi-user
- **Household / partner view** — a lightweight mode where two Drive accounts share a single database file (with conflict resolution) to track a joint portfolio.
- **Read-only share link** — generate a signed, time-limited static export that a user can share with an adviser or family member without granting Drive access.

### Extensibility
- **Plugin / custom view API** — expose a stable JS interface for user-defined chart panels and metric tiles, loaded from a URL or pasted script, so power users can add bespoke views without forking the repo.
- **Mobile app (PWA-first)** — polish the responsive layout for small screens, add home-screen install prompts, and implement a simplified quick-log flow optimised for one-handed entry on a phone.
- **Voice / conversational entry** — an optional natural-language entry mode ("Add €500 IWDA buy at €95.20") that parses a free-text input and pre-fills the log modal.

### Observability & Operations
- **Self-hosted telemetry** — an opt-in, privacy-preserving usage counter (page views, feature flags used) posted to a self-owned analytics endpoint, so the author can prioritise features based on actual usage without third-party trackers.
- **Automated backup verification** — a scheduled Drive function (Cloud Run job or similar) that downloads the DB, runs a schema validation, and sends a notification if the backup is stale or corrupt.
