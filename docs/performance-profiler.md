# Temporary performance profiler

The profiler is an opt-in diagnostics feature for collecting local, observational performance data while testing the PWA. It is disabled by default and does not upload profiler records to Google Drive or another service.

## Enable and open diagnostics

Set the Vite environment variable before building or starting the app:

```env
VITE_ENABLE_PROFILING=true
```

Builds automatically use Netlify's `COMMIT_REF`, GitHub Actions' `GITHUB_SHA`, or the local Git HEAD, in that order. You can override that identity with a release label:

```env
VITE_BUILD_ID=release-1.2.3
```

The app version still comes from `package.json`; it need not change for every deployment. The app version and commit-based build ID together identify a release. Remove any old fixed `VITE_BUILD_ID` override to enable automatic commit IDs. If neither deployment metadata nor Git is available, the build warns and uses `local-unversioned`; set an explicit ID in that environment. Set variables in `.env.local` or the hosting provider's build environment. The feature flag is evaluated at build time.

With profiling enabled, open the three-dot header menu and choose **Performance diagnostics**. The page can filter measurements by the last 7, 30, or 90 days, inclusive UTC dates, individual run, category, route, and release. It can compare two releases and export the current filtered report as JSON. The app continues to work if profiler storage is unavailable; the diagnostics page reports storage or export errors rather than silently presenting a successful result.

## What is measured

The profiler records measurements in these categories:

- **Vitals:** CLS, FCP, INP, LCP, and TTFB from `web-vitals`, including soft-navigation reporting where supported by the browser.
- **App, route, and render:** startup, navigation, route changes, render timing, and relevant browser lifecycle transitions.
- **Database:** SQLite IndexedDB persistence and selected transaction and snapshot repository operations.
- **Drive and sync:** request timing, outcome, retries, payload size, total sync duration, and time spent waiting for pending sync work.
- **Browser and errors:** selected browser performance observations, resource metadata, JavaScript errors, and unhandled promise rejections.

Startup reporting separates `first-render-complete` (synchronous section render completion since app-module initialization) from `first-frame-delay-visible` and `first-frame-delay-hidden` (the subsequent animation-frame wait). The hidden variant means the document was hidden at some point during that wait. Both retain the route captured at render completion. These are scheduling/render markers, not proof that all deferred charts or asynchronous data work have finished. Older `first-usable-render` samples included the frame wait; do not directly compare them with the new completion metric.

Known ResizeObserver loop notifications are counted separately as browser `resize-observer-loop` events, rather than ordinary `javascript-error` events. They remain visible diagnostics, not suppressed errors. Other error messages and stack traces are not retained.

The UTC date and run filters apply to the page and exported report, including release comparisons. Run identifiers stay local and are not exported. The export records the chosen date bounds and whether a single run was selected. Use a single run or a date range to avoid mixing older activity with a new test session.

INP reports include separate distributions for input delay, processing duration and presentation delay, plus allowlisted interaction/load-state counts. These components are aggregated independently; their percentiles must not be added together. No selectors, interaction targets or user content are included.

Startup records also include `startup-hidden-time` before first render, `sign-in-requested` (elapsed module time until the user requests connection), `auth-token-ready` (popup/token wait), `local-data-ready`, and `initial-data-load`. Cache lookup remains `cache-boot`. These phases may overlap and are not additive. A long first-render interval can include waiting for a user to sign in, rather than blocking JavaScript. Net Worth rendering has separate history, goals, planning and forecast-calculation markers; nested markers likewise must not be added to their parent durations.

If the profiler chunk finishes loading after the first section render, that completion retains its original timestamp and is published when the profiler becomes ready. Its frame-delay marker includes the wait for profiler initialization and the subsequent scheduled animation frame; it is not proof of when the first actual paint occurred.

Durations are milliseconds unless a report row specifies another unit. Payload sizes are bytes. The diagnostics page reports sample counts and distributions, including median, p75, p95, and maximum when applicable. It also shows success and failure counts, retry counts, or average payload size for operations that provide those values.

These are real-user browser observations, not controlled benchmarks. Results depend on the device, browser, network, app state, and workload. Use normal representative activity for a release comparison, and treat small samples as directional. In particular, p75 values based on fewer than 20 samples are marked descriptive. A comparison shows differences in measured medians and sample counts; it does not establish that a release caused the difference.

## Local data and privacy

Records are stored in the browser's separate IndexedDB database, `wealth-tracker-profiler`. They persist across app releases in that browser profile, but are not part of the application SQLite database, backup, or Drive sync. Retention is capped at 90 days and 10,000 records, whichever limit is reached first. Pruning occurs as records are written.

Each batch is inserted and pruned in one read-write transaction. Pruning visits expired timestamp-index keys, counts the remaining records, and deletes only the oldest overflow when the cap is exceeded. It does not walk every retained record on each batch, and concurrent batches cannot leave the store over the cap. A record exactly 90 days old is retained until it passes that boundary.

