# Roadmap

Wealth Tracker remains a self-hosted, client-only PWA. Core tracking must work
offline. External data is an optional, cached, on-demand enhancement, not a
requirement for opening or editing a portfolio.

## Open work

These are candidates, not delivery commitments.

- **Chart accessibility:** provide keyboard access to the in-canvas toolbox.
  The chart data table and HTML legend are the current accessible alternatives.
- **Configurable reporting currency:** native account currencies and month-end
  snapshot conversion already work, but calculation/display currency is fixed
  to EUR. Any change needs a plan for historical transaction rates and snapshots,
  not just a display setting.
- **ETF mergers:** implement and verify cost-basis carryover for multi-leg fund
  mergers before relying on `foldInto`. Current affected results require checking
  against broker statements.

## Product discovery decisions

- **Cash-flow calendar: discarded.** Existing investment transaction history is
  not a household recurring-payment feed. Manually maintaining rent, fixed costs
  and payment schedules would add complexity without enough value. No calendar,
  recurring-payment ledger or household budgeting work is queued.
- **Additional allocation/diversification views: not pursued.** Analytics already
  groups accounts by account, country, group and type, and holdings by asset class,
  region and holding. Holding allocation is cost-based, not current market
  exposure; another donut would not resolve that distinction or reveal ETF
  look-through overlap.
- **Return correlation: deferred.** It could reveal funds moving together, but
  its incremental value is unproven and the current data model lacks verified,
  aligned per-holding total-return histories. Position-value changes include
  trades and are not returns. Revisit only with a useful user decision and a
  maintainable data source; no score, feed or correlation pilot is queued.
- **Property scope: informational first.** Focus on a home, shared ownership,
  inherited property or a house under construction; check that two or three
  properties remain understandable without landlord-management features. Track
  estimated owned value and personally attributable outstanding mortgage debt,
  not rent, bills or individual repayments. Exclude mortgage simulation,
  automatic appreciation, future inheritance and assumed finished-house values
  from the initial feature. Do not treat property as an ordinary investment account
  or pension that unlocks into spendable cash. The implemented register uses
  occasional manual balance confirmation, not recurring payment entry. The
  [standalone UI pilot](docs/property-pilot.html) remains a fictional-data
  discovery reference, separate from the live feature.

## Delivered capabilities

Current behavior and usage belong in the [README](README.md), not a phase log.
The app already includes:

- CSV preview/error recovery, monthly snapshots with notes and account-linked
  ETF valuations, manual transactions and bulk deletion.
- Account lifecycle, groups/countries, holding notes/TER/targets, contribution
  planning, goals/milestones, forecast scenarios and annual HTML reports.
- Optional property management in Settings and a secondary Net worth overview,
  hidden when empty. Beginner-friendly entry shows owned value minus remaining
  personal mortgage debt, with dates, unknown-debt handling and signed equity.
  The versioned register uses existing local persistence, Drive sync and JSON
  backup/restore. Property remains outside all financial-account calculations,
  goals, returns, forecasts, retirement calculations and annual reports.
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
