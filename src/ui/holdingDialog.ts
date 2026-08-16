/**
 * Promise-based add/edit holding modal. All fields visible at once with inline validation.
 * Resolves with the Holding draft on submit, or null on cancel/dismiss.
 */

import { esc } from '../utils';
import type { Holding } from '../types';
import { ASSET_CLASSES, REGIONS } from '../model/accountTypes';
import { filterSecuritySuggestions, type SecuritySuggestions } from '../model/securitySuggestions';
import { ISIN_HINT, isValidISIN, normalizeISIN } from '../model/isin';
import {
  bindColorInputs,
  createDialogController,
  DIALOG_FOCUSABLES,
  focusFirstInvalid,
  makeDialogHelpers,
  openDialogShell,
} from './modalShell';
import { infoTip, attachInfoTips } from './infoTip';
import { attachSecurityAutocomplete } from './securityAutocomplete';

export interface HoldingDialogOptions {
  existing?: Holding;
  suggestions?: SecuritySuggestions;
  /** Order index to assign to a new holding. */
  order?: number;
  existingIsins?: string[];
}

let _activeExisting: Holding | undefined = undefined;
let _activeOrder: number = 1;
let _activeExistingIsins: Set<string> = new Set();
let _activeSuggestionPairs: SecuritySuggestions['pairs'] = [];
const _dialog = createDialogController<Holding | null>(null, {
  overlaySelector: '.hold-dialog-overlay',
  reset: () => {
    _activeExisting = undefined;
    _activeOrder = 1;
    _activeExistingIsins = new Set();
    _activeSuggestionPairs = [];
  },
});

