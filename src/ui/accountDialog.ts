/**
 * Promise-based add/edit account modal. All fields visible at once with inline validation.
 * Resolves with the Account draft on submit, or null on cancel/dismiss.
 */

import { esc } from '../utils';
import type { Account, ContribInterval } from '../types';
import { INTERVAL_LABELS } from '../model/contributions';
import { ACCOUNT_TYPES } from '../model/accountTypes';
import {
  activateModalShell,
  bindColorInputs,
  createDialogController,
  focusFirstInvalid,
  makeDialogHelpers,
  populateDatalist,
} from './modalShell';
import { infoTip, attachInfoTips } from './infoTip';

export interface AccountDialogOptions {
  existing?: Account;
  /** Suggestions for the account label autocomplete. */
  labelSuggestions?: string[];
  /** Suggestions for the institution autocomplete. */
  institutionSuggestions?: string[];
  /** Existing account labels excluding the record being edited. */
  existingLabels?: string[];
}

let _activeExisting: Account | undefined = undefined;
let _activeExistingLabelsList: string[] = [];
const _dialog = createDialogController<Account | null>(null, {
  overlaySelector: '.acct-dialog-overlay',
  reset: () => {
    _activeExisting = undefined;
    _activeExistingLabelsList = [];
  },
});

export function accountDialog(opts: AccountDialogOptions = {}): Promise<Account | null> {
  return new Promise<Account | null>((resolve) => {
    _dialog.begin(resolve);
    _activeExisting = opts.existing;
    _activeExistingLabelsList = opts.existingLabels ?? [];
    const existing = opts.existing;
    const title = existing ? 'Edit account' : 'Add account';

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay acct-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'acct-dialog-title');

    const typeOptions = ACCOUNT_TYPES.map(
      (t) =>
        `<option value="${esc(t.value)}" ${(existing?.moneyType || 'cash') === t.value ? 'selected' : ''}>${esc(t.label)}</option>`,
    ).join('');

    const intervalOptions = Object.entries(INTERVAL_LABELS)
      .map(
        ([val, label]) =>
          `<option value="${val}" ${(existing?.contribInterval || 'monthly') === val ? 'selected' : ''}>${label}</option>`,
      )
      .join('');

    const isPrimary = existing?.isPrimaryInvestment ?? false;
    const isLocked = existing?.locked ?? false;

    overlay.innerHTML = `
      <div class="dialog-card acct-dialog-card">
        <div class="dialog-header">
          <div class="dialog-title" id="acct-dialog-title">${esc(title)}</div>
        </div>
        <div class="dialog-fields">
          <div class="dialog-row">
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" for="acctd-label">Name</label>
              <input type="text" id="acctd-label" class="form-input dialog-input"
                value="${esc(existing?.label || '')}" placeholder="e.g. Main ETF portfolio">
              <span class="dialog-error" id="acctd-label-err"></span>
            </div>
            <div class="dialog-field">
              <label class="dialog-label" for="acctd-type">Type</label>
              <select id="acctd-type" class="form-input dialog-input">${typeOptions}</select>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" for="acctd-institution">Institution</label>
              <input type="text" id="acctd-institution" class="form-input dialog-input"
                value="${esc(existing?.institution || '')}" placeholder="e.g. Trade Republic"
                list="acctd-institution-list">
              <datalist id="acctd-institution-list"></datalist>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field">
              <label class="dialog-label" for="acctd-return">
                Annual return (%)${infoTip("Used for this account's slice of the 5-year forecast. Cash/savings are typically 0% unless they earn interest.")}
              </label>
              <input type="number" id="acctd-return" class="form-input dialog-input"
                value="${esc(String(existing?.annualReturnPct ?? 0))}" min="-100" max="100" step="0.1" placeholder="0">
              <span class="dialog-error" id="acctd-return-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" style="cursor:pointer">
                <input type="checkbox" id="acctd-primary" ${isPrimary ? 'checked' : ''}>
                Primary investment${infoTip('Used to split net-worth growth into contributions vs market returns. Only investment-type accounts should be marked.')}
              </label>
            </div>
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" style="cursor:pointer">
                <input type="checkbox" id="acctd-locked" ${isLocked ? 'checked' : ''}>
                Locked until retirement${infoTip('Funds not accessible until retirement. Used to separate liquid net worth from locked retirement assets.')}
              </label>
            </div>
          </div>
          <div id="acctd-contrib-block" style="${isPrimary ? 'display:none' : ''}">
            <div class="dialog-row">
              <div class="dialog-field">
                <label class="dialog-label" for="acctd-contrib">
                  Contribution (€)${infoTip('How much moves into this account each time, at the interval below.')}
                </label>
                <input type="number" id="acctd-contrib" class="form-input dialog-input"
                  value="${esc(String(existing?.contribAmount ?? 0))}" min="0" step="1" placeholder="0">
              </div>
              <div class="dialog-field">
                <label class="dialog-label" for="acctd-interval">Interval</label>
                <select id="acctd-interval" class="form-input dialog-input">${intervalOptions}</select>
              </div>
            </div>
            <div class="dialog-row" id="acctd-primary-note" style="${isPrimary ? '' : 'display:none'}">
              <p class="note" style="margin:0">Contribution amount for the primary investment account comes from the Holdings card.</p>
            </div>
          </div>
          <div id="acctd-locked-block" style="${isLocked ? '' : 'display:none'}">
            <div class="dialog-row">
              <div class="dialog-field">
                <label class="dialog-label" for="acctd-locked-until">
                  Accessible from (year)${infoTip('The year when funds in this account become accessible.')}
                </label>
                <input type="number" id="acctd-locked-until" class="form-input dialog-input"
                  value="${esc(existing?.lockedUntil || '')}" min="2025" max="2100" step="1" placeholder="e.g. 2055">
              </div>
              <div class="dialog-field">
                <label class="dialog-label" for="acctd-extra-contrib">
                  Extra contribution (€)${infoTip('Additional contribution per execution (employer match, state subsidy, etc.).')}
                </label>
                <input type="number" id="acctd-extra-contrib" class="form-input dialog-input"
                  value="${esc(String(existing?.extraContrib ?? 0))}" min="0" step="1" placeholder="0">
              </div>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field dialog-field-compact">
              <label class="dialog-label" for="acctd-color-hex">Color</label>
              <div class="color-picker-wrap">
                <input type="color" id="acctd-color" class="color-picker-swatch"
                  value="${esc(existing?.color || '#888888')}" aria-label="Color picker">
                <input type="text" id="acctd-color-hex" class="form-input dialog-input color-picker-hex"
                  value="${esc(existing?.color || '#888888')}" placeholder="#888888" maxlength="7">
              </div>
            </div>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-sm btn-ghost js-acctd-cancel">Cancel</button>
          <button class="btn btn-sm btn-primary js-acctd-submit">${existing ? 'Save changes' : 'Add account'}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    _dialog.setOverlay(overlay);
    attachInfoTips(overlay);

    // Populate datalists via DOM API (no esc needed — no innerHTML)
    populateDatalist(overlay.querySelector('#acctd-institution-list'), opts.institutionSuggestions ?? []);
    bindColorInputs(overlay, 'acctd-color', 'acctd-color-hex');

    // Primary investment toggle — show/hide contrib block
    const primaryCb = overlay.querySelector('#acctd-primary') as HTMLInputElement | null;
    const contribBlock = overlay.querySelector('#acctd-contrib-block') as HTMLElement | null;
    primaryCb?.addEventListener('change', () => {
      if (contribBlock) contribBlock.style.display = primaryCb.checked ? 'none' : '';
    });

    // Locked toggle — show/hide locked block
    const lockedCb = overlay.querySelector('#acctd-locked') as HTMLInputElement | null;
    const lockedBlock = overlay.querySelector('#acctd-locked-block') as HTMLElement | null;
    lockedCb?.addEventListener('change', () => {
      if (lockedBlock) lockedBlock.style.display = lockedCb.checked ? '' : 'none';
    });

    overlay.querySelector('.js-acctd-submit')?.addEventListener('click', () => _submit());
    overlay.querySelector('.js-acctd-cancel')?.addEventListener('click', () => _dismiss(null));
    _dialog.setCleanup(
      activateModalShell({
      overlay,
      onDismiss: () => _dismiss(null),
      onSubmitEnter: _submit,
      submitWhenActive: (active) => !!active?.classList.contains('js-acctd-submit'),
      focusablesSelector: 'input:not([disabled]), select:not([disabled]), button:not([disabled])',
      }),
    );

    (overlay.querySelector('#acctd-label') as HTMLElement | null)?.focus();
  });
}

function _submit(): void {
  const overlay = _dialog.overlay();
  if (!overlay) return;

  const { get, getChecked, setErr } = makeDialogHelpers(overlay);

  ['acctd-label', 'acctd-return'].forEach((f) => setErr(f, ''));

  const labelVal = get('acctd-label');
  const typeVal = get('acctd-type') || 'cash';
  const institutionVal = get('acctd-institution');
  const colorVal = get('acctd-color-hex') || get('acctd-color') || '#888888';
  const returnRaw = get('acctd-return');
  const isPrimary = getChecked('acctd-primary');
  const isLocked = getChecked('acctd-locked');
  const contribRaw = get('acctd-contrib');
  const intervalVal = get('acctd-interval') || 'monthly';
  const lockedUntilVal = get('acctd-locked-until');
  const extraContribRaw = get('acctd-extra-contrib');

  let valid = true;

  if (!labelVal) {
    setErr('acctd-label', 'Name is required.');
    valid = false;
  } else if (!/[a-zA-Z0-9]/.test(labelVal)) {
    setErr('acctd-label', 'Name must contain at least one letter or digit.');
    valid = false;
  } else {
    const normalized = labelVal.trim().replace(/\s+/g, ' ').toLowerCase();
    const existingLabels = new Set(
      _activeExistingLabelsList.map((label) => label.trim().replace(/\s+/g, ' ').toLowerCase()),
    );
    if (existingLabels.has(normalized)) {
      setErr('acctd-label', 'This account name is already defined in another account.');
      valid = false;
    }
  }

  const returnPct = returnRaw !== '' ? parseFloat(returnRaw) : 0;
  if (returnRaw !== '' && isNaN(returnPct)) {
    setErr('acctd-return', 'Must be a number.');
    valid = false;
  } else if (returnPct < -100) {
    setErr('acctd-return', 'Cannot be below −100%.');
    valid = false;
  }

  if (!valid) {
    focusFirstInvalid(overlay);
    return;
  }

  const existing = _activeExisting;
  const draft: Account = {
    id: existing?.id,
    label: labelVal,
    moneyType: typeVal,
    institution: institutionVal,
    color: /^#[0-9a-fA-F]{6}$/.test(colorVal) ? colorVal : existing?.color || '#888888',
    isPrimaryInvestment: isPrimary,
    order: existing?.order,
    annualReturnPct: isNaN(returnPct) ? 0 : returnPct,
    contribAmount: isPrimary ? 0 : parseFloat(contribRaw) || 0,
    contribInterval: isPrimary ? 'monthly' : ((intervalVal || 'monthly') as ContribInterval),
    locked: isLocked,
    lockedUntil: isLocked ? lockedUntilVal : '',
    extraContrib: isLocked ? parseFloat(extraContribRaw) || 0 : 0,
  };

  _dismiss(draft);
}

function _dismiss(result: Account | null): void {
  _dialog.dismiss(result);
}
