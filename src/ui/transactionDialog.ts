/**
 * Promise-based add/edit transaction modal. All fields visible at once with inline validation.
 * Resolves with the Transaction draft on submit, or null on cancel/dismiss.
 */

import { TxType } from '../types';
import type { Transaction } from '../types';

let _activeResolve: ((v: Transaction | null) => void) | null = null;
let _activeTrigger: HTMLElement | null = null;
let _activeOverlay: HTMLElement | null = null;
let _activeExisting: Transaction | undefined = undefined;

const TX_TYPES = Object.values(TxType);

export interface TransactionDialogOptions {
  existing?: Transaction;
}

export function transactionDialog(
  opts: TransactionDialogOptions = {},
): Promise<Transaction | null> {
  return new Promise<Transaction | null>((resolve) => {
    _dismiss(null);
    _activeResolve = resolve;
    _activeTrigger = document.activeElement as HTMLElement | null;
    _activeExisting = opts.existing;
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
          <div class="dialog-title" id="tx-dialog-title">${_esc(title)}</div>
        </div>
        <div class="dialog-fields tx-dialog-fields">
          <div class="dialog-row">
            <div class="dialog-field tx-dialog-field">
              <label class="dialog-label" for="txd-date">Date</label>
              <input type="date" id="txd-date" class="form-input dialog-input"
                value="${_esc(existing?.date || today)}" max="${today}">
              <span class="dialog-error" id="txd-date-err"></span>
            </div>
            <div class="dialog-field tx-dialog-field">
              <label class="dialog-label" for="txd-type">Type</label>
              <select id="txd-type" class="form-input dialog-input">
                ${TX_TYPES.map(
                  (t) =>
                    `<option value="${_esc(t)}" ${t === (existing?.type || TxType.BUY) ? 'selected' : ''}>${_esc(t)}</option>`,
                ).join('')}
              </select>
              <span class="dialog-error" id="txd-type-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field tx-dialog-field tx-dialog-field-wide">
              <label class="dialog-label" for="txd-name">Name</label>
              <input type="text" id="txd-name" class="form-input dialog-input"
                value="${_esc(existing?.name || '')}" placeholder="e.g. iShares Core MSCI World">
              <span class="dialog-error" id="txd-name-err"></span>
            </div>
            <div class="dialog-field tx-dialog-field">
              <label class="dialog-label" for="txd-isin">ISIN</label>
              <input type="text" id="txd-isin" class="form-input dialog-input"
                value="${_esc(existing?.isin || '')}" placeholder="e.g. IE00B4L5Y983"
                style="text-transform:uppercase">
              <span class="dialog-error" id="txd-isin-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field tx-dialog-field">
              <label class="dialog-label" for="txd-amount">Amount (€)</label>
              <input type="text" inputmode="decimal" id="txd-amount" class="form-input dialog-input"
                value="${_esc(existing != null ? String(existing.amount) : '')}"
                placeholder="0.00">
              <span class="dialog-error" id="txd-amount-err"></span>
            </div>
            <div class="dialog-field tx-dialog-field">
              <label class="dialog-label" for="txd-shares">Shares</label>
              <input type="text" inputmode="decimal" id="txd-shares" class="form-input dialog-input"
                value="${_esc(existing != null ? String(existing.shares) : '')}"
                placeholder="0">
              <span class="dialog-error" id="txd-shares-err"></span>
            </div>
            <div class="dialog-field tx-dialog-field">
              <label class="dialog-label" for="txd-fee">Fee (€)</label>
              <input type="text" inputmode="decimal" id="txd-fee" class="form-input dialog-input"
                value="${_esc(existing != null ? String(existing.fee) : '')}"
                placeholder="0">
              <span class="dialog-error" id="txd-fee-err"></span>
            </div>
            <div class="dialog-field tx-dialog-field">
              <label class="dialog-label" for="txd-tax">Tax (€)</label>
              <input type="text" inputmode="decimal" id="txd-tax" class="form-input dialog-input"
                value="${_esc(existing != null ? String(existing.tax) : '')}"
                placeholder="0">
              <span class="dialog-error" id="txd-tax-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field tx-dialog-field">
              <label class="dialog-label" for="txd-currency">Currency</label>
              <input type="text" id="txd-currency" class="form-input dialog-input"
                value="${_esc(existing?.currency || 'EUR')}" placeholder="EUR"
                style="text-transform:uppercase" maxlength="3">
              <span class="dialog-error" id="txd-currency-err"></span>
            </div>
            <div class="dialog-field tx-dialog-field">
              <label class="dialog-label" for="txd-fxrate">FX rate (EUR=1)</label>
              <input type="text" inputmode="decimal" id="txd-fxrate" class="form-input dialog-input"
                value="${_esc(existing != null ? String(existing.fxRate) : '')}"
                placeholder="1">
              <span class="dialog-error" id="txd-fxrate-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field tx-dialog-field tx-dialog-field-wide">
              <label class="dialog-label" for="txd-note">Note (optional)</label>
              <input type="text" id="txd-note" class="form-input dialog-input"
                value="${_esc(existing?.note || '')}" placeholder="Any comment…">
            </div>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-sm btn-ghost js-txd-cancel">Cancel</button>
          <button class="btn btn-sm btn-primary js-txd-submit">${existing ? 'Save changes' : 'Add transaction'}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    _activeOverlay = overlay;

    overlay.querySelector('.js-txd-submit')?.addEventListener('click', () => _submit());
    overlay.querySelector('.js-txd-cancel')?.addEventListener('click', () => _dismiss(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) _dismiss(null);
    });
    document.addEventListener('keydown', _onKeydown);

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

function _onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    _dismiss(null);
    return;
  }
  if (e.key === 'Enter') {
    // Submit on Enter only when focus is on the submit button
    const active = document.activeElement as HTMLElement | null;
    if (active?.classList.contains('js-txd-submit')) {
      e.preventDefault();
      _submit();
    }
    return;
  }
  if (e.key !== 'Tab' || !_activeOverlay) return;
  const focusables = Array.from(
    _activeOverlay.querySelectorAll(
      'input:not([disabled]), select:not([disabled]), button:not([disabled])',
    ),
  ) as HTMLElement[];
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey) {
    if (active === first || !active || !_activeOverlay.contains(active)) {
      e.preventDefault();
      last.focus();
    }
    return;
  }
  if (active === last || !active || !_activeOverlay.contains(active)) {
    e.preventDefault();
    first.focus();
  }
}

function _dismiss(result: Transaction | null): void {
  const overlay = document.querySelector('.tx-dialog-overlay');
  overlay?.remove();
  document.body.style.overflow = '';
  document.removeEventListener('keydown', _onKeydown);
  _activeOverlay = null;
  _activeExisting = undefined;
  if (_activeTrigger && document.body.contains(_activeTrigger)) _activeTrigger.focus();
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

function _esc(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
