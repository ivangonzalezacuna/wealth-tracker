/**
 * Promise-based add/edit transaction modal. All fields visible at once with inline validation.
 * Resolves with the Transaction draft on submit, or null on cancel/dismiss.
 */

import { esc } from '../utils';
import type { SecuritySuggestionPair, SecuritySuggestions } from '../model/securitySuggestions';
import { ISIN_HINT, isValidISIN, normalizeISIN } from '../model/isin';
import { TxType } from '../types';
import type { Transaction, FxRateRecord } from '../types';
import {
  createDialogController,
  DIALOG_FOCUSABLES,
  focusFirstInvalid,
  makeDialogHelpers,
  openDialogShell,
  populateDatalist,
} from './modalShell';
import { attachSecurityAutocomplete } from './securityAutocomplete';
import { resolveRate } from '../fx';

let _activeExisting: Transaction | undefined = undefined;
let _activeSuggestionPairs: SecuritySuggestionPair[] = [];
const _dialog = createDialogController<Transaction | null>(null, {
  overlaySelector: '.tx-dialog-overlay',
  reset: () => {
    _activeExisting = undefined;
    _activeSuggestionPairs = [];
  },
});

const TX_TYPES = Object.values(TxType);
const SECURITY_TYPES: ReadonlySet<Transaction['type']> = new Set([
  TxType.BUY,
  TxType.SELL,
  TxType.DIVIDEND,
  TxType.SPLIT,
  TxType.FEE,
  TxType.TAX,
]);
const SHARES_TYPES: ReadonlySet<Transaction['type']> = new Set([
  TxType.BUY,
  TxType.SELL,
  TxType.SPLIT,
]);
const FEE_TYPES: ReadonlySet<Transaction['type']> = new Set([TxType.BUY, TxType.SELL]);
const TAX_TYPES: ReadonlySet<Transaction['type']> = new Set([
  TxType.BUY,
  TxType.SELL,
  TxType.DIVIDEND,
  TxType.INTEREST,
  TxType.TAX,
]);
const FX_TYPES: ReadonlySet<Transaction['type']> = new Set([
  TxType.BUY,
  TxType.SELL,
  TxType.DIVIDEND,
  TxType.INTEREST,
  TxType.FEE,
  TxType.TAX,
]);

export interface TransactionDialogOptions {
  existing?: Transaction;
  suggestions?: SecuritySuggestions;
  currencySuggestions?: string[];
}

