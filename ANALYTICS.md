# Analytics Design

This document captures the analytics module design for wealth-tracker.
It serves as a living reference that can be iteratively updated as the product evolves.

> Constraints: all calculations rely exclusively on **monthly snapshots** stored in the database.
> No external data providers are used and no daily price series are available.
> Benchmark comparison features are therefore **out of scope** for this product.

---

## Table of Contents

1. [Analytics Hierarchy (Progressive Disclosure)](#1-analytics-hierarchy)
2. [Performance Metrics](#2-performance-metrics)
3. [Risk Metrics](#3-risk-metrics)
4. [Risk-Adjusted Performance](#4-risk-adjusted-performance)
5. [Income Analytics](#5-income-analytics)
6. [Allocation Analytics](#6-allocation-analytics)
7. [Historical Analytics](#7-historical-analytics)
8. [Metrics to Omit](#8-metrics-to-omit)
9. [Backend Specification](#9-backend-specification)
10. [Technical Architecture](#10-technical-architecture)
11. [UI/UX Wireframes](#11-uiux-wireframes)
12. [Prioritized Roadmap](#12-prioritized-roadmap)
13. [Investor Coverage Matrix](#13-investor-coverage-matrix)
14. [Full Metric Comparison Table](#14-full-metric-comparison-table)

---

## 1. Analytics Hierarchy

The UI follows **progressive disclosure**: each level adds depth without overwhelming
users who do not need it.

### Level 1: Dashboard (always visible)

KPI cards at the top of the main view. No minimum history required.
Designed so a beginner can understand the page immediately.

| Metric                   | Visualization                                |
| ------------------------ | -------------------------------------------- |
| Total Portfolio Value    | Large number + sparkline                     |
| Total Return (%)         | Badge with color                             |
| Absolute Gain (currency) | Secondary label below total return           |
| CAGR                     | KPI card (hidden until 12 months of history) |
| YTD Return               | KPI card                                     |
| Monthly P&L              | 12-bar sparkline                             |

**Rationale:** FIRE investors, ETF investors, and long-term holders care most about
CAGR and total return. YTD is universally understood. Monthly P&L gives short-term
context without cluttering the dashboard. YoY is omitted here because CAGR is a
better summary for long-term holders.

### Level 2: Performance Details (one click or scroll)

| Metric                         | Visualization                    |
| ------------------------------ | -------------------------------- |
| TWR                            | KPI card                         |
| XIRR                           | KPI card                         |
| YoY                            | KPI card                         |
| Rolling 3-Year CAGR            | Line chart (requires 36+ months) |
| Annual Return Table            | Table, one row per calendar year |
| Portfolio Growth Chart         | Area chart                       |
| Contributions vs Market Growth | Stacked bar (12 months)          |

**Rationale:** TWR and XIRR complement CAGR for users who make regular contributions.
The annual return table gives long-term investors a quick history scan. Rolling CAGR
shows whether returns are consistent or driven by a single good year.

### Level 3: Advanced Analytics (collapsible, gated on 24+ months of history)

Sub-sections: Risk, Risk-Adjusted Performance, Income, Allocation, Historical.

**Metrics explainer panel:** A collapsible `<details>` panel ("What do these metrics mean?") is
rendered directly below the risk KPI tiles. It is collapsed by default so experienced users are
not interrupted. Each metric card inside it contains three parts:

- **What it is** -- a plain-language one-sentence description.
- **Good to aim for** -- a concrete benchmark or direction.
- **How to improve it** -- one actionable tip.

This panel is purely static HTML; it requires no additional model logic.

---

## 2. Performance Metrics

### Included

| Metric                | Status | Notes                                       |
| --------------------- | ------ | ------------------------------------------- |
| Total Return (%)      | Add    | `(current - first) / first`                 |
| Absolute Gain         | Add    | `current - totalContributed`                |
| YTD Return            | Add    | Total return from Jan 1 snapshot to current |
| CAGR                  | Exists | `insights.cagr()`; show after 12 months     |
| TWR                   | Exists | `insights.twr()`                            |
| XIRR                  | Exists | `insights.xirr()`                           |
| YoY                   | Exists | `insights.findYoYSnapshot()`                |
| Rolling 3/5-Year CAGR | Add    | Array of `{month, cagr}` points             |
| Annual Return Table   | Add    | Derived from January snapshots each year    |

### Excluded

- **Quarterly Return:** redundant; monthly, YTD, and YoY already cover all timeframes.
- **Monthly Return (single number):** the heatmap and sparkline replace it more usefully.

---

## 3. Risk Metrics

All require at least 2 snapshots; most are meaningful only after 12+ months.

| Metric                  | Status | Notes                                                                         |
| ----------------------- | ------ | ----------------------------------------------------------------------------- |
| Volatility (annualized) | Exists | `insights.annualizedVolatility()`; monthly std-dev scaled by sqrt(12)         |
| Max Drawdown            | Exists | `insights.maxDrawdown()`; peak-to-trough as a fraction                        |
| Average Drawdown        | Add    | Mean of all individual drawdown values in the series                          |
| Drawdown Duration       | Add    | Max contiguous months below prior peak                                        |
| Downside Deviation      | Add    | Sqrt(mean of squared negative monthly returns) * sqrt(12); needed for Sortino |
| Ulcer Index             | Omit   | Redundant with Max Drawdown + Duration for this audience                      |

**Refactor note:** `maxDrawdown` currently returns only a scalar. Refactor it to also
return the full drawdown series `{date, drawdown}[]`. Average drawdown, drawdown
duration, and the drawdown chart all derive from that series for free.

---

## 4. Risk-Adjusted Performance

### Included

| Metric        | Status        | Formula                           | Requirement                   |
| ------------- | ------------- | --------------------------------- | ----------------------------- |
| Calmar Ratio  | Add (trivial) | `CAGR / abs(maxDrawdown)`         | Both already computed         |
| Sharpe Ratio  | Add           | `(CAGR - rf) / volatility`        | Risk-free rate config setting |
| Sortino Ratio | Add           | `(CAGR - rf) / downsideDeviation` | Downside deviation            |

**Calmar is free:** CAGR and Max Drawdown are already implemented; Calmar is a single
division. It is highly valued by FIRE investors evaluating sequence-of-returns risk.

**Risk-free rate** should be a user-configurable setting (default 2%) stored in the
existing config system. Without it, Sharpe and Sortino cannot be computed.

### Excluded

- **Treynor Ratio:** requires beta, which needs a benchmark. Out of scope.
- **Information Ratio:** only meaningful relative to a benchmark. Out of scope.
- **Jensen's Alpha:** requires beta. Out of scope.

### Note on benchmark metrics

All benchmark-dependent metrics (Alpha, Beta, Tracking Error, Excess Return,
Relative Drawdown, Information Ratio) are **out of scope** for this product.
The application uses monthly snapshots only and has no external data provider integration.
If a benchmark feature is added in the future, it would require storing benchmark
monthly values manually or importing them, which is a separate design effort.

---

## 5. Income Analytics

Show this entire section only when at least one `DIVIDEND` or `INTEREST` transaction exists.

| Metric                    | Status | Formula                                                   |
| ------------------------- | ------ | --------------------------------------------------------- |
| Trailing 12-Month Income  | Add    | Sum of DIVIDEND + INTEREST transactions in last 12 months |
| Dividend Yield            | Add    | `annualIncome / currentPortfolioValue`                    |
| Yield on Cost             | Add    | `annualIncome / totalCostBasis` (reuses `costbasis.ts`)   |
| Income by Month           | Add    | Bar chart, 12 months rolling                              |
| Dividend Growth (YoY)     | Add    | `(thisYearIncome - lastYearIncome) / lastYearIncome`      |
| Dividend CAGR             | Add    | CAGR formula applied to annual dividend totals            |
| Passive Income Projection | Add    | Annualized trailing income; critical for FIRE users       |

**Data source:** all metrics derived entirely from existing transactions table using
`type IN ('DIVIDEND', 'INTEREST')`. No new data model required.

**Excluded:** Dividend Coverage Ratio and payout ratio require earnings data not
tracked in this app.

---

## 6. Allocation Analytics

No minimum history required. Derived from the latest snapshot and holding/account metadata.

| Visualization                             | Priority     | Data Source                         |
| ----------------------------------------- | ------------ | ----------------------------------- |
| Asset Class Allocation (donut)            | Must Have    | `Holding.assetClass`                |
| Account Allocation (donut or stacked bar) | Must Have    | `Account` records                   |
| Geographic / Region Allocation (donut)    | Must Have    | `Holding.region`                    |
| Sector Allocation (donut)                 | Should Have  | `Holding` category or tag           |
| Currency Allocation (donut)               | Should Have  | `Transaction.currency`              |
| Drift from Target (bar)                   | Should Have  | `src/model/drift.ts` already exists |
| Broker / Institution Allocation (donut)   | Nice to Have | `Account.institution`               |

**Drift visualization:** `src/model/drift.ts` already contains the drift computation.
A horizontal bar chart showing actual vs target per asset class is a high-value,
low-effort addition.

### All assets / Active only toggle

Each allocation donut (except Account) renders an **All assets / Active only** toggle.
The `active` mode filters to holdings whose `active` flag is true; the `all` mode
includes every holding that has ever been tracked. The two modes can produce
very different charts for the same portfolio (e.g., a single active ETF vs multiple
historical positions).

### Single-slice (100% concentration) state

When a donut dimension yields exactly one slice the chart is suppressed entirely.
A compact **concentration block** is shown in its place: a colored left-border banner
displaying the slice color, label, "100%", and the EUR value. The card collapses to
the natural height of that block so no dead whitespace remains.

If the currently active mode produces a single slice but the other mode would reveal
more slices, a hint is appended: _"Switch to All assets to see the full breakdown."_
The toggle button is still rendered so the user can act on the hint.

This design follows guidance from both wealth-management and UX review:

- A donut with one segment adds no analytical value; remove it.
- Concentration should be communicated as an explicit signal, not empty space.
- The card should collapse to content height to avoid dead whitespace in the dashboard.

---

## 7. Historical Analytics

Gate all of these behind a minimum of 12 months of snapshot data.

| Feature                        | Visualization                | Priority                   |
| ------------------------------ | ---------------------------- | -------------------------- |
| Portfolio Growth Chart         | Area/line, 1Y/3Y/All toggle  | Must Have                  |
| Contributions vs Market Growth | Stacked area (monthly)       | Must Have (fn exists)      |
| Drawdown Chart                 | Inverted area, red fill      | Should Have                |
| Monthly Return Heatmap         | Calendar grid (month x year) | Should Have                |
| Annual Return Table            | Table with bar sparklines    | Should Have                |
| Rolling CAGR Chart             | Line, 36-month window        | Nice to Have (36+ months)  |
| Rolling Volatility Chart       | Line, 12-month window        | Nice to Have (quant users) |
| Waterfall Performance          | Waterfall chart by year      | Nice to Have               |

**Monthly return heatmap:** the return series is a natural byproduct of the volatility
computation. Refactor `annualizedVolatility` to also expose the per-month return
array; the heatmap and other features consume it for free.

---

## 8. Metrics to Omit

| Metric                          | Reason                                              |
| ------------------------------- | --------------------------------------------------- |
| Quarterly Return                | Redundant: monthly + YTD + YoY cover all timeframes |
| Ulcer Index                     | Redundant with Max Drawdown + Duration              |
| Treynor Ratio                   | Requires beta; no benchmark in scope                |
| Jensen's Alpha                  | Requires beta                                       |
| Information Ratio               | Benchmark-dependent                                 |
| Any benchmark comparison metric | No external data provider; monthly snapshots only   |
| P/E, EPS, intrinsic value       | Requires fundamental data; out of scope             |

---

## 9. Backend Specification

### Existing functions (reuse without modification)

All in `src/model/insights.ts`:

| Function                           | Complexity  | Inputs                           |
| ---------------------------------- | ----------- | -------------------------------- |
| `cagr(first, last, months)`        | O(1)        | Snapshot values                  |
| `twr(snaps, contributionsByMonth)` | O(n)        | Snapshot array, contribution map |
| `findYoYSnapshot(snaps)`           | O(n)        | Snapshot array                   |
| `annualizedVolatility(snaps)`      | O(n)        | Snapshot array                   |
| `maxDrawdown(snaps)`               | O(n)        | Snapshot array                   |
| `xirr(cashFlows)`                  | O(n * iter) | Cash flow array                  |
| `monthlyGrowthHistory(...)`        | O(n)        | Snaps, accounts, contributions   |

### New functions to add

**Total Return**

- Formula: `(currentValue - firstValue) / firstValue`
- Inputs: first and latest snapshot values
- Cash flows: no
- Edge case: first value is 0 (return null)

**YTD Return**

- Formula: same as Total Return, windowed to Jan 1 of current year
- Inputs: snapshot nearest to Jan 1, current snapshot
- Edge case: portfolio started this year; return from inception date

**Average Drawdown**

- Formula: mean of all individual drawdown fractions in the series
- Inputs: same snapshot series as `maxDrawdown`
- Refactor: extract drawdown series from `maxDrawdown` first

**Drawdown Duration**

- Formula: max contiguous count of months where portfolio is below prior peak
- Inputs: drawdown series
- Returns: number of months

**Downside Deviation**

- Formula: `sqrt(mean(min(r, 0)^2 for r in monthlyReturns)) * sqrt(12)`
- Inputs: monthly returns array (expose from volatility refactor)
- Threshold: 0 (semi-deviation)

**Sharpe Ratio**

- Formula: `(CAGR - riskFreeRate) / annualizedVolatility`
- Inputs: CAGR, volatility, risk-free rate from config
- Edge case: volatility is 0 (return null)

**Sortino Ratio**

- Formula: `(CAGR - riskFreeRate) / downsideDeviation`
- Edge case: downside deviation is 0 (return null)

**Calmar Ratio**

- Formula: `CAGR / abs(maxDrawdown)`
- Inputs: both already computed
- Edge case: maxDrawdown is 0 (return null)

**Rolling CAGR**

- Formula: for each snapshot i >= windowMonths, compute `cagr(snap[i-w], snap[i], w)`
- Returns: `{month: string, cagr: number}[]`
- Requires: 36+ months for 3-year rolling

**Monthly Returns Series**

- Refactor `annualizedVolatility` to return `{returns: number[], annualized: number}`
- All downstream features (Sortino, Sharpe, heatmap) consume `returns`

**Annual Returns**

- Inputs: snapshot series
- For each calendar year: find Jan and Dec snapshots (or nearest), compute return
- Returns: `{year: number, return: number}[]`

**Dividend Metrics**

- Source: `transactions` table filtered by `type IN ('DIVIDEND', 'INTEREST')`
- All derived by grouping and summing; no new data required

### Recommended refactors

1. **`annualizedVolatility`**: return `{ annualized: number | null, monthlyReturns: number[] }`
   so the return series is reusable.

2. **`maxDrawdown`**: return `{ max: number | null, series: { date: string, drawdown: number }[] }`
   so average drawdown, duration, and the drawdown chart share one computation.

3. **`computeAnalytics(snaps, cashFlows, transactions, config)`**: single entry point
   that runs all metrics in one pass and returns a typed `AnalyticsResult` object.
   Frontend calls this once; components read from the cached result.

---

## 10. Technical Architecture

### Computation strategy

**Precompute and cache** (expensive, change only when data changes):

- Full snapshot-derived series: CAGR, TWR, Volatility, Max Drawdown, Rolling metrics
- Invalidate on: new snapshot added, transaction imported, historical correction

**On-demand** (cheap arithmetic on cached values):

- Sharpe, Sortino (depend on user-configurable risk-free rate)
- Calmar (division of two cached values)
- YTD, Total Return (subset of cached series)
- Allocation breakdown (from latest snapshot only)

**Incremental append**:

- Monthly return series: append when a new snapshot is added
- Dividend totals: append on new DIVIDEND/INTEREST transaction

### Suggested database additions

```sql
-- Cache for computed analytics results
CREATE TABLE analytics_cache (
  key       TEXT PRIMARY KEY,     -- e.g. 'cagr', 'twr', 'sharpe'
  value     TEXT NOT NULL,        -- JSON-serialized result
  computed_at TEXT NOT NULL,
  snapshot_count INTEGER NOT NULL -- invalidate when count changes
);

-- Pre-aggregated dividend income by year/month
CREATE TABLE dividend_summary (
  year    INTEGER NOT NULL,
  month   INTEGER NOT NULL,
  amount  REAL    NOT NULL,
  currency TEXT   NOT NULL,
  PRIMARY KEY (year, month, currency)
);
```

### API shape (frontend consumption)

```ts
interface AnalyticsSummary {
  dataQuality: { months: number; hasDividends: boolean };
  performance: {
    totalReturn: number | null;
    absoluteGain: number | null;
    ytd: number | null;
    cagr: number | null;
    twr: number | null;
    xirr: number | null;
    yoy: number | null;
  };
  risk: {
    volatility: number | null;
    maxDrawdown: number | null;
    avgDrawdown: number | null;
    drawdownDuration: number | null;
    downsideDeviation: number | null;
  };
  riskAdjusted: { sharpe: number | null; sortino: number | null; calmar: number | null };
  income?: {
    trailing12m: number;
    yield: number | null;
    yieldOnCost: number | null;
    dividendCagr: number | null;
    byMonth: { month: string; amount: number }[];
  };
  allocation: {
    byAssetClass: AllocationSlice[];
    byAccount: AllocationSlice[];
    byRegion: AllocationSlice[];
    byCurrency: AllocationSlice[];
    drift: DriftSlice[];
  };
  history: {
    growth: { month: string; value: number }[];
    drawdownSeries: { month: string; drawdown: number }[];
    monthlyReturns: { year: number; month: number; return: number }[];
    annualReturns: { year: number; return: number }[];
    rollingCagr?: { month: string; cagr: number }[];
  };
}
```

The `dataQuality.months` field allows UI components to gate rendering:

- CAGR, YoY: require 12 months
- Rolling 3Y CAGR: requires 36 months
- Sharpe, Sortino: require 12 months + risk-free rate configured
- Drawdown chart: requires 2+ snapshots

---

## 11. UI/UX Wireframes

### Main Dashboard

```
+----------------------------------------------------------+
|  Portfolio Value         Total Return      CAGR          |
|  $142,350               +$22,350 (+18.6%)  9.2% / yr    |
|  [sparkline up arrow]   [YTD: +7.1%]       [3y 4m]      |
+----------------------------------------------------------+
|  [Growth Chart, area, 1Y / 3Y / All toggle]              |
+----------------------------------------------------------+
|  Contributed vs Market Growth [stacked bar, 12 months]  |
+----------------------------------------------------------+
|  Asset Allocation [donut]  |  Drift from Target [bar]   |
+----------------------------------------------------------+
```

### Performance Details

```
+----------------------------------------------------------+
|  TWR: 17.4%    XIRR: 11.2%    YoY: +14.1%              |
+----------------------------------------------------------+
|  Annual Returns Table                                    |
|  Year   Return   vs Prior Year                          |
|  2024   +22.1%   [bar spark]                            |
|  2023   +14.2%   [bar spark]                            |
|  2022   -8.1%    [bar spark]                            |
+----------------------------------------------------------+
|  Monthly Return Heatmap [grid: year rows, month cols]   |
+----------------------------------------------------------+
```

### Risk and Advanced

```
+----------------------------------------------------------+
|  Volatility       Max Drawdown      Calmar              |
|  12.4% [gauge]    -18.2% [gauge]    0.51                |
+----------------------------------------------------------+
|  Drawdown Chart [inverted area, red fill, time axis]    |
+----------------------------------------------------------+
|  Sharpe: 0.74     Sortino: 1.02    Avg DD: -4.1%       |
|  DD Duration: 5 months                                  |
+----------------------------------------------------------+
```

### Income (conditional, dividend investors)

```
+----------------------------------------------------------+
|  Trailing 12M Income    Yield      Yield on Cost        |
|  $3,420                 2.4%       3.1%                 |
+----------------------------------------------------------+
|  Income by Month [bar chart, 12 months]                 |
+----------------------------------------------------------+
|  Dividend CAGR: 8.2%    YoY Growth: +11.4%             |
+----------------------------------------------------------+
```

### Visualization recommendations

| Metric           | Visualization                      | Notes                                |
| ---------------- | ---------------------------------- | ------------------------------------ |
| Total Return     | Large number + colored badge       | Green/red                            |
| CAGR             | KPI card                           | Subtitle: "since [date]"             |
| Portfolio Growth | Area chart                         | Fill below line, time range toggle   |
| Monthly P&L      | Bar chart (red/green)              | 12-bar sparkline on dashboard        |
| Drawdown         | Inverted area chart                | Red fill; y-axis inverted            |
| Volatility       | Gauge (0 to 50%)                   | Low/medium/high colored bands        |
| Max Drawdown     | Gauge (0 to 50%)                   | Same scale                           |
| Asset Allocation | Donut chart                        | Click to drill down by account       |
| Drift            | Horizontal bars (actual vs target) | Deviation highlighted                |
| Monthly Heatmap  | Grid: year rows x month cols       | Green-white-red diverging            |
| Annual Returns   | Table + bar sparklines             | Sortable                             |
| Income by Month  | Bar chart, 12 months               | 12-month trailing sum as overlay     |
| Rolling CAGR     | Line chart                         | Multiple windows overlaid optionally |

---

## 12. Prioritized Roadmap

### Must Have (MVP)

1. Total Return (%), Absolute Gain -- trivial, expected by all users
2. YTD Return -- universal, trivial
3. Portfolio Growth Chart -- most important visualization
4. Contributions vs Market Chart -- `monthlyGrowthHistory` already built
5. Asset class and account allocation donuts -- leverage existing `Holding.assetClass`
6. Annual Return Table -- O(n) from snapshots, high value
7. Calmar Ratio -- free: CAGR and maxDrawdown already exist
8. Average Drawdown + Drawdown Duration -- small extension of `maxDrawdown`

### Should Have (Pro)

9. Refactor `annualizedVolatility` to expose monthly returns series
10. Refactor `maxDrawdown` to expose drawdown series
11. Sharpe Ratio -- requires risk-free rate config setting
12. Sortino Ratio -- requires downside deviation
13. Monthly Return Heatmap -- high engagement, reuses monthly returns
14. Drawdown Chart -- visual companion to maxDrawdown
15. Rolling CAGR Chart -- gated on 36+ months
16. Drift visualization -- `drift.ts` exists, just needs chart
17. Dividend analytics -- conditional on dividend transactions

### Nice to Have (Power User)

18. Rolling Volatility Chart -- after rolling CAGR
19. Waterfall performance chart -- cosmetic, visually engaging
20. Currency and broker allocation donuts
21. Dividend CAGR and yield on cost

---

## 13. Investor Coverage Matrix

| Metric              | Beginner | ETF Investor | Active | Dividend | FIRE | Quant |
| ------------------- | -------- | ------------ | ------ | -------- | ---- | ----- |
| Total Return        | x        | x            | x      | x        | x    | x     |
| CAGR                | x        | x            | x      | x        | x    | x     |
| TWR                 |          | x            | x      |          |      | x     |
| XIRR                |          |              | x      |          | x    | x     |
| YTD                 | x        | x            | x      | x        | x    |       |
| Volatility          |          | x            | x      |          | x    | x     |
| Max Drawdown        |          | x            | x      |          | x    | x     |
| Calmar              |          |              |        |          | x    | x     |
| Sharpe              |          |              | x      |          | x    | x     |
| Sortino             |          |              | x      |          | x    | x     |
| Dividend Yield      |          |              |        | x        | x    |       |
| Yield on Cost       |          |              |        | x        | x    |       |
| Income by Month     |          |              |        | x        | x    |       |
| Asset Allocation    | x        | x            | x      | x        |      |       |
| Drift               |          | x            |        |          | x    |       |
| Monthly Heatmap     |          |              | x      |          |      | x     |
| Rolling CAGR        |          | x            |        |          | x    | x     |
| Annual Return Table | x        | x            | x      | x        | x    | x     |

---

## 14. Full Metric Comparison Table

| Metric                 | Purpose                     | Audience         | Difficulty              | Perf Impact       | Business Value |
| ---------------------- | --------------------------- | ---------------- | ----------------------- | ----------------- | -------------- |
| Total Return %         | Baseline P&L                | All              | Trivial                 | None              | High           |
| Absolute Gain          | Dollar P&L                  | All              | Trivial                 | None              | High           |
| YTD                    | Current-year context        | All              | Trivial                 | None              | High           |
| CAGR                   | Long-run annual return      | All              | Exists                  | None              | High           |
| TWR                    | Fair performance comparison | Advanced         | Exists                  | None              | High           |
| XIRR                   | Cash-flow-adjusted return   | Advanced         | Exists                  | Low               | High           |
| YoY                    | Year-over-year              | All              | Exists                  | None              | Medium         |
| Calmar                 | Risk-adjusted (CAGR / DD)   | FIRE, Quant      | Trivial (reuse)         | None              | High           |
| Volatility             | Return dispersion           | Advanced         | Exists                  | None              | High           |
| Max Drawdown           | Worst peak-to-trough loss   | Advanced         | Exists                  | None              | High           |
| Avg Drawdown           | Typical drawdown            | Advanced         | Low                     | None              | Medium         |
| Drawdown Duration      | Time underwater             | FIRE, Quant      | Low                     | None              | Medium         |
| Downside Deviation     | Negative-only volatility    | Quant            | Low                     | None              | Medium         |
| Sharpe Ratio           | Return per unit of risk     | Advanced         | Low                     | None              | High           |
| Sortino Ratio          | Return per downside risk    | Quant            | Low                     | None              | Medium         |
| Dividend Yield         | Income vs portfolio value   | Dividend         | Low                     | None              | High (segment) |
| Yield on Cost          | Income vs cost basis        | Dividend         | Low                     | Uses costbasis.ts | High (segment) |
| Dividend CAGR          | Income growth rate          | Dividend         | Low                     | None              | High (segment) |
| Income by Month        | Seasonal income             | Dividend         | Low                     | None              | High (segment) |
| Asset Allocation       | Diversification             | All              | Low                     | None              | High           |
| Drift                  | Rebalancing signal          | ETF, FIRE        | Low (drift.ts exists)   | None              | High           |
| Portfolio Growth Chart | Historical growth story     | All              | Low                     | None              | High           |
| Contributions Chart    | Savings vs returns          | All              | Low (history fn exists) | None              | High           |
| Annual Return Table    | Year-by-year history        | All              | Low                     | None              | High           |
| Monthly Heatmap        | Seasonality patterns        | Active, Quant    | Medium                  | None              | High           |
| Drawdown Chart         | Visual risk history         | Advanced         | Low                     | None              | Medium         |
| Rolling CAGR           | Consistency of returns      | ETF, FIRE, Quant | Medium                  | None              | Medium         |
| Rolling Volatility     | Risk regime changes         | Quant            | Medium                  | None              | Low            |
| Waterfall Chart        | Year contribution visual    | All              | Medium                  | None              | Low            |

---

## Revision History

| Date       | Change                                       |
| ---------- | -------------------------------------------- |
| 2026-08-04 | Initial document created from design session |