export function holdingDialog(opts: HoldingDialogOptions = {}): Promise<Holding | null> {
  return new Promise<Holding | null>((resolve) => {
    _dialog.begin(resolve);
    _activeExisting = opts.existing;
    _activeOrder = opts.order ?? 1;
    _activeExistingIsins = new Set(
      (opts.existingIsins ?? []).map((isin) => isin.trim().toUpperCase()),
    );
    _activeSuggestionPairs = filterSecuritySuggestions(opts.suggestions, opts.existingIsins).pairs;
    const existing = opts.existing;
    const title = existing ? 'Edit holding' : 'Add holding';

    const assetClassOptions = ASSET_CLASSES.map(
      (c) =>
        `<option value="${esc(c.value)}" ${(existing?.assetClass || 'equity') === c.value ? 'selected' : ''}>${esc(c.label)}</option>`,
    ).join('');

    const regionOptions = REGIONS.map(
      (r) =>
        `<option value="${esc(r.value)}" ${(existing?.region || 'developed') === r.value ? 'selected' : ''}>${esc(r.label)}</option>`,
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay hold-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'hold-dialog-title');

    overlay.innerHTML = `
      <div class="dialog-card hold-dialog-card">
        <div class="dialog-header">
          <div class="dialog-title" id="hold-dialog-title">${esc(title)}</div>
        </div>
        <div class="dialog-fields">
          <div class="dialog-row">
            <div class="dialog-field">
              <label class="dialog-label" for="holdd-isin">
                ISIN${infoTip('International Securities Identification Number: 12-character unique ID.')}
              </label>
              <input type="text" id="holdd-isin" class="form-input dialog-input dialog-input-uppercase"
                value="${esc(existing?.isin || '')}" placeholder="e.g. IE00B4L5Y983" list="holdd-isin-list"
                autocomplete="off">
              <datalist id="holdd-isin-list"></datalist>
              <span class="dialog-error" id="holdd-isin-err"></span>
            </div>
            <div class="dialog-field">
              <label class="dialog-label" for="holdd-short-name">
                Short name${infoTip('A short label (max 10 chars) used in charts and legends.')}
              </label>
              <input type="text" id="holdd-short-name" class="form-input dialog-input"
                value="${esc(existing?.shortName || '')}" placeholder="e.g. IWDA" maxlength="10">
              <span class="dialog-error" id="holdd-short-name-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" for="holdd-name">
                Name${infoTip('Full instrument name, as shown in your broker statements.')}
              </label>
              <input type="text" id="holdd-name" class="form-input dialog-input"
                value="${esc(existing?.name || '')}" placeholder="e.g. iShares Core MSCI World UCITS ETF"
                list="holdd-name-list" autocomplete="off">
              <datalist id="holdd-name-list"></datalist>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field">
              <label class="dialog-label" for="holdd-class">
                Asset class${infoTip('The category this holding belongs to. Used to group your allocation.')}
              </label>
              <select id="holdd-class" class="form-input dialog-input">${assetClassOptions}</select>
            </div>
            <div class="dialog-field">
              <label class="dialog-label" for="holdd-region">
                Region${infoTip('The geographic focus of this holding.')}
              </label>
              <select id="holdd-region" class="form-input dialog-input">${regionOptions}</select>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field">
              <label class="dialog-label" for="holdd-target-pct">
                Target (%)${infoTip('Strategic allocation target for this holding as a percentage of the total portfolio.')}
              </label>
              <input type="number" id="holdd-target-pct" class="form-input dialog-input"
                value="${esc(String(existing?.targetPct ?? ''))}" min="0" max="100" step="0.1" placeholder="e.g. 60">
            </div>
            <div class="dialog-field">
              <label class="dialog-label" for="holdd-ter">
                TER (%)${infoTip('Total Expense Ratio: the annual fund fee as a percentage (e.g. 0.20 for 0.20%).')}
              </label>
              <input type="number" id="holdd-ter" class="form-input dialog-input"
                value="${esc(String(existing?.ter ?? ''))}" min="0" step="0.01" max="5" placeholder="e.g. 0.20">
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field">
              <label class="dialog-label" style="cursor:pointer">
                <input type="checkbox" id="holdd-acc" ${existing?.acc !== false ? 'checked' : ''}>
                Accumulating${infoTip('Acc ETFs reinvest dividends; Dist ETFs pay them out.')}
              </label>
            </div>
            <div class="dialog-field">
              <label class="dialog-label" style="cursor:pointer">
                <input type="checkbox" id="holdd-active" ${existing?.active !== false ? 'checked' : ''}>
                Active
              </label>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field dialog-field-compact">
              <label class="dialog-label" for="holdd-color-hex">Color</label>
              <div class="color-picker-wrap">
                <input type="color" id="holdd-color" class="color-picker-swatch"
                  value="${esc(existing?.color || '#888888')}" aria-label="Color picker">
                <input type="text" id="holdd-color-hex" class="form-input dialog-input color-picker-hex"
                  value="${esc(existing?.color || '#888888')}" placeholder="#888888" maxlength="7">
              </div>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" for="holdd-notes">
                Notes${infoTip('Optional free-text notes: index changes, mergers, reminders, or any context about this holding.')}
              </label>
              <textarea id="holdd-notes" class="form-input dialog-input" rows="3"
                placeholder="e.g. Switched index from MSCI World to FTSE All-World in Oct 2024">${esc(existing?.notes || '')}</textarea>
            </div>
          </div>
        </div>
          <div class="dialog-row">
            <div class="dialog-field">
              <label class="dialog-label" for="holdd-notes">
                Notes${infoTip('Optional free-text notes: index changes, mergers, reminders, or any context about this holding.')}
              </label>
              <textarea id="holdd-notes" class="form-input dialog-input" rows="3"
                placeholder="e.g. Switched index from MSCI World to FTSE All-World in Oct 2024">${esc(existing?.notes || '')}</textarea>
            </div>
          </div>
        <div class="dialog-actions">
          <button class="btn btn-sm btn-ghost js-holdd-cancel">Cancel</button>
          <button class="btn btn-sm btn-primary js-holdd-submit">${existing ? 'Save changes' : 'Add holding'}</button>
        </div>
      </div>`;

    openDialogShell(_dialog, {
      overlay,
      onDismiss: () => _dismiss(null),
      onCancel: () => _dismiss(null),
      onSubmit: _submit,
      cancelSelector: '.js-holdd-cancel',
      submitSelector: '.js-holdd-submit',
      focusablesSelector: DIALOG_FOCUSABLES,
      initialFocusSelector: '#holdd-isin',
    });
    attachInfoTips(overlay);

    attachSecurityAutocomplete({
      overlay,
      pairs: _activeSuggestionPairs,
      isinInputId: 'holdd-isin',
      isinListId: 'holdd-isin-list',
      nameInputId: 'holdd-name',
      nameListId: 'holdd-name-list',
    });

    bindColorInputs(overlay, 'holdd-color', 'holdd-color-hex');
    _bindRealtimeIsinValidation(overlay);
  });
}