export function transactionDialog(
  opts: TransactionDialogOptions = {},
): Promise<Transaction | null> {
  return new Promise<Transaction | null>((resolve) => {
    _dialog.begin(resolve);
    _activeExisting = opts.existing;
    _activeSuggestionPairs = opts.suggestions?.pairs ?? [];
    const existing = opts.existing;
    const today = new Date().toISOString().slice(0, 10);
    const title = existing ? 'Edit transaction' : 'Add transaction';

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay tx-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'tx-dialog-title');
    overlay.innerHTML = `
      <div class="dialog-card">
        <div class="dialog-header">
          <div class="dialog-title" id="tx-dialog-title">${esc(title)}</div>
        </div>
        <div class="dialog-fields">
          <div class="dialog-row">
            <div class="dialog-field">
              <label class="dialog-label" for="txd-date">Date</label>
              <input type="date" id="txd-date" class="form-input dialog-input"
                value="${esc(existing?.date || today)}" max="${today}">
              <span class="dialog-error dialog-error-compact" id="txd-date-err"></span>
            </div>
            <div class="dialog-field">
              <label class="dialog-label" for="txd-type">Type</label>
              <select id="txd-type" class="form-input dialog-input">
                ${TX_TYPES.map(
                  (t) =>
                    `<option value="${esc(t)}" ${t === (existing?.type || TxType.BUY) ? 'selected' : ''}>${esc(t)}</option>`,
                ).join('')}
              </select>
              <span class="dialog-error dialog-error-compact" id="txd-type-err"></span>
            </div>
          </div>
          <div class="dialog-row" id="txd-row-security-fields">
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" for="txd-name">Name</label>
              <input type="text" id="txd-name" class="form-input dialog-input"
                value="${esc(existing?.name || '')}" placeholder="e.g. iShares Core MSCI World"
                list="txd-name-list" autocomplete="off">
              <datalist id="txd-name-list"></datalist>
              <span class="dialog-error dialog-error-compact" id="txd-name-err"></span>
            </div>
            <div class="dialog-field">
              <label class="dialog-label" for="txd-isin">ISIN</label>
              <input type="text" id="txd-isin" class="form-input dialog-input dialog-input-uppercase"
                value="${esc(existing?.isin || '')}" placeholder="e.g. IE00B4L5Y983" list="txd-isin-list"
                autocomplete="off">
              <datalist id="txd-isin-list"></datalist>
              <span class="dialog-error dialog-error-compact" id="txd-isin-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field" id="txd-field-amount">
              <label class="dialog-label" for="txd-amount" id="txd-amount-label">Amount (EUR)</label>
              <input type="text" inputmode="decimal" id="txd-amount" class="form-input dialog-input"
                value="${esc(existing != null ? String(existing.amount) : '')}"
                placeholder="0.00">
              <span class="dialog-error dialog-error-compact" id="txd-amount-err"></span>
            </div>
            <div class="dialog-field" id="txd-field-shares">
              <label class="dialog-label" for="txd-shares">Shares</label>
              <input type="text" inputmode="decimal" id="txd-shares" class="form-input dialog-input"
                value="${esc(existing != null ? String(existing.shares) : '')}"
                placeholder="0">
              <span class="dialog-error dialog-error-compact" id="txd-shares-err"></span>
            </div>
            <div class="dialog-field" id="txd-field-fee">
              <label class="dialog-label" for="txd-fee" id="txd-fee-label">Fee (EUR)</label>
              <input type="text" inputmode="decimal" id="txd-fee" class="form-input dialog-input"
                value="${esc(existing != null ? String(existing.fee) : '')}"
                placeholder="0">
              <span class="dialog-error dialog-error-compact" id="txd-fee-err"></span>
            </div>
            <div class="dialog-field" id="txd-field-tax">
              <label class="dialog-label" for="txd-tax" id="txd-tax-label">Tax (EUR)</label>
              <input type="text" inputmode="decimal" id="txd-tax" class="form-input dialog-input"
                value="${esc(existing != null ? String(existing.tax) : '')}"
                placeholder="0">
              <span class="dialog-error dialog-error-compact" id="txd-tax-err"></span>
            </div>
          </div>
          <div class="dialog-row" id="txd-row-fx">
            <div class="dialog-field">
              <label class="dialog-label" for="txd-currency">Currency</label>
              <input type="text" id="txd-currency" class="form-input dialog-input dialog-input-uppercase"
                value="${esc(existing?.currency || 'EUR')}" placeholder="EUR"
                maxlength="3" list="txd-currency-list" autocomplete="off">
              <datalist id="txd-currency-list"></datalist>
              <span class="dialog-error dialog-error-compact" id="txd-currency-err"></span>
            </div>
            <div class="dialog-field">
              <label class="dialog-label" for="txd-fxrate" id="txd-fxrate-label">FX rate (1 EUR → EUR)</label>
              <input type="text" inputmode="decimal" id="txd-fxrate" class="form-input dialog-input"
                value="${esc(existing != null ? String(existing.fxRate) : '')}"
                placeholder="1">
              <span id="txd-fxrate-hint" class="note" style="display:none" aria-live="polite"></span>
              <span class="dialog-error dialog-error-compact" id="txd-fxrate-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" for="txd-note">Note (optional)</label>
              <input type="text" id="txd-note" class="form-input dialog-input"
                value="${esc(existing?.note || '')}" placeholder="Any comment…">
            </div>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-sm btn-ghost js-txd-cancel">Cancel</button>
          <button class="btn btn-sm btn-primary js-txd-submit">${existing ? 'Save changes' : 'Add transaction'}</button>
        </div>
      </div>`;

    openDialogShell(_dialog, {
      overlay,
      onDismiss: () => _dismiss(null),
      onCancel: () => _dismiss(null),
      onSubmit: _submit,
      cancelSelector: '.js-txd-cancel',
      submitSelector: '.js-txd-submit',
      focusablesSelector: DIALOG_FOCUSABLES,
      initialFocusSelector: '#txd-date',
    });
    attachSecurityAutocomplete({
      overlay,
      pairs: _activeSuggestionPairs,
      isinInputId: 'txd-isin',
      isinListId: 'txd-isin-list',
      nameInputId: 'txd-name',
      nameListId: 'txd-name-list',
    });
    populateDatalist(overlay.querySelector('#txd-currency-list'), opts.currencySuggestions ?? []);
    _applyTypeVisibility(existing?.type || TxType.BUY);
    _bindRealtimeIsinValidation(overlay);
    _bindCurrencyLabels(overlay);
    _bindFxHintLookup(overlay);

    const typeEl = overlay.querySelector('#txd-type') as HTMLSelectElement | null;
    typeEl?.addEventListener('change', () => {
      _applyTypeVisibility(typeEl.value as Transaction['type']);
      _validateTransactionIsin(overlay, 'input');
    });
  });
}

