# Account lifecycle and account-linked ETF valuations

## Account identity

An account is a **logical tracking setup**, not a bank account number. Returning
to the Spanish setup can reopen the same tracker account, even if the bank has
issued a replacement. Reopening retains its ID, name and earlier history.
Create a separate tracker record only when separate history is wanted.

Country describes where the account is held, not the user's residency. Moving
investments to France should use a French account rather than changing the old
Spanish account's country and rewriting historical attribution.

## Closing and reopening

Account closure is not deletion. All accounts stay in the canonical list so
historical totals, country allocations, reports and exports remain intact.
`closedPeriods` stores inclusive closure months and exclusive reopening months:

```json
[{ "closedFromMonth": "2026-02", "reopenedFromMonth": "2046-06" }]
```

February 2026 through May 2046 is closed; June 2046 can receive valuations again.
Another closure adds another interval, not a replacement for earlier history.

- Use completed months, not scheduled future closures.
- Save an explicit zero account balance in the closure month first.
- Closed-period account balances and scoped ETF valuations must be zero or absent.
  Correct dates or explicitly reopen before recording residual fees/balances.
- Earlier snapshots remain editable. Deleting a closure-boundary zero snapshot
  is blocked when that would invalidate the lifecycle evidence.
- Closing stops the account's personal/extra contributions. A primary account
  needs an explicit replacement or an explicit stop to the global budget.
- Reopening does not automatically resume contributions or reclaim primary.
- Ordinary account edits preserve the lifecycle history. Permanent deletion and
  retired account IDs remain separate from closure.

In Settings, use **Edit account > Account status** to review closure/reopening,
history, or date corrections. These controls are collapsed by default rather than
adding actions/history to every row. Only closed accounts carry a status badge;
the lifecycle filter appears when there are closed accounts to filter. Update any
metadata draft before opening a status change, then use **Save** in Accounts to
persist the reviewed lifecycle changes.

## One ETF definition, several accounts

Holdings configuration remains unique by ISIN. An ETF's name, color, TER and
allocation target are defined once. Monthly valuations distinguish its accounts:

```text
spain_etf = 4500
france_etf = 6500
position:spain_etf:IE00B4L5Y983 = 4000
position:france_etf:IE00B4L5Y983 = 6000
```

The global ETF valuation is EUR 10,000, while account balances total EUR 11,000
including cash. ETF supplements are not added again to net worth. Each account's
ETF subtotal must fit its own account balance, after currency normalization.

The Portfolio list keeps one compact row per ISIN with a small account-count badge.
Expand a row, then **Account values** to inspect saved account valuations; the
breakdown stays collapsed by default. Account filter chips appear only for
non-empty subsets of the current held/closed list, omitting accounts that show all
rows or none, and deduplicating identical subsets. Search appears for multiple holdings (or an active search), and
status chips appear only when held and closed positions coexist. Chip counts
describe membership, not account-scoped financial totals: metrics and totals stay
portfolio-wide. Account chips compose with existing search/status
filters. Snapshot entry reuses existing securities instead of duplicating ETF
configuration for every account.

Coverage is explicit: `position_coverage:<accountId>` is 1 for reviewed complete,
0 for partial, and absent for unknown. A value for a shared ISIN in one account
does not establish complete global coverage.

### Entering one ETF in two accounts

Define the ETF once in Settings, using its ISIN. In a monthly snapshot, open
each investment account's **ETF breakdown**, choose **Add existing ETF to this
account**, and select that same ISIN. Enter the value held in each account for
that month, not the combined value twice. For example, Spain 400 EUR and France
600 EUR produce one Portfolio ETF row worth 1,000 EUR. No second ETF definition
or permanent ownership switch is needed.

Use the snapshot's optional **Notes** for context such as "Transferred IWDA from
Spain to France in July." The account/ISIN amounts are the financial record;
Notes explain it and survive migration and backup. A transfer is not a trade.

Snapshot entry keeps **Usual ETFs** visible and saved inactive/not-regularly-funded
positions under collapsed **Other ETFs**. This follows the existing global ETF
active/target settings; it does not mark the bank account closed or remove values.
Hidden Other ETF values still count in reconciliation and are saved.

### What completeness means

- **Not reviewed:** unknown whether every ETF position is listed; this is the
  migration default, not an assertion that positions are missing.
- **Partial:** some ETF positions may be missing.
- **Complete:** the user checked that every ETF position in this account/month
  is listed. ETF values can be less than the account balance because cash is
  allowed. Equality alone does not prove completeness.

Completeness is independent of Usual/Other grouping. Migration supports individual
account/month decisions and a bulk action for the selected saved period/account.
The monthly review shows one saved month at a time, with allocations and completeness
together under each account. Use Previous/Next, the month picker, or Next unassigned
month to navigate; drafts persist between months. Review conversion validates the
entire history, not just the visible month, and opens the month needing correction.
The before/after report follows the same month navigation and displays cents.
Bulk completeness ignores the ISIN filter because it describes the entire account.
It never changes amounts, and it must be reviewed before saving. Converted
snapshots retain the selected states, avoiding a second manual pass over history.
Already converted? Open **Settings → Accounts → Historical ETF completeness →
Review historical completeness**. The same period/account bulk action and individual
choices are available without rerunning migration or changing any amounts. Existing
states are preselected; selecting Not reviewed clears an earlier assertion. Editing
ETF amounts in a snapshot resets its completeness to Partial so an old confirmation
is not silently reused after values change.

