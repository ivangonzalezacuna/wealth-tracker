/**
 * Promise-based add/edit transaction modal. All fields visible at once with inline validation.
 * Resolves with the Transaction draft on submit, or null on cancel/dismiss.
 */

import { esc } from '../utils';
import {
  normalizeSuggestionName,
  type KnownSecuritySuggestions,
} from '../model/securitySuggestions';
import { TxType } from '../types';
import type { Transaction } from '../types';
import { activateModalShell, restoreFocus } from './modalShell';

let _activeResolve: ((v: Transaction | null) => void) | null = null;
let _activeTrigger: HTMLElement | null = null;
let _activeOverlay: HTMLElement | null = null;
let _activeExisting: Transaction | undefined = undefined;
let _activeCleanup: (() => void) | null = null;
let _activeSuggestions: KnownSecuritySuggestions | undefined;

const TX_TYPES = Object.values(TxType);

export interface TransactionDialogOptions {
  existing?: Transaction;
  suggestions?: KnownSecuritySuggestions;
}

export function transactionDialog(
  opts: TransactionDialogOptions = {},
): Promise<Transaction | null> {
  return new Promise<Transaction | null>((resolve) => {
    _dismiss(null);
    _activeResolve = resolve;
    _activeTrigger = document.activeElement as HTMLElement | null;
    _activeExisting = opts.existing;
    _activeSuggestions = opts.suggestions;
    const existing = opts.existing;
    const today = new Date().toISOString().slice(0, 10);
    const title = existing ? 'Edit transaction' : 'Add transaction';

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay tx-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'tx-dialog-title');
    overlay.innerHTML = `
      <div class="dialog-card tx-dialog-card">
        <div class="dialog-header">
          <div class="dialog-title" id="tx-dialog-title">${esc(title)}</div>
        </div>
        <div class="dialog-fields">
          <div class="dialog-row">
            <div class="dialog-field">
              <label class="dialog-label" for="txd-date">Date</label>
              <input type="date" id="txd-date" class="form-input dialog-input"
                value="${esc(existing?.date || today)}" max="${today}">
              <span class="dialog-error" id="txd-date-err"></span>
            </div>
            <div class="dialog-field">
              <label class="dialog-label" for="txd-type">Type</label>
              <select id="txd-type" class="form-input dialog-input">
                ${TX_TYPES.map(
                  (t) =>
                    `<option value="${esc(t)}" ${t === (existing?.type || TxType.BUY) ? 'selected' : ''}>${esc(t)}</option>`,
                ).join('')}
              </select>
              <span class="dialog-error" id="txd-type-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" for="txd-name">Name</label>
              <input type="text" id="txd-name" class="form-input dialog-input"
                value="${esc(existing?.name || '')}" placeholder="e.g. iShares Core MSCI World" list="txd-name-list">
              <span class="dialog-error" id="txd-name-err"></span>
            </div>
            <div class="dialog-field">
              <label class="dialog-label" for="txd-isin">ISIN</label>
              <input type="text" id="txd-isin" class="form-input dialog-input dialog-input-uppercase"
                value="${esc(existing?.isin || '')}" placeholder="e.g. IE00B4L5Y983"
                list="txd-isin-list">
              <span class="dialog-error" id="txd-isin-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field">
              <label class="dialog-label" for="txd-amount">Amount (€)</label>
              <input type="text" inputmode="decimal" id="txd-amount" class="form-input dialog-input"
                value="${esc(existing != null ? String(existing.amount) : '')}"
                placeholder="0.00">
              <span class="dialog-error" id="txd-amount-err"></span>
            </div>
            <div class="dialog-field">
              <label class="dialog-label" for="txd-shares">Shares</label>
              <input type="text" inputmode="decimal" id="txd-shares" class="form-input dialog-input"
                value="${esc(existing != null ? String(existing.shares) : '')}"
                placeholder="0">
              <span class="dialog-error" id="txd-shares-err"></span>
            </div>
            <div class="dialog-field">
              <label class="dialog-label" for="txd-fee">Fee (€)</label>
              <input type="text" inputmode="decimal" id="txd-fee" class="form-input dialog-input"
                value="${esc(existing != null ? String(existing.fee) : '')}"
                placeholder="0">
              <span class="dialog-error" id="txd-fee-err"></span>
            </div>
            <div class="dialog-field">
              <label class="dialog-label" for="txd-tax">Tax (€)</label>
              <input type="text" inputmode="decimal" id="txd-tax" class="form-input dialog-input"
                value="${esc(existing != null ? String(existing.tax) : '')}"
                placeholder="0">
              <span class="dialog-error" id="txd-tax-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field">
              <label class="dialog-label" for="txd-currency">Currency</label>
              <input type="text" id="txd-currency" class="form-input dialog-input dialog-input-uppercase"
                value="${esc(existing?.currency || 'EUR')}" placeholder="EUR"
                maxlength="3">
              <span class="dialog-error" id="txd-currency-err"></span>
            </div>
            <div class="dialog-field">
              <label class="dialog-label" for="txd-fxrate">FX rate (EUR=1)</label>
              <input type="text" inputmode="decimal" id="txd-fxrate" class="form-input dialog-input"
                value="${esc(existing != null ? String(existing.fxRate) : '')}"
                placeholder="1">
              <span class="dialog-error" id="txd-fxrate-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" for="txd-note">Note (optional)</label>
              <input type="text" id="txd-note" class="form-input dialog-input"
                value="${esc(existing?.note || '')}" placeholder="Any comment…">
            </div>
          </div>
          ${_renderSuggestionLists(opts.suggestions)}
        </div>
        <div class="dialog-actions">
          <button class="btn btn-sm btn-ghost js-txd-cancel">Cancel</button>
          <button class="btn btn-sm btn-primary js-txd-submit">${existing ? 'Save changes' : 'Add transaction'}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    _activeOverlay = overlay;
    _bindSuggestionAutoFill(overlay, opts.suggestions);

    overlay.querySelector('.js-txd-submit')?.addEventListener('click', () => _submit());
    overlay.querySelector('.js-txd-cancel')?.addEventListener('click', () => _dismiss(null));
    _activeCleanup = activateModalShell({
      overlay,
      onDismiss: () => _dismiss(null),
      onSubmitEnter: _submit,
      submitWhenActive: (active) => !!active?.classList.contains('js-txd-submit'),
      focusablesSelector: 'input:not([disabled]), select:not([disabled]), button:not([disabled])',
    });

    // Focus the first input field
    (overlay.querySelector('#txd-date') as HTMLElement | null)?.focus();
  });
}

function _submit(): void {
  if (!_activeOverlay) return;

  const get = (id: string): string =>
    (_activeOverlay!.querySelector('#' + id) as HTMLInputElement | null)?.value.trim() || '';
  const setErr = (id: string, msg: string): void => {
    const el = _activeOverlay!.querySelector('#' + id + '-err') as HTMLElement | null;
    if (el) {
      el.textContent = msg;
      if (msg) {
        (_activeOverlay!.querySelector('#' + id) as HTMLElement | null)?.setAttribute(
          'aria-invalid',
          'true',
        );
      } else {
        (_activeOverlay!.querySelector('#' + id) as HTMLElement | null)?.removeAttribute(
          'aria-invalid',
        );
      }
    }
  };

  // Clear errors
  ['date', 'type', 'name', 'isin', 'amount', 'shares', 'fee', 'tax', 'currency', 'fxrate'].forEach(
    (f) => setErr(f, ''),
  );

  const dateVal = get('txd-date');
  const typeVal = get('txd-type').toUpperCase();
  const nameVal = get('txd-name');
  const isinVal = get('txd-isin').toUpperCase();
  const amountRaw = get('txd-amount');
  const sharesRaw = get('txd-shares');
  const feeRaw = get('txd-fee');
  const taxRaw = get('txd-tax');
  const currencyVal = get('txd-currency').toUpperCase() || 'EUR';
  const fxRateRaw = get('txd-fxrate');
  const noteVal = get('txd-note');

  let valid = true;

  if (!dateVal || !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
    setErr('txd-date', 'Required – use YYYY-MM-DD format.');
    valid = false;
  }
  if (!(TX_TYPES as string[]).includes(typeVal)) {
    setErr('txd-type', 'Select a valid type.');
    valid = false;
  }
  if (!nameVal) {
    setErr('txd-name', 'Name is required.');
    valid = false;
  }
  if (!isinPairLooksCoherent(isinVal, nameVal, _activeSuggestions)) {
    setErr('txd-isin', 'Known ISIN/name pair mismatch. Pick a matching pair or clear one field.');
    setErr('txd-name', 'Known ISIN/name pair mismatch. Pick a matching pair or clear one field.');
    valid = false;
  }
  if (amountRaw !== '' && isNaN(_parseNum(amountRaw))) {
    setErr('txd-amount', 'Must be a number.');
    valid = false;
  }
  if (sharesRaw !== '' && isNaN(_parseNum(sharesRaw))) {
    setErr('txd-shares', 'Must be a number.');
    valid = false;
  }
  if (feeRaw !== '' && isNaN(_parseNum(feeRaw))) {
    setErr('txd-fee', 'Must be a number.');
    valid = false;
  }
  if (taxRaw !== '' && isNaN(_parseNum(taxRaw))) {
    setErr('txd-tax', 'Must be a number.');
    valid = false;
  }
  if (!/^[A-Z]{3}$/.test(currencyVal)) {
    setErr('txd-currency', '3-letter code (e.g. EUR).');
    valid = false;
  }
  if (fxRateRaw !== '' && isNaN(_parseNum(fxRateRaw))) {
    setErr('txd-fxrate', 'Must be a number.');
    valid = false;
  }

  if (!valid) {
    // Focus the first invalid field
    const firstErr = _activeOverlay!.querySelector('[aria-invalid="true"]') as HTMLElement | null;
    firstErr?.focus();
    return;
  }

  const existing = _activeExisting;
  const generatedId = `manual|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`;
  const draft: Transaction = {
    rowId: existing?.rowId,
    id: existing?.id || generatedId,
    date: dateVal,
    source: existing?.source || 'manual',
    category: existing?.category || '',
    type: typeVal as Transaction['type'],
    name: nameVal,
    isin: isinVal,
    shares: _parseNum(sharesRaw),
    price: existing?.price || 0,
    amount: _parseNum(amountRaw),
    fee: _parseNum(feeRaw),
    tax: _parseNum(taxRaw),
    currency: currencyVal,
    fxRate: _parseNum(fxRateRaw) || 1,
    note: noteVal,
  };

  _dismiss(draft);
}

function _dismiss(result: Transaction | null): void {
  const overlay = document.querySelector('.tx-dialog-overlay');
  overlay?.remove();
  _activeCleanup?.();
  _activeCleanup = null;
  _activeOverlay = null;
  _activeExisting = undefined;
  _activeSuggestions = undefined;
  restoreFocus(_activeTrigger);
  _activeTrigger = null;
  const resolve = _activeResolve;
  _activeResolve = null;
  if (resolve) resolve(result);
}

function _parseNum(s: string): number {
  if (!s || !s.trim()) return 0;
  // Accept both comma and dot as decimal separator
  const n = parseFloat(s.trim().replace(',', '.'));
  return isNaN(n) ? NaN : n;
}

function _renderSuggestionLists(suggestions: KnownSecuritySuggestions | undefined): string {
  if (!suggestions || suggestions.pairs.length === 0) {
    return '<datalist id="txd-name-list"></datalist><datalist id="txd-isin-list"></datalist>';
  }
  const byName = [...suggestions.pairs]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((pair) => `<option value="${esc(pair.name)}">${esc(pair.isin)}</option>`)
    .join('');
  const byIsin = [...suggestions.pairs]
    .sort((a, b) => a.isin.localeCompare(b.isin))
    .map((pair) => `<option value="${esc(pair.isin)}">${esc(pair.name)}</option>`)
    .join('');
  return `<datalist id="txd-name-list">${byName}</datalist><datalist id="txd-isin-list">${byIsin}</datalist>`;
}

function _bindSuggestionAutoFill(
  overlay: HTMLElement,
  suggestions: KnownSecuritySuggestions | undefined,
): void {
  if (!suggestions || suggestions.pairs.length === 0) return;
  const nameEl = overlay.querySelector('#txd-name') as HTMLInputElement | null;
  const isinEl = overlay.querySelector('#txd-isin') as HTMLInputElement | null;
  if (!nameEl || !isinEl) return;

  const applyByIsin = (): void => {
    const match = suggestions.byIsin[isinEl.value.trim().toUpperCase()];
    if (match) nameEl.value = match.name;
  };
  const applyByName = (): void => {
    const match = suggestions.byName[normalizeSuggestionName(nameEl.value)];
    if (match) isinEl.value = match.isin;
  };

  isinEl.addEventListener('change', applyByIsin);
  isinEl.addEventListener('blur', applyByIsin);
  nameEl.addEventListener('change', applyByName);
  nameEl.addEventListener('blur', applyByName);
}

function isinPairLooksCoherent(
  isin: string,
  name: string,
  suggestions: KnownSecuritySuggestions | undefined,
): boolean {
  if (!suggestions || !isin || !name) return true;
  const isinKey = isin.trim().toUpperCase();
  const nameKey = normalizeSuggestionName(name);
  const byIsin = suggestions.byIsin[isinKey];
  const byName = suggestions.byName[nameKey];
  if (!byIsin && !byName) return true;
  if (byIsin && normalizeSuggestionName(byIsin.name) !== nameKey) return false;
  if (byName && byName.isin !== isinKey) return false;
  return true;
}
