import type { Account, Snapshot } from '../types';
import {
  legacyPositionEntries,
  migratePositionSnapshots,
  type ValuationMigrationReview,
} from '../model/valuationMigration';
import { accountPositionValues, coverageKey, POSITION_TOLERANCE } from '../model/snapshotPositions';
import { isAccountClosedInMonth } from '../model/accounts';
import { esc, fmtEur2 } from '../utils';
import { createDialogController, openDialogShell } from './modalShell';
import { validateMonthInput, wireMonthInputs } from './monthInput';

export interface ValuationMigrationDialogOptions {
  /** Incoming backup data can be reviewed without changing the live database. */
  accounts: Account[];
  snapshots: Snapshot[];
  exportBackup?: () => Promise<void>;
  coverageOnly?: boolean;
}

const dialog = createDialogController<ValuationMigrationReview | null>(null);

/** Returns draft decisions; the caller owns atomic persistence and activation. */
export function valuationMigrationDialog(
  opts: ValuationMigrationDialogOptions,
): Promise<ValuationMigrationReview | null> {
  return new Promise((resolve) => {
    dialog.begin(resolve);
    let entries: ReturnType<typeof legacyPositionEntries> = [];
    let inventoryError = '';
    try {
      entries = legacyPositionEntries(opts.snapshots);
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : String(error);
    }
    const accounts = opts.accounts.filter((a) => a.moneyType === 'investment' && a.id);
    const primary = accounts.find((a) => a.isPrimaryInvestment);
    const months = [...new Set(opts.snapshots.map((snapshot) => snapshot.date.slice(0, 7)))].sort();
    const bounds = months.length ? `min="${months[0]}" max="${months[months.length - 1]}"` : '';
    const coverageRows = opts.snapshots.flatMap((snapshot) =>
      accounts
        .filter((account) => {
          const balance =
            snapshot[account.id!] ?? (account.key ? snapshot[account.key] : undefined);
          return typeof balance === 'number' && Number.isFinite(balance);
        })
        .map((account) => ({
          month: snapshot.date,
          accountId: account.id!,
          state: snapshot[coverageKey(account.id!)],
        })),
    );
    const allocationValues = entries.map((entry) =>
      accounts.map(() => (accounts.length === 1 ? String(entry.value) : '')),
    );
    const coverageValues = coverageRows.map((row) =>
      row.state === 0 || row.state === 1 ? String(row.state) : '',
    );
    const coverageOptions = (value: string) =>
      `<option value="">Not reviewed</option><option value="0"${value === '0' ? ' selected' : ''}>Partial</option><option value="1"${value === '1' ? ' selected' : ''}>Complete</option>`;
    const options = accounts
      .map(
        (a) =>
          `<option value="${esc(a.id!)}"${a === primary ? ' selected' : ''}>${esc(a.label)}${a === primary ? ' (primary)' : ''}</option>`,
      )
      .join('');
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay settings-dialog-overlay valuation-migration-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'migration-title');
    overlay.innerHTML = `<div class="dialog-card">
      <div class="dialog-header"><h2 class="dialog-title" id="migration-title">${opts.coverageOnly ? 'Review historical ETF completeness' : 'Review historical ETF account assignments'}</h2></div>
      <div class="dialog-fields">
        <p class="note">${opts.coverageOnly ? 'Confirm which account/months list every ETF. Amounts and Notes stay unchanged.' : 'Assign saved ETF totals to the accounts on your statements. This does not move money.'}</p>
        <details class="dialog-optional"><summary>Dates, splits and completeness</summary><div class="dialog-optional-body">
          <p class="note">Dates filter saved history, not account opening or transfer dates. Through June / from July can assign Spain / France; split a shared month between both accounts using the same ISIN.</p>
          <p class="note">Total-only months can stay Not reviewed: account balances are preserved, and ETF breakdowns can be added later. Partial = some ETF values recorded. Complete = every ETF listed and checked; the remainder can be cash.</p>
        </div></details>
        ${opts.exportBackup ? '<button class="btn btn-sm btn-outline js-backup">Export backup</button><span class="note" role="status" id="migration-backup-status"></span>' : ''}
        <details class="dialog-optional"><summary>Bulk actions</summary><div class="dialog-optional-body">
          <div class="dialog-row dialog-row-relaxed">
            <label class="dialog-field"><span class="dialog-label">From (inclusive)</span><input class="form-input" type="month" data-month-input id="migration-from" ${bounds}></label>
            <label class="dialog-field"><span class="dialog-label">Through (inclusive)</span><input class="form-input" type="month" data-month-input id="migration-to" ${bounds}></label>
          </div>
          <div class="dialog-row dialog-row-center"><button type="button" class="btn btn-sm btn-ghost js-all-months">All months</button><span class="note" id="migration-period" role="status">All saved months</span></div>
          <label class="dialog-field"><span class="dialog-label">Account</span><select class="form-input" id="migration-account">${options}</select></label>
          ${opts.coverageOnly ? '' : `<div class="dialog-row dialog-row-center"><label class="dialog-field"><span class="dialog-label">ISIN (blank = all)</span><input class="form-input" id="migration-isin"></label><button type="button" class="btn btn-sm btn-outline js-rule"${!accounts.length || inventoryError ? ' disabled' : ''}>Use saved values</button></div><p class="note">Reuses each saved ETF value without retyping. Replaces matching splits. Split shared ETFs in the monthly review below.</p>`}
          <div class="dialog-row dialog-row-center"><label class="dialog-field"><span class="dialog-label">Whole-account completeness</span><select class="form-input" id="migration-coverage-state">${coverageOptions('')}</select></label><button type="button" class="btn btn-sm btn-outline js-coverage-rule"${!coverageRows.length || inventoryError ? ' disabled' : ''}>Apply completeness</button></div>
          <p class="note">Completeness covers all ETFs in the account, regardless of the ISIN filter.</p>
          <span class="note" role="status" id="migration-coverage-status"></span>
        </div></details>
        <section class="migration-month-review" aria-label="Monthly review">
          <label class="dialog-field"><span class="dialog-label">Review saved month</span><input class="form-input" type="month" data-month-input id="migration-month" ${bounds}></label>
          <div class="pagination">
            <span class="pagination-nav">
              <button type="button" class="btn btn-sm btn-ghost js-month-prev" aria-label="Previous saved month">&larr;</button>
              <span class="page-info" id="migration-page" aria-live="polite"></span>
              <button type="button" class="btn btn-sm btn-ghost js-month-next" aria-label="Next saved month">&rarr;</button>
            </span>
            ${months.length ? '<button type="button" class="btn btn-sm btn-ghost js-unassigned">Next issue</button>' : ''}
          </div>
          <p class="note" id="migration-progress" role="status"></p>
          <div id="migration-month-editor" class="migration-month-editor"></div>
        </section>
        <div class="note" id="migration-preview" role="status" tabindex="-1"></div>
        <p class="dialog-error" role="alert" id="migration-error" tabindex="-1">${esc(inventoryError || (!accounts.length && entries.length ? 'Add investment accounts before assigning these values.' : ''))}</p>
        <label class="dialog-check" id="migration-confirm-row" hidden><input type="checkbox" id="migration-confirm" disabled> ${opts.coverageOnly ? 'I reviewed the completeness decisions.' : 'I reviewed the assignments and completeness decisions.'}</label>
      </div>
      <div class="dialog-actions"><button class="btn btn-sm btn-ghost js-cancel">Cancel</button><button class="btn btn-sm btn-ghost js-back" hidden>Back to edit</button><button class="btn btn-sm btn-primary js-review"${inventoryError ? ' disabled' : ''}>Review</button><button class="btn btn-sm btn-primary js-submit" hidden disabled>Save</button></div>
    </div>`;
    const errorEl = overlay.querySelector<HTMLElement>('#migration-error')!;
    const preview = overlay.querySelector<HTMLElement>('#migration-preview')!;
    const confirm = overlay.querySelector<HTMLInputElement>('#migration-confirm')!;
    const submit = overlay.querySelector<HTMLButtonElement>('.js-submit')!;
    const reviewButton = overlay.querySelector<HTMLButtonElement>('.js-review')!;
    const backButton = overlay.querySelector<HTMLButtonElement>('.js-back')!;
    const confirmRow = overlay.querySelector<HTMLElement>('#migration-confirm-row')!;
    const editor = overlay.querySelector<HTMLElement>('#migration-month-editor')!;
    const monthInput = overlay.querySelector<HTMLInputElement>('#migration-month')!;
    wireMonthInputs(overlay);
    monthInput.disabled = !months.length;
    let monthIndex = 0;
    let reviewed: ValuationMigrationReview | null = null;
    let converted: Snapshot[] | null = null;
    const get = (id: string) =>
      overlay.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!.value;
    const entryTotal = (i: number) =>
      allocationValues[i].reduce((sum, value) => sum + Number(value), 0);
    const invalidAllocation = (i: number) =>
      allocationValues[i].some((value) => !Number.isFinite(Number(value)) || Number(value) < 0) ||
      !Number.isFinite(entryTotal(i));
    const unassigned = (i: number) =>
      invalidAllocation(i) ||
      !allocationValues[i].some((value) => value.trim() !== '') ||
      Math.abs(entryTotal(i) - entries[i].value) > POSITION_TOLERANCE;
    const accountChecks = opts.snapshots.flatMap((snapshot) =>
      accounts.map((account, j) => ({ snapshot, account, j })),
    );
    const checkAccount = ({ snapshot, account, j }: (typeof accountChecks)[number]) => {
      const positions = Object.values(accountPositionValues(snapshot, account.id!));
      const drafts = entries.flatMap((entry, i) =>
        entry.month === snapshot.date && allocationValues[i][j].trim() !== ''
          ? [Number(allocationValues[i][j])]
          : [],
      );
      const total = [...positions, ...drafts].reduce((sum, value) => sum + value, 0);
      const balance = snapshot[account.id!] ?? (account.key ? snapshot[account.key] : undefined);
      const recorded = typeof balance === 'number' && Number.isFinite(balance);
      let error = '';
      if (!Number.isFinite(total) || [...positions, ...drafts].some((value) => value < 0))
        error = 'Enter finite, non-negative ETF amounts.';
      else if (total !== 0 && isAccountClosedInMonth(account, snapshot.date))
        error = 'Account is closed for this month; ETF values must be zero.';
      else if (!recorded && (positions.length || drafts.length))
        error = 'Recorded account balance missing. Check the original snapshot.';
      else if (recorded && total - balance > POSITION_TOLERANCE)
        error = `ETFs exceed the account balance by ${fmtEur2(total - balance)}. Check the amounts or account.`;
      const remainder = recorded ? balance - total : 0;
      const totalOnly =
        !positions.length &&
        !drafts.length &&
        !entries.some((entry) => entry.month === snapshot.date);
      return {
        error,
        warning: !error && !totalOnly && remainder > POSITION_TOLERANCE,
        text:
          totalOnly && recorded
            ? `Account total ${fmtEur2(balance)} preserved. No ETF breakdown recorded; Not reviewed is valid. Add the breakdown later if needed.`
            : `${recorded ? `Balance ${fmtEur2(balance)}` : 'No recorded balance'} / recorded ETFs ${fmtEur2(total)}${error ? ` · ${error}` : remainder > POSITION_TOLERANCE ? ` · ${fmtEur2(remainder)} not itemized: may be cash or unrecorded ETFs. Check your statement; do not assume cash.` : recorded ? ' · Balance matched.' : ''}`,
      };
    };
    const updateProgress = () => {
      const missing = new Set(
        entries.filter((_, i) => unassigned(i)).map((entry) => entry.month.slice(0, 7)),
      );
      const accountErrors = new Set(
        accountChecks
          .filter((check) => checkAccount(check).error)
          .map(({ snapshot }) => snapshot.date.slice(0, 7)),
      );
      overlay.querySelector('#migration-progress')!.textContent = months.length
        ? `Month ${monthIndex + 1} of ${months.length}${opts.coverageOnly ? '' : ` · ${missing.size} ${missing.size === 1 ? 'month' : 'months'} unassigned`}${accountErrors.size ? ` · ${accountErrors.size} ${accountErrors.size === 1 ? 'month' : 'months'} with account balance issues` : ''}`
        : 'No saved months.';
      const next = overlay.querySelector<HTMLButtonElement>('.js-unassigned');
      if (next) next.disabled = missing.size === 0 && accountErrors.size === 0;
      overlay.querySelector('#migration-page')!.textContent =
        `${months.length ? monthIndex + 1 : 0} / ${months.length}`;
    };
    const updateReconciliation = () => {
      for (const row of editor.querySelectorAll<HTMLElement>('[data-total]')) {
        const i = Number(row.dataset.total);
        const assigned = allocationValues[i].some((value) => value.trim() !== '');
        const difference = entryTotal(i) - entries[i].value;
        const status = invalidAllocation(i)
          ? 'Invalid amount: use finite, non-negative values.'
          : !assigned
            ? `Missing assignment: allocate ${fmtEur2(entries[i].value)}.`
            : Math.abs(difference) > POSITION_TOLERANCE
              ? `${fmtEur2(Math.abs(difference))} ${difference > 0 ? 'too high' : 'still missing'}.`
              : 'Total matched.';
        row.textContent = `${entries[i].isin} · Before ${fmtEur2(entries[i].value)} → After ${assigned ? fmtEur2(entryTotal(i)) : 'unassigned'} · ${status}`;
        row.className = unassigned(i) ? 'note migration-reconcile-error' : 'note';
        for (const field of editor.querySelectorAll<HTMLInputElement>(`[data-entry="${i}"]`))
          field.setAttribute('aria-invalid', String(unassigned(i)));
      }
      for (const row of editor.querySelectorAll<HTMLElement>('[data-account-check]')) {
        const status = checkAccount(accountChecks[Number(row.dataset.accountCheck)]);
        row.textContent = status.text;
        row.className = status.error
          ? 'note migration-reconcile-error'
          : status.warning
            ? 'note migration-reconcile-warning'
            : 'note';
      }
    };
    const renderPreview = () => {
      if (!converted) {
        preview.textContent = '';
        return;
      }
      const month = months[monthIndex];
      const totals = entries.flatMap((entry, i) =>
        entry.month.slice(0, 7) === month
          ? [
              `<div class="migration-preview-row"><span>${esc(entry.isin)}</span><span>Before ${fmtEur2(entry.value)} → After ${fmtEur2(entryTotal(i))}</span></div>`,
            ]
          : [],
      );
      const rows = converted
        .filter((snap) => snap.date.slice(0, 7) === month)
        .flatMap((snap) =>
          accounts.map((a) => {
            const subtotal = Object.values(accountPositionValues(snap, a.id!)).reduce(
              (sum, value) => sum + value,
              0,
            );
            const balance = snap[a.id!] ?? (a.key ? snap[a.key] : undefined);
            const state = snap[coverageKey(a.id!)];
            return `<div class="migration-preview-row"><span>${esc(a.label)}</span><span>ETF ${fmtEur2(subtotal)} / balance ${typeof balance === 'number' ? fmtEur2(balance) : 'not recorded'}</span><span class="note">${state === 1 ? 'Complete' : state === 0 ? 'Partial' : 'Not reviewed'}</span></div>`;
          }),
        );
      preview.innerHTML = `<p class="migration-preview-title">${opts.coverageOnly ? 'Amounts and balances unchanged.' : `All ${entries.length} month/ISIN totals conserved.`}</p><p>Showing ${esc(month || '')} · use the month navigation to inspect other months.</p>${totals.join('')}${rows.join('')}`;
    };
    const renderMonth = () => {
      const month = months[monthIndex];
      monthInput.value = month || '';
      validateMonthInput(monthInput);
      overlay.querySelector<HTMLButtonElement>('.js-month-prev')!.disabled = monthIndex === 0;
      overlay.querySelector<HTMLButtonElement>('.js-month-next')!.disabled =
        monthIndex >= months.length - 1;
      const monthEntries = entries
        .map((entry, i) => ({ entry, i }))
        .filter(({ entry }) => entry.month.slice(0, 7) === month);
      const savedValues = monthEntries.length
        ? `<fieldset class="migration-section"><legend>Saved ETF breakdown</legend>${monthEntries.map(({ entry }) => `<div class="migration-preview-row note"><span>${esc(entry.isin)}</span><span>Saved ${fmtEur2(entry.value)}</span></div>`).join('')}<p class="note">${accounts.length === 1 ? `Prefilled for ${esc(accounts[0].label)}, the only investment account. Review balances and completeness.` : "Choose Use saved values here below to assign this breakdown to an account. Replaces this month's splits; use Bulk actions for a period."}</p></fieldset>`
        : '';
      editor.innerHTML =
        savedValues +
        accounts
          .map((account, j) => {
            const values = monthEntries
              .map(
                ({ entry, i }) =>
                  `<label class="dialog-field"><span class="dialog-label">${esc(entry.isin)}</span><input id="migration-${i}-${j}" class="form-input" type="number" min="0" step="any" data-entry="${i}" data-account="${esc(account.id!)}" data-account-index="${j}" aria-describedby="migration-total-${i}" value="${esc(allocationValues[i][j])}" placeholder="Unassigned"></label>`,
              )
              .join('');
            const coverage = coverageRows
              .flatMap((row, i) =>
                row.accountId === account.id && row.month.slice(0, 7) === month
                  ? [
                      `<label class="dialog-field"><span class="dialog-label">Completeness${row.month !== month ? ` · ${esc(row.month)}` : ''}</span><select class="form-input" data-coverage-review="${i}">${coverageOptions(coverageValues[i])}</select></label>`,
                    ]
                  : [],
              )
              .join('');
            const checks = accountChecks
              .flatMap((check, i) =>
                check.account === account && check.snapshot.date.slice(0, 7) === month
                  ? [`<p class="note" data-account-check="${i}"></p>`]
                  : [],
              )
              .join('');
            const recordedValues = opts.snapshots
              .filter((snapshot) => snapshot.date.slice(0, 7) === month)
              .flatMap((snapshot) =>
                Object.entries(accountPositionValues(snapshot, account.id!)).map(
                  ([isin, value]) =>
                    `<div class="migration-preview-row note" data-saved-position="${esc(isin)}"><span>${esc(isin)}</span><span>Saved ${fmtEur2(value)}</span></div>`,
                ),
              )
              .join('');
            const assign = monthEntries.length
              ? `<div class="dialog-row dialog-row-center"><button type="button" class="btn btn-sm btn-outline js-assign-month" data-account-id="${esc(account.id!)}" aria-label="Assign saved breakdown to ${esc(account.label)}">Use saved values here</button></div>`
              : '';
            return values || coverage || recordedValues
              ? `<fieldset class="migration-section"><legend>${esc(account.label)}</legend>${checks}${recordedValues}${assign}${values}${coverage}</fieldset>`
              : '';
          })
          .join('');
      editor.insertAdjacentHTML(
        'beforeend',
        monthEntries
          .map(
            ({ entry, i }) =>
              `<p class="note" id="migration-total-${i}" data-total="${i}" role="status"></p>`,
          )
          .join(''),
      );
      updateReconciliation();
      updateProgress();
      renderPreview();
    };
    const invalidate = () => {
      if (!inventoryError) errorEl.textContent = '';
      reviewed = null;
      converted = null;
      confirm.checked = false;
      confirm.disabled = true;
      submit.disabled = true;
      submit.hidden = true;
      reviewButton.hidden = false;
      backButton.hidden = true;
      confirmRow.hidden = true;
      preview.textContent = '';
    };
    backButton.addEventListener('click', () => {
      invalidate();
      monthInput.focus();
    });
    const readAssignments = () =>
      entries.map((entry, i) => ({
        month: entry.month,
        isin: entry.isin,
        allocations: Object.fromEntries(
          accounts.flatMap((a, j) =>
            allocationValues[i][j].trim() === '' ? [] : [[a.id!, Number(allocationValues[i][j])]],
          ),
        ),
      }));
    const readCoverage = () =>
      coverageRows.flatMap((row, i) =>
        coverageValues[i] === '' && row.state !== 0 && row.state !== 1
          ? []
          : [
              {
                month: row.month,
                accountId: row.accountId,
                complete: coverageValues[i] === '' ? null : coverageValues[i] === '1',
              },
            ],
      );
    editor.addEventListener('input', (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.dataset.entry === undefined) return;
      const i = Number(input.dataset.entry);
      allocationValues[i][Number(input.dataset.accountIndex)] = input.value;
      invalidate();
      updateReconciliation();
      updateProgress();
    });
    editor.addEventListener('change', (event) => {
      const select = event.target;
      if (!(select instanceof HTMLSelectElement) || select.dataset.coverageReview === undefined)
        return;
      coverageValues[Number(select.dataset.coverageReview)] = select.value;
      invalidate();
    });
    const assignSavedValues = (indices: number[], accountId: string) => {
      invalidate();
      for (const i of indices)
        allocationValues[i] = accounts.map((account) =>
          account.id === accountId ? String(entries[i].value) : '',
        );
      renderMonth();
    };
    editor.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.js-assign-month');
      if (!button) return;
      assignSavedValues(
        entries.flatMap((entry, i) => (entry.month.slice(0, 7) === months[monthIndex] ? [i] : [])),
        button.dataset.accountId!,
      );
    });
    overlay.querySelector('.js-month-prev')!.addEventListener('click', () => {
      monthIndex--;
      renderMonth();
    });
    overlay.querySelector('.js-month-next')!.addEventListener('click', () => {
      monthIndex++;
      renderMonth();
    });
    monthInput.addEventListener('change', () => {
      const index = months.indexOf(monthInput.value);
      if (index < 0) {
        monthInput.setCustomValidity('Choose a saved month or use Previous / Next.');
        monthInput.setAttribute('aria-invalid', 'true');
        overlay.querySelector('#migration-month-error')!.textContent =
          'Choose a saved month or use Previous / Next.';
        return;
      }
      monthIndex = index;
      renderMonth();
    });
    overlay.querySelector('.js-unassigned')?.addEventListener('click', () => {
      for (let offset = 1; offset <= months.length; offset++) {
        const index = (monthIndex + offset) % months.length;
        if (
          entries.some((entry, i) => entry.month.slice(0, 7) === months[index] && unassigned(i)) ||
          accountChecks.some(
            (check) =>
              check.snapshot.date.slice(0, 7) === months[index] && checkAccount(check).error,
          )
        ) {
          monthIndex = index;
          renderMonth();
          break;
        }
      }
    });
    const period = () => {
      const fromInput = overlay.querySelector<HTMLInputElement>('#migration-from')!;
      const toInput = overlay.querySelector<HTMLInputElement>('#migration-to')!;
      const validFrom = validateMonthInput(fromInput);
      const validTo = validateMonthInput(toInput);
      if (!validFrom || !validTo) throw new Error('Choose a valid month within the saved history.');
      if (fromInput.value && toInput.value && fromInput.value > toInput.value)
        throw new Error('The date range is reversed.');
      return { from: fromInput.value, to: toInput.value };
    };
    const inPeriod = (month: string, from: string, to: string) =>
      (!from || month.slice(0, 7) >= from) && (!to || month.slice(0, 7) <= to);
    const updatePeriod = () => {
      overlay.querySelector('#migration-period')!.textContent =
        !get('migration-from') && !get('migration-to')
          ? 'All saved months'
          : `${get('migration-from') || 'First saved month'} → ${get('migration-to') || 'Last saved month'}`;
    };
    overlay
      .querySelectorAll('#migration-from, #migration-to')
      .forEach((input) => input.addEventListener('input', updatePeriod));
    overlay.querySelector('.js-all-months')!.addEventListener('click', () => {
      for (const id of ['migration-from', 'migration-to']) {
        const input = overlay.querySelector<HTMLInputElement>(`#${id}`)!;
        input.value = '';
        validateMonthInput(input);
      }
      updatePeriod();
    });
    overlay.querySelector('.js-coverage-rule')!.addEventListener('click', () => {
      try {
        const { from, to } = period();
        const matches = coverageRows
          .map((row, i) => ({ row, i }))
          .filter(
            ({ row }) =>
              row.accountId === get('migration-account') && inPeriod(row.month, from, to),
          );
        if (!matches.length)
          throw new Error('No recorded account balances match this completeness period/account.');
        invalidate();
        matches.forEach(({ i }) => {
          coverageValues[i] = get('migration-coverage-state');
        });
        renderMonth();
        errorEl.textContent = '';
        overlay.querySelector('#migration-coverage-status')!.textContent =
          `Updated completeness for ${matches.length} account/months. Review before saving.`;
      } catch (error) {
        errorEl.textContent = error instanceof Error ? error.message : String(error);
        errorEl.focus();
      }
    });
    overlay.querySelector('.js-rule')?.addEventListener('click', () => {
      try {
        const { from, to } = period();
        const isin = get('migration-isin').trim().toUpperCase();
        const matches = entries
          .map((entry, i) => ({ entry, i }))
          .filter(({ entry }) => inPeriod(entry.month, from, to) && (!isin || entry.isin === isin));
        if (!matches.length)
          throw new Error(
            'No saved ETF values match this period and ISIN. No assignments changed.',
          );
        assignSavedValues(
          matches.map(({ i }) => i),
          get('migration-account'),
        );
        errorEl.textContent = '';
      } catch (error) {
        errorEl.textContent = error instanceof Error ? error.message : String(error);
        errorEl.focus();
      }
    });
    overlay.querySelector('.js-review')!.addEventListener('click', () => {
      invalidate();
      try {
        const assignments = readAssignments();
        const coverage = readCoverage();
        converted = migratePositionSnapshots(opts.snapshots, opts.accounts, assignments, coverage);
        reviewed = { assignments, coverage };
        renderPreview();
        errorEl.textContent = '';
        confirm.disabled = false;
        confirmRow.hidden = false;
        reviewButton.hidden = true;
        backButton.hidden = false;
        submit.hidden = false;
        preview.focus();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const index = months.findIndex((month) => message.includes(month));
        if (index >= 0) {
          monthIndex = index;
          renderMonth();
        }
        errorEl.textContent = message;
        errorEl.focus();
      }
    });
    confirm.addEventListener('change', () => {
      submit.disabled = !reviewed || !confirm.checked;
    });
    overlay.querySelector('.js-backup')?.addEventListener('click', async () => {
      const button = overlay.querySelector<HTMLButtonElement>('.js-backup')!;
      button.disabled = true;
      try {
        await opts.exportBackup!();
        overlay.querySelector('#migration-backup-status')!.textContent = 'Backup exported.';
      } catch (error) {
        errorEl.textContent = `Backup failed: ${error instanceof Error ? error.message : String(error)}`;
        errorEl.focus();
      } finally {
        button.disabled = false;
      }
    });
    renderMonth();
    openDialogShell(dialog, {
      overlay,
      onDismiss: () => dialog.dismiss(null),
      onCancel: () => dialog.dismiss(null),
      cancelSelector: '.js-cancel',
      submitSelector: '.js-submit',
      onSubmit: () => {
        if (reviewed && confirm.checked) dialog.dismiss(reviewed);
      },
    });
  });
}