function _submit(): void {
  const overlay = _dialog.overlay();
  if (!overlay) return;

  const { get, setErr } = makeDialogHelpers(overlay);

  // Clear errors
  [
    'txd-date',
    'txd-type',
    'txd-name',
    'txd-isin',
    'txd-amount',
    'txd-shares',
    'txd-fee',
    'txd-tax',
    'txd-currency',
    'txd-fxrate',
  ].forEach((f) => setErr(f, ''));

  const dateVal = get('txd-date');
  const typeVal = get('txd-type').toUpperCase();
  const nameVal = get('txd-name');
  const isinVal = normalizeISIN(get('txd-isin'));
  const amountRaw = get('txd-amount');
  const sharesRaw = get('txd-shares');
  const feeRaw = get('txd-fee');
  const taxRaw = get('txd-tax');
  const currencyVal = get('txd-currency').toUpperCase() || 'EUR';
  const fxRateRaw = get('txd-fxrate');
  const noteVal = get('txd-note');

  let valid = true;
  const securityVisible = _isVisible('txd-row-security-fields');
  const amountVisible = _isVisible('txd-field-amount');
  const sharesVisible = _isVisible('txd-field-shares');
  const feeVisible = _isVisible('txd-field-fee');
  const taxVisible = _isVisible('txd-field-tax');
  const fxVisible = _isVisible('txd-row-fx');

  if (!dateVal || !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
    setErr('txd-date', 'Required – use YYYY-MM-DD format.');
    valid = false;
  }
  if (!(TX_TYPES as string[]).includes(typeVal)) {
    setErr('txd-type', 'Select a valid type.');
    valid = false;
  }
  if (securityVisible && !nameVal) {
    setErr('txd-name', 'Name is required.');
    valid = false;
  }
  if (securityVisible && isinVal && !isValidISIN(isinVal)) {
    setErr('txd-isin', ISIN_HINT);
    valid = false;
  }
  if (amountVisible && amountRaw !== '' && isNaN(_parseNum(amountRaw))) {
    setErr('txd-amount', 'Must be a number.');
    valid = false;
  }
  if (sharesVisible && sharesRaw !== '' && isNaN(_parseNum(sharesRaw))) {
    setErr('txd-shares', 'Must be a number.');
    valid = false;
  }
  if (feeVisible && feeRaw !== '' && isNaN(_parseNum(feeRaw))) {
    setErr('txd-fee', 'Must be a number.');
    valid = false;
  }
  if (taxVisible && taxRaw !== '' && isNaN(_parseNum(taxRaw))) {
    setErr('txd-tax', 'Must be a number.');
    valid = false;
  }
  if (fxVisible && !/^[A-Z]{3}$/.test(currencyVal)) {
    setErr('txd-currency', '3-letter code (e.g. EUR).');
    valid = false;
  }
  if (fxVisible && fxRateRaw !== '' && isNaN(_parseNum(fxRateRaw))) {
    setErr('txd-fxrate', 'Must be a number.');
    valid = false;
  }

  if (!valid) {
    focusFirstInvalid(overlay);
    return;
  }

  const existing = _activeExisting;
  const generatedId = `manual|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`;
  const parsedAmount = amountVisible ? _parseNum(amountRaw) : 0;
  const parsedTax = taxVisible ? _parseNum(taxRaw) : 0;
  const canonicalTax =
    typeVal === TxType.TAX ? (parsedTax !== 0 ? parsedTax : parsedAmount) : parsedTax;
  const canonicalAmount = typeVal === TxType.TAX ? canonicalTax : parsedAmount;
  const draft: Transaction = {
    rowId: existing?.rowId,
    id: existing?.id || generatedId,
    date: dateVal,
    source: existing?.source || 'manual',
    category: existing?.category || '',
    type: typeVal as Transaction['type'],
    name: securityVisible ? nameVal : '',
    isin: securityVisible ? isinVal : '',
    shares: sharesVisible ? _parseNum(sharesRaw) : 0,
    price: existing?.price || 0,
    amount: canonicalAmount,
    fee: feeVisible ? _parseNum(feeRaw) : 0,
    tax: canonicalTax,
    currency: fxVisible ? currencyVal : existing?.currency || 'EUR',
    fxRate: fxVisible ? _parseNum(fxRateRaw) || 1 : 1,
    note: noteVal,
  };

  _dismiss(draft);
}

