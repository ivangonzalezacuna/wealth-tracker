# Account closure: rough implementation plan

Status: proposed, not implemented.

## Goal and scope

Allow an account to close after its balance moves elsewhere, without deleting
its history. For example, a move to another country creates a new account while
the old account remains visible in historical net worth and country breakdowns.

Keep the first version small: account closure and reopening, not an automated
transfer workflow, account merging, or a full history of multiple reopenings.

## Current constraints

- `Account` in `src/types.ts` has no lifecycle field.
- `toggleAccountRemoval` in `src/views/settings.ts` blocks removal when an
  account has nonzero historical snapshot values.
- `snapTotal` in `src/utils.ts` sums configured accounts. Removing closed
  accounts from the global account list would rewrite historical totals.
- `saveMonthlyUpdate` and `prefillSnapFormFromLatest` in `src/main.ts` pass all
  accounts into monthly entry and copy their previous balances.
- `src/views/networth.ts` builds forecast inputs from account contribution
  settings even when the latest balance is zero.
- `TRANSFER` transactions are recognized in `src/portfolio.ts`, but do not
  update snapshot balances.

## Proposed behavior

Use an optional `closedFromMonth: string` (`YYYY-MM`) on the account. Absence
means open. This is the first monthly snapshot in which the account must have
zero balance, not the date when a transfer transaction occurred.

Preserve the account ID, metadata, transactions, and all earlier snapshot
values. Keep closed accounts in the canonical account list; use date-aware
eligibility helpers rather than globally filtering `getAccounts()`.

Closing must not silently erase a balance. Require a saved zero balance in the
closure-month snapshot and reject nonzero balances in later existing snapshots.
Keep earlier snapshots editable. New or edited snapshots from closure onward
should save explicit zero for the closed account, without asking for manual
entry or copying an old balance. Changing the selected month must refresh which
accounts are editable. Supplemental ETF values must not survive as stale
balances when closing an investment account.

Keep closed accounts in historical charts and reports. Exclude them from
routine entry and future contribution plans when closure takes effect. If the
latest snapshot predates closure, retain its recorded balance in current totals
and do not invent a transfer or a zero-valued replacement snapshot.

## Implementation steps

1. **Model and persistence:** add the optional field and shared month validation
   and eligibility helpers in `src/model/accounts.ts`. Update SQLite schema,
   migration, account load/save and atomic restore in `src/db/`, plus backup
   validation/versioning in `src/backup/exportImport.ts`. Check the existing
   store and Drive-sync paths preserve the field. Old data defaults to open.
2. **Settings:** add Close/Reopen actions, closure-month selection, status badge,
   and Open/Closed filters in `src/views/settings.ts` and the account dialog.
   Preserve the historical-deletion guard. Closing the primary investment
   account must require a replacement or explicitly stopping its contribution
   plan; never silently redirect the global contribution budget.
3. **Monthly updates and imports:** wire date-aware eligibility into
   `src/main.ts`, `src/ui/snapshotDialog.ts`, and snapshot import mapping/draft
   validation. Reject imports targeting an account closed for the statement
   month, while allowing historical imports. Saved mappings must not bypass
   this check. Preserve the existing Review/Save and FX-normalization flow.
4. **Read surfaces and planning:** audit net worth, analytics, annual reports,
   snapshot logs, and forecasting. Historical sums must still include closed
   accounts. Suppress future contributions after closure; do not hide an old
   recorded balance merely because the account is now closed. Decide how to
   present a scheduled closure when no post-transfer snapshot exists rather
   than forecasting an invented transfer. Update account-management copy.
5. **Reopening:** remove the closure marker through the normal account-save
   flow. Do not rewrite snapshots or automatically restart contributions.
   Warn that this first version does not retain multiple closure intervals.

## Acceptance checks

- Transfer example: old account is EUR 10,000 in January; February records old
  account EUR 0 and new account EUR 10,000. Closing from February leaves January
  totals and country attribution unchanged and February total at EUR 10,000.
- Subsequent monthly updates do not request the closed account or copy its old
  balance; editing January still exposes its historical balance.
- Nonzero closure/later balances block closure with an actionable error.
  Importing into a closed month cannot reintroduce a balance.
- Closed accounts receive no future contributions, including employer extras
  and the primary investment budget. A pre-closure latest snapshot retains its
  actual total.
- Closure survives reload, backup/restore, and sync; older backups remain valid.
  Reopening preserves history without silently restarting contributions.

Add focused model, persistence/backup, Settings, snapshot-dialog/import, and
forecast tests, plus one end-to-end close/reload/historical-edit scenario.
