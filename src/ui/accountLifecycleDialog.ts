import type { Account, Snapshot } from '../types';
import { isAccountOpenNow, validateAccountLifecycle } from '../model/accounts';
import { esc, fmtEur } from '../utils';
import { createDialogController, openDialogShell } from './modalShell';

export interface AccountLifecycleResult {
  accounts: Account[];
  settingsPatch: Record<string, string>;
}

export interface AccountLifecycleOptions {
  accounts: Account[];
  accountIndex: number;
  snapshots: Snapshot[];
  mode: 'close' | 'reopen' | 'correct';
  contributionBudget?: number;
}

const dialog = createDialogController<AccountLifecycleResult | null>(null);

function currentMonth(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function accountLifecycleDialog(
  opts: AccountLifecycleOptions,
): Promise<AccountLifecycleResult | null> {
  return new Promise((resolve) => {
    dialog.begin(resolve);
    const account = opts.accounts[opts.accountIndex];
    const periods = account.closedPeriods || [];
    const closing = opts.mode === 'close';
    const correcting = opts.mode === 'correct';
    const title = correcting
      ? 'Correct lifecycle dates'
      : closing
        ? 'Close account'
        : 'Reopen account';
    const now = currentMonth();
    const previous = new Date(`${now}-01T12:00:00`);
    previous.setMonth(previous.getMonth() - 1);
    const lastCompleted = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay settings-dialog-overlay lifecycle-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'lifecycle-title');
    overlay.innerHTML = `<div class="dialog-card">
      <div class="dialog-header"><h2 class="dialog-title" id="lifecycle-title">${title}: ${esc(account.label)}</h2></div>
      <div class="dialog-fields">
        <p class="note">${
          closing
            ? 'History, name and ID remain unchanged. First save a completed-month snapshot with an explicit zero balance and zero account-linked ETF values. Personal and extra contributions will become zero.'
            : 'Reuse this logical tracker record even if your bank issued a replacement account. History and ID remain unchanged. Contributions stay at zero; resume them separately.'
        }</p>
        ${closing ? `<p class="note">Contribution preview: personal ${fmtEur(account.contribAmount || 0)} → ${fmtEur(0)}; extra ${fmtEur(account.extraContrib || 0)} → ${fmtEur(0)}.${account.isPrimaryInvestment && opts.contributionBudget !== undefined ? ` Global budget ${fmtEur(opts.contributionBudget)}: keep it only with an explicitly chosen replacement, or stop it.` : ''}</p>` : ''}
        ${
          correcting
            ? `<p class="note">Date corrections change historical availability. Keep existing intervals unless correcting a mistake.</p>${periods
                .map(
                  (period, i) => `
          <div class="dialog-row dialog-row-relaxed">
            <label class="dialog-field"><span class="dialog-label">Closed from</span><input class="form-input" type="month" data-close="${i}" value="${esc(period.closedFromMonth)}" max="${lastCompleted}"></label>
            <label class="dialog-field"><span class="dialog-label">Reopened from (optional)</span><input class="form-input" type="month" data-reopen="${i}" value="${esc(period.reopenedFromMonth || '')}" max="${now}"></label>
          </div>`,
                )
                .join('')}`
            : `
          <label class="dialog-label" for="lifecycle-month">${closing ? 'Closed from month' : 'Reopened from month'}</label>
          <input class="form-input" id="lifecycle-month" type="month" value="${closing ? lastCompleted : now}" max="${closing ? lastCompleted : now}">`
        }
        ${
          closing && account.isPrimaryInvestment
            ? `
          <label class="dialog-label" for="lifecycle-primary">Contribution budget destination (required)</label>
          <select class="form-input" id="lifecycle-primary"><option value="">Choose explicitly…</option>
            ${opts.accounts
              .filter(
                (a) => a !== account && a.id && a.moneyType === 'investment' && isAccountOpenNow(a),
              )
              .map((a) => `<option value="${esc(a.id!)}">${esc(a.label)}</option>`)
              .join('')}
            <option value="stop">Stop global contribution budget</option>
          </select><p class="note">The old primary flag is cleared. Historical ETF values never move.</p>`
            : ''
        }
        <label class="dialog-check"><input type="checkbox" id="lifecycle-confirm"> I reviewed these ${correcting ? 'historical date corrections' : 'lifecycle and contribution changes'}.</label>
        <p class="dialog-error" role="alert" id="lifecycle-error"></p>
        <p class="note" id="lifecycle-blockers"></p>
        <a href="#log/snapshots" class="js-snapshots">Open Monthly snapshots to review or correct balances</a>
        <p class="note">Changes are staged only. Use Save accounts to persist, or discard account changes to undo.</p>
      </div>
      <div class="dialog-actions"><button class="btn btn-sm btn-ghost js-cancel">Cancel</button><button class="btn btn-sm btn-primary js-submit">Stage changes</button></div>
    </div>`;
    const get = (selector: string) => overlay.querySelector<HTMLInputElement>(selector)!.value;
    const fail = (message: string) => {
      overlay.querySelector('#lifecycle-error')!.textContent = message;
    };
    overlay.querySelector('.js-snapshots')!.addEventListener('click', () => dialog.dismiss(null));
    openDialogShell(dialog, {
      overlay,
      onDismiss: () => dialog.dismiss(null),
      onCancel: () => dialog.dismiss(null),
      cancelSelector: '.js-cancel',
      submitSelector: '.js-submit',
      initialFocusSelector: '#lifecycle-month',
      onSubmit: () => {
        if (!overlay.querySelector<HTMLInputElement>('#lifecycle-confirm')!.checked)
          return fail('Confirm your review before staging.');
        const nextPeriods = periods.map((period) => ({ ...period }));
        const next = { ...account, closedPeriods: nextPeriods };
        const settingsPatch: Record<string, string> = {};
        const accounts = opts.accounts.slice();
        if (correcting) {
          for (let i = 0; i < nextPeriods.length; i++) {
            const start = get(`[data-close="${i}"]`);
            const end = get(`[data-reopen="${i}"]`);
            if (!start || start > lastCompleted || (end && end > now))
              return fail('Closure must be a completed month; reopening cannot be in the future.');
            nextPeriods[i] = { closedFromMonth: start, ...(end ? { reopenedFromMonth: end } : {}) };
          }
        } else {
          const month = get('#lifecycle-month');
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > (closing ? lastCompleted : now))
            return fail(
              'Choose a valid completed closure month or a reopening month no later than today.',
            );
          if (closing) {
            nextPeriods.push({ closedFromMonth: month });
            next.contribAmount = 0;
            next.extraContrib = 0;
            next.isPrimaryInvestment = false;
            if (account.isPrimaryInvestment) {
              const primary = get('#lifecycle-primary');
              if (!primary)
                return fail('Select a replacement primary or explicitly stop the budget.');
              if (primary === 'stop') settingsPatch.monthly_contrib_budget = '0';
              else
                for (let i = 0; i < accounts.length; i++) {
                  if (i !== opts.accountIndex)
                    accounts[i] = {
                      ...accounts[i],
                      isPrimaryInvestment: accounts[i].id === primary,
                    };
                }
            }
          } else {
            const last = nextPeriods.at(-1);
            if (!last || last.reopenedFromMonth)
              return fail('There is no active closed period to reopen.');
            last.reopenedFromMonth = month;
            next.contribAmount = 0;
            next.extraContrib = 0;
            next.isPrimaryInvestment = false;
          }
        }
        accounts[opts.accountIndex] = next;
        const error = validateAccountLifecycle(accounts, opts.snapshots);
        if (error) {
          const aliases = new Set(
            [account.id, account.key].filter(Boolean).map((id) => id!.toLowerCase()),
          );
          overlay.querySelector('#lifecycle-blockers')!.textContent = opts.snapshots
            .flatMap((snap) => {
              const month = snap.date.slice(0, 7);
              if (
                !nextPeriods.some(
                  (period) =>
                    month >= period.closedFromMonth &&
                    (!period.reopenedFromMonth || month < period.reopenedFromMonth),
                )
              )
                return [];
              return Object.entries(snap)
                .filter(
                  ([key, value]) =>
                    value !== 0 &&
                    (aliases.has(key.toLowerCase()) ||
                      (key.startsWith('position:') &&
                        aliases.has(key.split(':')[1].toLowerCase()))),
                )
                .map(
                  ([key, value]) =>
                    `${snap.date} · ${key}: ${typeof value === 'number' ? fmtEur(value) : String(value)}`,
                );
            })
            .join('; ');
          return fail(`${error} Review the corresponding month in Monthly snapshots.`);
        }
        dialog.dismiss({ accounts, settingsPatch });
      },
    });
  });
}
