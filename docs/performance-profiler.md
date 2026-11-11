# Temporary performance profiler

The profiler is an opt-in diagnostics feature for collecting local, observational performance data while testing the PWA. It is disabled by default and does not upload profiler records to Google Drive or another service.

## Enable and open diagnostics

Set the Vite environment variable before building or starting the app:

```env
VITE_ENABLE_PROFILING=true
```

For release comparisons, also set a stable identifier for that build, such as a release tag or commit SHA:

```env
VITE_BUILD_ID=release-1.2.3
```

When `VITE_BUILD_ID` is unset, the package version is used as the build ID. The app version and build ID together identify a release in reports, so use a distinct build ID for each build you want to compare. Set the variables in `.env.local` for local work or in the hosting provider's build environment for a deployed build. The feature flag is evaluated at build time.

With profiling enabled, open the three-dot header menu and choose **Performance diagnostics**. The page can filter measurements by the last 7, 30, or 90 days, category, route, and release. It can compare two releases and export the current filtered report as JSON. The app continues to work if profiler storage is unavailable; the diagnostics page reports storage or export errors rather than silently presenting a successful result.

## What is measured

The profiler records measurements in these categories:

- **Vitals:** CLS, FCP, INP, LCP, and TTFB from `web-vitals`, including soft-navigation reporting where supported by the browser.
- **App, route, and render:** startup, navigation, route changes, render timing, and relevant browser lifecycle transitions.
- **Database:** SQLite IndexedDB persistence and selected transaction and snapshot repository operations.
- **Drive and sync:** request timing, outcome, retries, payload size, total sync duration, and time spent waiting for pending sync work.
- **Browser and errors:** selected browser performance observations, resource metadata, JavaScript errors, and unhandled promise rejections.

Durations are milliseconds unless a report row specifies another unit. Payload sizes are bytes. The diagnostics page reports sample counts and distributions, including median, p75, p95, and maximum when applicable. It also shows success and failure counts, retry counts, or average payload size for operations that provide those values.

These are real-user browser observations, not controlled benchmarks. Results depend on the device, browser, network, app state, and workload. Use normal representative activity for a release comparison, and treat small samples as directional. In particular, p75 values based on fewer than 20 samples are marked descriptive. A comparison shows differences in measured medians and sample counts; it does not establish that a release caused the difference.

## Local data and privacy

Records are stored in the browser's separate IndexedDB database, `wealth-tracker-profiler`. They persist across app releases in that browser profile, but are not part of the application SQLite database, backup, or Drive sync. Retention is capped at 90 days and 10,000 records, whichever limit is reached first. Pruning occurs as records are written.

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
