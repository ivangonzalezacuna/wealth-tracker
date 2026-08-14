# Roadmap

This document outlines planned improvements to Wealth Tracker across three horizons. Items within each horizon are roughly ordered by impact and effort. The app is a self-hosted, client-only PWA; every feature must remain offline-capable and store only data that the user provides — no external price APIs or third-party data feeds.

---

## Short-term (next 1–3 months)

Focus: polish, usability gaps, and the most-requested missing pieces.

### Import & CSV

- **Broker profile manager in UI** — Currently, adding or tweaking a custom import profile requires editing TypeScript source files and redeploying. Most users running self-hosted instances cannot or do not want to do that. A Settings screen for profile management (add, rename, edit column mappings, delete) would make the import system fully accessible without touching code, which is the right abstraction for a personal-finance tool meant to outlive any single broker's CSV format.

- **Additional broker profiles** — Trade Republic and N26 are already covered, but Degiro, Interactive Brokers, and Scalable Capital are among the most common European brokers that prospective users are likely switching from. Shipping their profiles out of the box eliminates the most common first-use friction: getting data in on day one.

- **Import error recovery** — When a CSV batch fails to parse (wrong date format, unrecognised type, garbled number), the current flow shows aggregate error counts but does not let the user isolate and fix individual bad rows. A row-level error diff that can be exported as a pre-filtered CSV lets the user fix only the problem rows and re-import them, rather than fixing the entire source file and re-importing everything.

### Snapshots & Net Worth

- **Snapshot notes in the timeline chart** — The `notes` field exists on every snapshot and is already indexed for search in the log view. However, it only appears in the detail card below the history chart, which means the user has to scroll away from the chart to see the annotation for a given month. Surfacing notes as small markers or chart-tooltip additions keeps the visual narrative intact — a spike in net worth in March 2024 should be immediately explainable without leaving the chart.

- **Bulk snapshot delete** — The only way to remove a snapshot today is to open it individually from the log and delete it one at a time. After a mistaken double-import or a data-cleanup exercise, users can end up with dozens of duplicate or erroneous entries. A management table with multi-select and bulk-delete reduces what is currently a tedious manual task to a few clicks.

### Portfolio & Holdings

- **Holding TER summary** — The total expense ratio is already stored per holding (`ter` column), but there is no aggregated view. A weighted-average TER for the active portfolio, shown on the Holdings card header, gives an immediate cost-of-ownership signal. It is particularly useful when deciding between two similar ETFs or when the portfolio drifts toward higher-cost holdings over time.

- **Per-holding notes field** — Holdings evolve: an ETF might announce an index change, a merger, or a redenomination. Right now there is no place inside the app to record that context, so it lives in a separate spreadsheet or gets forgotten. A simple optional notes field on each holding configuration row provides the right home for forward-looking reminders and post-hoc explanations without adding schema complexity.

### UX / Accessibility

- **Keyboard navigation for modals** — The app is increasingly used by keyboard-heavy users and is also subject to WCAG compliance expectations as a financial tool. Currently, opening a modal (snapshot dialog, account editor, import flow) does not trap focus within it, which means Tab can move focus to behind-the-modal elements that are visually inaccessible. Implementing a focus trap and restoring focus to the trigger element on close are the two most impactful accessibility fixes and are prerequisites for screen-reader usability.

---

## Medium-term (3–9 months)

Focus: deeper analytics, richer planning, and cross-device experience.

### Analytics

- **Tax report view** — The app already imports and stores dividends, interest, realised gains, and withheld taxes as transactions. What it does not yet do is aggregate them into the per-calendar-year summary that most European tax systems require. A dedicated view (and ideally a CSV export) showing gross income, withheld tax, realised capital gains, and net amounts per year and per ISIN would make the app materially useful at filing time. All the data is already in the database; this is a presentation and aggregation feature, not a data-collection one.

