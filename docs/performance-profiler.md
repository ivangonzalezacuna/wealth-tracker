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

Long build IDs wrap within diagnostics cards and comparison text; wide tables scroll independently without widening the page. Full build IDs remain visible and unchanged in filters and JSON exports.

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