The migration review highlights missing assignments and shows the exact shortfall
or excess against each saved ETF total as you type. Allocations must match that
total before saving. Account summaries also flag ETF values exceeding a recorded
balance, missing balances, and nonzero assignments to closed accounts. **Next issue**
jumps to saved months with allocation or account errors, including offscreen months.
A smaller ETF subtotal is shown as a warning with the remainder: check your statement
for cash or missing ETFs. It does not automatically mean Partial, and Complete does
not require ETFs to equal the whole account balance.

Months with account totals but no ETF breakdown are valid **Not reviewed** months.
The review shows an informational message, not a missing-cash warning. Account totals
are preserved; an absent breakdown does not mean zero ETF holdings or prove that the
balance is cash. Existing legacy ETF values still require assignments before conversion.
The monthly review displays the original saved ETF breakdown. If there is exactly
one investment account, its assignment fields are prefilled with those saved values;
balance and lifecycle validation still applies, and completeness is not inferred.
With multiple investment accounts, **Use saved values here** assigns the current
month's full breakdown to the chosen account without retyping (replacing that month's
splits). Bulk actions can reuse saved values over a period. Completeness-only review
also shows each account's saved per-ETF values, not just its subtotal.
Completeness is per account/month, so early total-only months do not invalidate later
complete breakdowns. Current Portfolio market-allocation calculations use the latest
snapshot and require Complete coverage for its open investment accounts.

You can backfill a historical snapshot later by editing it and importing a supported
valuation PDF for the same date (currently Trade Republic), or entering values manually.
Use positions-only import to retain the account balance. Import fills a draft and marks
the affected breakdown Partial; review retained positions and mark Complete only once
all positions are checked, then Review and Save. A PDF containing only account totals
cannot supply per-ETF valuations.

### Saving or discarding Settings drafts

Settings uses compact **Save** and **Discard** actions next to each editable
section. They appear only when there are unsaved changes; **Discard** restores
that section without writing to storage or changing drafts in other sections.
For Accounts this also cancels staged closures/reopenings and contribution routing.
Cancel in an add/edit dialog only cancels that dialog; once a change is staged,
use the section's Save or Discard. Saved history is never removed by Discard.
Suggested import mappings can also be saved as shown before any mapping is remembered.

## Existing-data conversion

Old `etf_<ISIN>` keys have no account ID. Their placement beneath the primary
account in the former UI does not establish historical ownership.

1. Keep legacy entry/reading available while preparing conversion.
2. Propose the current primary as a bulk destination, requiring confirmation.
3. Review month-range/ISIN exceptions and explicit splits across accounts.
4. Preview conservation of every month/ISIN total and check account balances.
5. Download a recovery backup. Convert all snapshots and activate
   `settings.etf_valuation_schema = "account-v1"` atomically.
6. Preserve balances, notes, transactions, global cost basis and aggregate
   valuations. Do not retain duplicate legacy totals.

**Which dates to choose:** From/Through are inclusive saved-history filters for
the optional bulk rule, not transfer or lifecycle dates. Use the regular month
inputs within the saved history's bounds; a boundary need not itself have a snapshot.
Leave both blank (the default), or select **All months**, for the whole history.
Use statements to select the period when the destination held the ETF. If Spain
held it through June and France from July, apply separate rules for those periods.
If both held it during a month, split that month's old total between the two
account fields instead of applying the full total to both. Review validates
conserved totals, account balances and lifecycle eligibility; it cannot establish
historical ownership or completeness without your confirmation.

After activation, normal writes reject unscoped valuations. Conversion is
idempotent and stale previews must be reviewed again. Old backups require staged
conversion before replacing account-linked live data.

**Follow-up cleanup:** after the actual user's migration, reload and backup
round-trip checks, remove transitional legacy runtime/entry paths. Keep a
reviewed conversion boundary for old backups. This cleanup is deliberately not
performed before the user's real dataset has passed migration.

## Imports, transfers and boundaries

Statement destinations are eligible for the statement month, not merely today's
primary account. Imports, repeated imports, review provenance and Undo distinguish
account plus ISIN, preserving other accounts. Historical imports remain possible
for formerly open periods; closed-period destinations are blocked.

Account transfers remain manual snapshot changes: zero the source and record
the actual destination value. Moving custody does not manufacture a sale, a
purchase, a gain or an external cash flow.

Shares, transaction history, cost basis and realized gains still aggregate
globally by ISIN. Account-linked valuation is **not** per-account tax-lot or P&L
tracking. Scheduled transfers, account merging and automatic reconciliation of
multiple statements are separate future work.

Database/account serializers, restores, sync merges and cache reloads must
preserve the same lifecycle and valuation invariants. Update all devices/PWAs
before using the new data format; old installed clients cannot be retroactively
made safe writers of a format they do not understand.