- **Correlation / diversification score** — Knowing the allocation percentages of your holdings is not the same as knowing how correlated they are. Two holdings with identical target allocations can either hedge each other or move in lockstep. Using the monthly return series already computed from snapshots and transactions, the app can estimate pairwise correlations between holdings and produce a simple portfolio-level diversification score. The goal is not to replicate a quant tool but to surface an early-warning signal when the portfolio is effectively concentrated in one factor.

- **Cash-flow calendar** — The app already separates dividends, interest, and contributions in the data model and in individual views. What is missing is a forward-looking, time-indexed view that shows projected income and scheduled outflows month by month: expected next dividend from each holding (extrapolated from historical frequency), contribution execution dates, and interest payment estimates. This bridges the portfolio's past (transaction history) with its future (forecast model) in a practical, action-oriented format.

### Planning & Forecasting

- **Scenario comparison** — The current forecast chart shows a single projection based on the configured return assumptions. In practice, users think in terms of "what happens if returns are lower than expected" or "what if I increase contributions by €200/month". Defining two or three named scenarios side by side on the same chart gives a much more honest and actionable picture of the uncertainty range, without requiring a separate spreadsheet.

- **Goal milestones** — The existing `NamedGoal` type supports a target amount and target date, and the Net Worth tab renders a progress bar toward the final target. For long-horizon goals (e.g. a 20-year retirement target), the distance to the end is often too abstract to be motivating. Adding optional intermediate milestones — say, €100k by 2027, €300k by 2030 — keeps the progress indicator meaningful at every stage of the journey and makes it easier to spot if the pace is slipping before it becomes a hard-to-recover problem.

### Multi-account & Reporting

- **Account groups** — As portfolios grow, accounts multiply: a primary investment account, a pension, an emergency fund, a partner's savings account. The existing account list is flat, and KPIs roll up everything together or show individual accounts. Grouping accounts by purpose ("Retirement", "Liquid savings", "Joint") would allow a richer set of views: net worth by group, contribution budget per group, forecast by group. The data model change is a metadata tag on each account; the rendering impact is much larger.

- **PDF/HTML snapshot report** — Sharing the current state of a portfolio with a financial adviser, a bank, or a family member today requires copying numbers manually or screenshotting. A one-click export of the current net-worth and portfolio state as a cleanly formatted HTML page (printable to PDF via the browser) would make this a two-step operation. The data is already available in-memory on every page render; this is primarily a templating and layout task.

- **Recurring transaction templates** — Some income streams are predictable and regular: a monthly dividend from a fixed-income ETF, a quarterly interest credit, an annual employer share grant. Defining a template for these (amount, type, ISIN, interval) would let the app pre-populate an import preview on demand, reducing the monthly data-entry chore for users whose brokers do not export a useful CSV.

### Developer Experience

- **End-to-end tests (Playwright)** — The existing test suite covers unit logic and view rendering thoroughly, but there are no tests that exercise the full browser flow: open the app, import a CSV, add a snapshot, navigate to analytics. Regressions in the interaction between components (e.g. an import that updates the portfolio but does not trigger a re-render of the analytics chart) are invisible to the current suite. A minimal Playwright E2E suite covering the critical paths would catch those integration failures in CI before they reach production.

- **Schema migration dry-run** — Schema migrations run automatically on DB load and are irreversible once applied. The only way to test a new migration today is to apply it against real data or a manually prepared test fixture. A `yarn db:migrate-dry` CLI script that clones the database in memory, runs the pending migrations, and reports success or failure before any real write would make it safe to iterate on migrations during development without risking data loss.

---

## Long-term (9+ months)

Focus: extensibility, collaboration, and broader platform support.

### Data & Storage