The profiler stores aggregated measurements and allowlisted metadata, not transaction, account, or snapshot contents. It does not retain full URLs, query strings, DOM selectors, error messages, or stack traces. Resource attribution is reduced to safe metadata such as resource type, and browser error records count events without storing their message. Exported JSON contains the filtered report, release/run summaries, comparisons, and recommendations, not the underlying raw records. Export size is limited to 3 MiB.

The profiler is opt-in, but its measurements can still reveal operational characteristics of the app and environment. Review the exported JSON before sharing it. Do not treat it as anonymous telemetry or include it in a public issue without checking its contents.

## Disable, remove, or clear local data

To disable collection, unset `VITE_ENABLE_PROFILING` or set it to `false`, then rebuild and redeploy. A page built without profiling omits the diagnostics menu entry and does not load the profiler. Disabling collection does not erase existing IndexedDB records.

To remove stored records, clear the site's browser storage for the relevant origin using the browser's site-data settings or developer tools. This also removes other site data, so use the browser's per-database storage controls if available and delete only `wealth-tracker-profiler`.

To remove the profiler implementation from the project, remove the performance modules and diagnostics UI, the profiler feature-gate and instrumentation call sites, the build-time profiling configuration, its dependency and tests, and this documentation. Removing the code does not automatically clear data already stored in users' browsers; the database name above can be used to identify it.

## Known limitations

- Web Vitals and browser performance APIs vary by browser. Some observations or attribution details may be unavailable.
- Soft navigations are reported where supported; this is a single-page app, so results can differ from hard page loads.
- Sync transfers a full SQLite database binary. Payload size and duration do not describe an incremental record transfer.
- A run is a page session, not a unique user. Runs from separate tabs or browser profiles are independent.
- Percentiles are descriptive summaries, especially for small or uneven samples. Compare similar devices, browsers, and workloads where possible.
- The diagnostics report is capped at 3 MiB. Narrow the date range or filters if an export exceeds the limit.

## Retention pruning comparison

The bounded implementation was compared with the original profiler storage at `512b841` in isolated local Chrome IndexedDB databases. Medians use nine operations per case against the actual implementations, with no expired records. At the cap, writes include overflow deletion. These synthetic measurements are device-specific, not field performance guarantees.

| Median measurement                                   | Original pruning | Bounded pruning |
| ---------------------------------------------------- | ---------------: | --------------: |
| Prune, 2,000 records                                 |          44.0 ms |          1.3 ms |
| Prune, 10,000 records                                |         178.4 ms |          1.5 ms |
| Write a 25-record batch, approximately 2,000 records |          89.6 ms |          4.2 ms |
| Write a 25-record batch at the 10,000-record cap     |         374.6 ms |         14.2 ms |

## Rendering quick wins and comparison

ECharts is already code-split and warmed during idle time. Secondary Analytics charts defer their first initialization until they approach the viewport (200 px margin) or receive keyboard focus. The lead net-worth growth chart and contributions chart remain eager: the latter lays out its wrapping header legend immediately, avoiding a card-height change when scrolling. Existing charts continue updating immediately; theme, resize, legend, drill-down, data-table and linked-zoom behavior remain in the shared registry. A newly initialized timeline chart inherits an earlier linked zoom. Without `IntersectionObserver`, initialization falls back to the existing eager path.

Chart wrappers reserve their plot and slider space while deferred. Pending hosts retain their accessible labels, expose `aria-busy`, and temporarily accept keyboard focus so keyboard users can initialize them too. Disposing or replacing a host cancels its request. Chunk-load failures show a message and are logged; reload the page to retry. Data calculations, storage, backup formats, Drive discovery/conflict behavior and the five-second upload debounce are unchanged.

Shared chart resize handling skips detached or hidden hosts instead of resizing them to zero and rebuilding their mobile legends. When shown again, visible resize observations still update the chart. Browsers without `checkVisibility` use laid-out rectangles as a fallback. This applies to Net Worth and Portfolio as well as Analytics.

Visible observations also skip ECharts resizing when the canvas already matches the host dimensions and display density has not changed. Returning to an unchanged page therefore retains the existing chart without an unnecessary layout/render pass. Actual size changes, compact/fullscreen/touch layout changes and wrapping legend changes still update the chart.

Analytics refreshes keep existing content in place instead of adding a temporary loading row above it. Only the initial populated render shows that row. Repeated pending refreshes are coalesced; navigating away before the scheduled work runs leaves Analytics dirty so it updates on return.

Saving portfolio contributions uses the existing batch-settings operation for amount, contribution cadence and calibration cadence. That produces one standard batch audit entry listing all three settings, one configuration notification and one upload schedule, rather than three of each. The local browser regression verifies three SQLite export/persist operations instead of the nine previously reproduced, and verifies all three values after reload. Save guards, dirty drafts on failure and error notifications remain in place.