function _submit(): void {
  const overlay = _dialog.overlay();
  if (!overlay) return;

  const { get, getChecked, setErr } = makeDialogHelpers(overlay);

  ['holdd-isin', 'holdd-short-name'].forEach((f) => setErr(f, ''));

  const isinVal = normalizeISIN(get('holdd-isin'));
  const shortNameVal = get('holdd-short-name');
  const nameVal = get('holdd-name');
  const assetClassVal = get('holdd-class') || 'equity';
  const regionVal = get('holdd-region') || 'developed';
  const targetPctRaw = get('holdd-target-pct');
  const terRaw = get('holdd-ter');
  const colorVal = get('holdd-color-hex') || get('holdd-color') || '#888888';
  const isAcc = getChecked('holdd-acc');
  const isActive = getChecked('holdd-active');
  const notesVal = get('holdd-notes');

  let valid = true;

  if (!isinVal) {
    setErr('holdd-isin', 'ISIN is required.');
    valid = false;
  } else if (!isValidISIN(isinVal)) {
    setErr('holdd-isin', ISIN_HINT);
    valid = false;
  } else if (_activeExistingIsins.has(isinVal)) {
    setErr('holdd-isin', 'This ISIN is already defined in another holding.');
    valid = false;
  }
  if (!shortNameVal) {
    setErr('holdd-short-name', 'Short name is required.');
    valid = false;
  }

  if (!valid) {
    focusFirstInvalid(overlay);
    return;
  }

  const existing = _activeExisting;
  const draft: Holding = {
    isin: isinVal,
    shortName: shortNameVal.slice(0, 10),
    name: nameVal,
    color: /^#[0-9a-fA-F]{6}$/.test(colorVal) ? colorVal : existing?.color || '#888888',
    acc: isAcc,
    active: isActive,
    targetPct: targetPctRaw !== '' ? parseFloat(targetPctRaw) || 0 : undefined,
    assetClass: assetClassVal,
    region: regionVal,
    foldInto: existing?.foldInto || '',
    order: existing?.order ?? _activeOrder,
    ter: terRaw !== '' ? parseFloat(terRaw) || 0 : undefined,
    ...(notesVal.trim() ? { notes: notesVal.trim() } : {}),
  };

  _dismiss(draft);
}

function _dismiss(result: Holding | null): void {
  _dialog.dismiss(result);
}

function _bindRealtimeIsinValidation(overlay: HTMLElement): void {
  const isinInput = overlay.querySelector('#holdd-isin') as HTMLInputElement | null;
  if (!isinInput) return;
  const { setErr } = makeDialogHelpers(overlay);
  const validate = (mode: 'input' | 'blur'): void => {
    const isin = normalizeISIN(isinInput.value);
    if (!isin) {
      if (mode === 'blur') setErr('holdd-isin', 'ISIN is required.');
      else setErr('holdd-isin', '');
      return;
    }
    if (!isValidISIN(isin)) {
      setErr('holdd-isin', ISIN_HINT);
      return;
    }
    if (_activeExistingIsins.has(isin)) {
      setErr('holdd-isin', 'This ISIN is already defined in another holding.');
      return;
    }
    setErr('holdd-isin', '');
  };
  isinInput.addEventListener('input', () => validate('input'));
  isinInput.addEventListener('blur', () => validate('blur'));
}