function _dismiss(result: Transaction | null): void {
  _dialog.dismiss(result);
}

function _parseNum(s: string): number {
  if (!s || !s.trim()) return 0;
  // Accept both comma and dot as decimal separator
  const n = parseFloat(s.trim().replace(',', '.'));
  return isNaN(n) ? NaN : n;
}

function _isVisible(id: string): boolean {
  const overlay = _dialog.overlay();
  if (!overlay) return false;
  const el = overlay.querySelector('#' + id) as HTMLElement | null;
  return !!el && el.style.display !== 'none';
}

function _applyTypeVisibility(type: Transaction['type']): void {
  const overlay = _dialog.overlay();
  if (!overlay) return;
  const setDisplay = (id: string, show: boolean): void => {
    const el = overlay.querySelector('#' + id) as HTMLElement | null;
    if (el) el.style.display = show ? '' : 'none';
  };

  const showSecurity = SECURITY_TYPES.has(type);
  setDisplay('txd-row-security-fields', showSecurity);
  setDisplay('txd-field-amount', type !== TxType.SPLIT);
  setDisplay('txd-field-shares', SHARES_TYPES.has(type));
  setDisplay('txd-field-fee', FEE_TYPES.has(type));
  setDisplay('txd-field-tax', TAX_TYPES.has(type));
  setDisplay('txd-row-fx', FX_TYPES.has(type));
}

function _bindRealtimeIsinValidation(overlay: HTMLElement): void {
  const isinInput = overlay.querySelector('#txd-isin') as HTMLInputElement | null;
  if (!isinInput) return;
  isinInput.addEventListener('input', () => _validateTransactionIsin(overlay, 'input'));
  isinInput.addEventListener('blur', () => _validateTransactionIsin(overlay, 'blur'));
}