Net Worth projections now initialize when their panel enters the viewport or receives keyboard focus. A compact load button provides an explicit path, chart space is reserved while pending, and browsers without IntersectionObserver keep eager rendering. Repeated pending requests use the latest snapshots and settings; initialized panels continue refreshing normally. The history chart and goal progress stay eager. This targets projection DOM/chart work, not the inexpensive forecast calculation, and does not change financial calculations or projection horizons.

Successful background syncs still reload and validate local data, compute aggregates, update caches, and preserve the existing Drive checks. They avoid a full section repaint only when the complete view inputs and derived portfolio are unchanged. The in-memory comparison preserves BigInt precision and is never persisted or uploaded. First loads, changed data and failures retain the normal rendering path. Header, editability and attention state still refresh. This reduces redundant work and preserves existing unsaved form DOM on unchanged syncs; it does not skip downloads or conflict checks.

The website version is now `1.0.1`. Automatic commit build IDs distinguish subsequent deployments even when that version is unchanged. Old `1.0.0` diagnostic records remain available but cannot be retroactively assigned to commits or separated into release cohorts.

### Net Worth follow-up experiment

The next local **development-server** experiment used five isolated Chrome contexts per viewport and variant, with profiling enabled, blocked service workers and mocked external services. It compared the eager projection implementation from `22ca518` with viewport-only projections after restoring the synthetic 30-snapshot, 90-transaction chart fixture, reloading into Log and first navigating to Net Worth. Readiness was the tab activation through two animation frames, not completion of off-screen projections.

At 1365 x 900, the final run's median transition was 463 ms eager versus 335 ms deferred. Projections initialized in all five eager initial views and none of the five deferred initial views, then rendered when scrolled into view. At 390 x 900 the projections panel was already visible, so both variants initialized it; no phone-specific deferral saving is claimed. These noisy dev measurements are directional and are not comparable to the earlier production Analytics benchmark or a field INP guarantee. Browser regressions separately verify projection focus/navigation/theme/reload, unchanged-sync DOM retention, and repainting after changed snapshot data.

### Local synthetic comparison

A later development-server check compared `8a041f2` with the same-size resize guard using four isolated Chrome contexts per variant at each of 1365 x 900 and 390 x 900. With profiling enabled and synthetic 30-snapshot / 90-transaction data, returning from Log to already-rendered Portfolio or Analytics previously resized both visible charts in every context. The guard eliminated those redundant calls in every context. Desktop median return timings changed from 114.8 to 101.5 ms for Portfolio and 135.0 to 92.6 ms for Analytics; phone-width timings changed from 120.0 to 101.2 ms and 117.3 to 110.5 ms respectively. Timings include browser automation through two frames and are noisy, sequential dev observations, not field INP or a production benchmark. All original snapshot and transaction fields remained intact across the sixteen contexts; no page errors or snapshot-switch/reload layout shifts were observed. The isolated field snapshot layout-shift report was not reproduced, so no speculative layout change was made.

Compare production builds on the same browser and device. The initial local website comparison used isolated Chrome contexts, blocked service workers, mocked Google/Drive traffic, no real financial data, and a synthetic backup with 60 monthly snapshots, 180 transactions, two accounts and two holdings. It alternated the original build (`512b841`) and initial chart-deferral candidate (`2126bb3`) across five contexts per build with profiling disabled. These measurements predate the resize, loading-row, eager contributions-header and batched-save follow-ups above; they are not a benchmark of those follow-ups. Disabling profiling isolates the website improvement from the profiler retention optimization above.

The measured interaction was the first Analytics visit after restoring the backup and visiting Net Worth and Portfolio. Lead-chart readiness was measured from the tab click to two animation frames after its canvas appeared, not a fixed sleep or the earlier route-render marker. Every run also scrolled/expanded all secondary charts, navigated away and back, reloaded, and exported a backup to verify every synthetic snapshot value and transaction survived.

| Median measurement                        | Parent | Quick wins |
| ----------------------------------------- | -----: | ---------: |
| Analytics lead chart ready, profiling off | 314 ms |     105 ms |

In the initial Analytics viewport, two charts initialized instead of eight; the remaining six rendered when approached or expanded. The same functional and backup-integrity scenarios also passed with profiling enabled. For instrumented release comparisons, use distinct `VITE_BUILD_ID` values for the builds being compared.

These are small, local synthetic samples, not field INP, cold-start measurements, or a promise for every device. Deferral moves secondary-chart work to scrolling/expansion rather than eliminating it. Route markers can finish before deferred rendering and must not be used alone to claim a faster fully rendered view. Drive lookup reuse was deliberately deferred rather than changing canonical-file selection or conflict semantics in this small optimization.
