# Roadmap

Wealth Tracker remains a self-hosted, client-only PWA. Core tracking must work
offline. External data is an optional, cached, on-demand enhancement, not a
requirement for opening or editing a portfolio.

## Open work

These are candidates, not delivery commitments.

- **Chart accessibility:** provide keyboard access to the in-canvas toolbox.
  The chart data table and HTML legend are the current accessible alternatives.
- **Diversification analysis:** evaluate whether correlations from sufficiently
  complete per-holding return histories can provide a useful concentration
  warning. Validate data quality and interpretation before adding a score.
- **Cash-flow calendar:** explore projected dividends, interest and scheduled
  contributions in one monthly view. Distinguish estimates from recorded income.
- **Configurable reporting currency:** native account currencies and month-end
  snapshot conversion already work, but calculation/display currency is fixed
  to EUR. Any change needs a plan for historical transaction rates and snapshots,
  not just a display setting.
- **ETF mergers:** implement and verify cost-basis carryover for multi-leg fund
  mergers before relying on `foldInto`. Current affected results require checking
  against broker statements.

## Delivered capabilities

Current behavior and usage belong in the [README](README.md), not a phase log.
The app already includes:

- CSV preview/error recovery, monthly snapshots with notes and account-linked
  ETF valuations, manual transactions and bulk deletion.
- Account lifecycle, groups/countries, holding notes/TER/targets, contribution
  planning, goals/milestones, forecast scenarios and annual HTML reports.
- Interactive ECharts charts and shared dialog keyboard/focus handling.
- Local-first persistence, explicit sync-conflict recovery and JSON backup/restore.
- Frankfurter FX caching, native account-currency entry, month-end normalization,
  missing-rate validation and integration status/telemetry.
- Local German Trade Republic statement PDF import through a shared parser and
  account-mapping pipeline. See [supported limits](docs/pdf-snapshot-import.md).
- Unit/DOM tests, cross-browser Playwright checks, production PDF/CSP/offline
  checks and a pending-schema-migration dry-run command.

## Integration decisions

**Frankfurter FX:** retained. Resolve the exact required currency pair/date from
cache first, then fetch on demand. Preserve provider effective dates and local
fetch timestamps. Manual/broker rates remain authoritative. Unavailable rates
must not silently turn foreign balances into EUR.

**ETF metadata APIs (FMP and alternatives):** dropped. Reliability and maintenance
cost did not justify the value. No metadata enrichment phases are queued.

Live price feeds, scheduled data-fetching jobs and background FX polling remain
out of scope. Keep any future integration decision separate from the FX track.