function _validateTransactionIsin(overlay: HTMLElement, mode: 'input' | 'blur'): void {
  const { setErr } = makeDialogHelpers(overlay);
  if (!_isVisible('txd-row-security-fields')) {
    setErr('txd-isin', '');
    return;
  }
  const isinInput = overlay.querySelector('#txd-isin') as HTMLInputElement | null;
  const isin = normalizeISIN(isinInput?.value || '');
  if (!isin) {
    setErr(
      'txd-isin',
      mode === 'blur' ? 'Optional. If provided, use 12-character ISIN format.' : '',
    );
    return;
  }
  if (!isValidISIN(isin)) {
    setErr('txd-isin', ISIN_HINT);
    return;
  }
  setErr('txd-isin', '');
}

function _bindCurrencyLabels(overlay: HTMLElement): void {
  const currencyInput = overlay.querySelector('#txd-currency') as HTMLInputElement | null;
  const amountLabel = overlay.querySelector('#txd-amount-label') as HTMLElement | null;
  const feeLabel = overlay.querySelector('#txd-fee-label') as HTMLElement | null;
  const taxLabel = overlay.querySelector('#txd-tax-label') as HTMLElement | null;
  const fxRateLabel = overlay.querySelector('#txd-fxrate-label') as HTMLElement | null;
  if (!currencyInput || !amountLabel || !feeLabel || !taxLabel || !fxRateLabel) return;

  const update = (): void => {
    const raw = currencyInput.value.toUpperCase().trim();
    const currency = /^[A-Z]{3}$/.test(raw) ? raw : 'EUR';
    amountLabel.textContent = `Amount (${currency})`;
    feeLabel.textContent = `Fee (${currency})`;
    taxLabel.textContent = `Tax (${currency})`;
    fxRateLabel.textContent = `FX rate (1 ${currency} → EUR)`;
  };

  currencyInput.addEventListener('input', update);
  currencyInput.addEventListener('change', update);
  update();
}

function _bindFxHintLookup(overlay: HTMLElement): void {
  const currencyInput = overlay.querySelector('#txd-currency') as HTMLInputElement | null;
  const dateInput = overlay.querySelector('#txd-date') as HTMLInputElement | null;
  if (!currencyInput || !dateInput) return;

  const trigger = (): void => {
    if (!_isVisible('txd-row-fx')) return;
    const currency = currencyInput.value.toUpperCase().trim();
    const date = dateInput.value.trim();
    if (!/^[A-Z]{3}$/.test(currency) || currency === 'EUR') {
      _hideFxHint(overlay);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      _hideFxHint(overlay);
      return;
    }
    void resolveRate(currency, date).then((record) => {
      // Guard: ensure dialog is still open and inputs haven't changed
      if (!_dialog.overlay()) return;
      if (currencyInput.value.toUpperCase().trim() !== currency || dateInput.value.trim() !== date)
        return;
      _updateFxHint(overlay, record);
    });
  };

  currencyInput.addEventListener('input', trigger);
  dateInput.addEventListener('input', trigger);
  dateInput.addEventListener('change', trigger);
  // Trigger on open so editing an existing tx with non-EUR currency shows a hint immediately
  trigger();
}

function _hideFxHint(overlay: HTMLElement): void {
  const hintEl = overlay.querySelector('#txd-fxrate-hint') as HTMLElement | null;
  if (hintEl) hintEl.style.display = 'none';
}

function _updateFxHint(overlay: HTMLElement, record: FxRateRecord | null): void {
  const hintEl = overlay.querySelector('#txd-fxrate-hint') as HTMLElement | null;
  if (!hintEl) return;
  if (!record) {
    hintEl.style.display = 'none';
    return;
  }
  const rateInput = overlay.querySelector('#txd-fxrate') as HTMLInputElement | null;
  // Auto-populate only when the field is empty
  if (rateInput && !rateInput.value.trim()) {
    rateInput.value = String(record.rate);
  }
  hintEl.textContent = `ECB rate for ${record.effectiveDate}: 1 ${record.base} = ${record.rate.toFixed(4)} ${record.target}`;
  hintEl.style.display = '';
}