- **Multi-currency base currency** — The app is currently EUR-only. Transactions already carry a per-row `fxRate` imported from broker CSVs, so foreign-currency trades are handled correctly. The missing piece is snapshots: each monthly balance is entered as a single number with no currency context, so a USD savings account must be mentally converted to EUR before entry, and that conversion is lost forever. The fix is to add a per-account currency setting and a per-snapshot FX rate field: when logging a monthly snapshot, the user enters the spot rate for each non-EUR account (e.g. 1 USD = 0.92 EUR), and all KPI calculations use that stored rate. No external API is needed — the user supplies the rate at entry time, exactly as they already do for transaction imports.

- **Alternative sync backends** — Google Drive is the only sync backend today, which limits the app to users with a Google account. Dropbox has a similar AppData-scoped API and would cover a large part of the non-Google userbase. A self-hosted WebDAV endpoint would cover privacy-sensitive users running their own Nextcloud or similar. The sync layer is already abstracted behind `uploadDbFile` / `downloadDbFile` interfaces in `src/sync/drive.ts`; swapping in a different backend would be largely confined to that module.

### Collaboration & Multi-user

- **Household / partner view** — Two people managing a joint portfolio today must either share a single Google account (bad for privacy) or maintain two separate databases and reconcile manually. A lightweight shared-DB mode — where both users authenticate with their own Google account but point at a shared Drive file — would make the app suitable for couples or housemates tracking combined finances. The main technical challenge is conflict resolution when both parties write simultaneously; a last-write-wins strategy with a merge log would handle the common case.

- **Read-only share link** — Users occasionally need to share their financial picture with a third party (an IFA, a mortgage broker, a family member) without giving them write access or exposing their Google credentials. A time-limited, signed static export — essentially a frozen HTML snapshot of the current state — would satisfy that use case. It requires no server-side infrastructure: the export can be generated entirely in-browser and uploaded to Drive as a separate file, with a shareable link.

### Extensibility

- **Plugin / custom view API** — Power users routinely request custom charts or metrics that are specific to their portfolio structure (e.g. a custom asset-class breakdown, a net-worth-per-square-metre property tracker, a side-by-side comparison with a partner's portfolio). Rather than merging niche features into the main codebase, a stable JS interface for user-defined panels — loaded from a pasted script or a URL — would let advanced users extend the app without forking it. The risk is security (arbitrary script execution), which would need to be sandboxed in an iframe or handled via a content-security-policy exception controlled by the user.

- **Mobile app (PWA-first)** — The app is a PWA and installs on mobile today, but the layout is not optimised for small screens: the snapshot log modal, the settings forms, and the chart cards are all designed primarily for desktop widths. A mobile-first pass would make the monthly data-entry workflow (the most time-sensitive interaction) completable in under a minute on a phone, and would add a simplified quick-log shortcut directly on the home screen. The app already registers a service worker and supports offline use, so the infrastructure is in place.

- **Voice / conversational entry** — Logging a transaction or a snapshot requires navigating a modal form with multiple fields. A natural-language entry shortcut ("Add €500 IWDA buy at €95.20 on 12 Aug") that parses the input and pre-fills the relevant modal would reduce the per-transaction entry time significantly, especially on mobile. This is a UX convenience feature that builds on the existing import and transaction-dialog infrastructure rather than replacing it.

### Observability & Operations

- **Self-hosted telemetry** — The app has no analytics today, so feature prioritisation is based on intuition rather than data. An opt-in counter (which sections are visited, which features are used, how often the import flow fails) posted to a self-owned endpoint (e.g. a simple Cloudflare Worker writing to KV) would provide signal without depending on third-party trackers or storing any personal data. The opt-in must be explicit and auditable, and the payload must contain no portfolio data.

- **Automated backup verification** — The Google Drive sync gives users a cloud backup, but there is currently no check that the backup is intact and up to date. A scheduled Cloud Run job that authenticates with the app's Drive scope, downloads the DB, runs a schema validation, checks the `modified_at` timestamp, and sends a notification (email, webhook) if the backup is stale or corrupt would close the loop on data durability. This is particularly important for users who go weeks or months without opening the app — by the time they notice the backup is broken, the local copy may also be gone.
