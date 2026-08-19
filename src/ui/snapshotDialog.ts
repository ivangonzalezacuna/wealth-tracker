import { parseNum } from '../csv';
import { currentMonth, fmtEur2, safeColor, esc } from '../utils';
import type { Account, Holding, PortfolioData, Snapshot } from '../types';
import {
  createDialogController,
  DIALOG_INPUT_FOCUSABLES,
  focusFirstInvalid,
  makeDialogHelpers,
  openDialogShell,
} from './modalShell';

let _activeOpts: SnapshotDialogOptions | null = null;
const _dialog = createDialogController<Snapshot | null>(null, {
  overlaySelector: '.snap-dialog-overlay',
  reset: () => {
    _activeOpts = null;
  },
});

export interface SnapshotDialogOptions {
  existing?: Snapshot;
  accounts: Account[];
  holdings: PortfolioData['etfs'];
  configHoldings?: Holding[];
  prefill?: Snapshot;
  mode?: 'add' | 'edit';
  onFxPrefetchMonth?: (yearMonth: string) => Promise<SnapshotDialogFxPrefetchResult>;
}

export interface SnapshotDialogFxPrefetchResult {
  needed: boolean;
  disabled: boolean;
  attempted: number;
  resolved: number;
  failed: number;
  /** Resolved rates keyed by base currency (base → rate to the reporting currency). */
  rates: Record<string, number>;
}

export function snapshotDialog(opts: SnapshotDialogOptions): Promise<Snapshot | null> {
  return new Promise<Snapshot | null>((resolve) => {
    _dialog.begin(resolve);
    _activeOpts = opts;
    const draft = opts.existing || opts.prefill;
    const mode = opts.mode || (opts.existing ? 'edit' : 'add');
    const today = currentMonth();
    const title = mode === 'edit' ? 'Edit snapshot' : 'Add monthly snapshot';

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay snap-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'snap-dialog-title');
    overlay.innerHTML = `
      <div class="dialog-card snap-dialog-card">
        <div class="dialog-header">
          <div class="dialog-title" id="snap-dialog-title">${_esc(title)}</div>
        </div>
        <div class="dialog-fields dialog-fields-relaxed">
          <div class="dialog-row dialog-row-relaxed">
            <div class="dialog-field">
              <label class="dialog-label" for="snapd-date">Month</label>
              <input type="month" id="snapd-date" class="form-input dialog-input"
                value="${_esc(draft?.date || today)}" max="${today}">
              <span class="dialog-error" id="snapd-date-err"></span>
              ${
                opts.onFxPrefetchMonth
                  ? '<div class="note" id="snapd-fx-status" aria-live="polite" style="margin-top:.35rem"></div>'
                  : ''
              }
            </div>
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" for="snapd-notes">Notes (optional)</label>
              <input type="text" id="snapd-notes" class="form-input dialog-input"
                value="${_esc(draft?.notes || '')}" placeholder="e.g. catch-up done, got raise...">
            </div>
          </div>
          ${_renderAccountFields(opts.accounts, opts.holdings, opts.configHoldings || [], draft)}
        </div>
        <div class="dialog-actions">
          <button class="btn btn-sm btn-ghost js-snapd-cancel">Cancel</button>
          <button class="btn btn-sm btn-primary js-snapd-submit">${mode === 'edit' ? 'Save changes' : 'Add snapshot'}</button>
        </div>
      </div>`;

    openDialogShell(_dialog, {
      overlay,
      onDismiss: () => _dismiss(null),
      onCancel: () => _dismiss(null),
      onSubmit: _submit,
      cancelSelector: '.js-snapd-cancel',
      submitSelector: '.js-snapd-submit',
      focusablesSelector: DIALOG_INPUT_FOCUSABLES,
      initialFocusSelector: '#snapd-date',
    });
    overlay.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.snap-etf-toggle') as HTMLElement | null;
      if (!btn) return;
      const acctKey = btn.dataset.acctKey;
      if (!acctKey) return;
      _setSectionOpen(acctKey, btn.getAttribute('aria-expanded') !== 'true');
    });
    overlay.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const acctKey = target.dataset.acctKey || target.dataset.accountKey || '';
      if (acctKey) _updateRecon(acctKey);
      const acctKeyForHint = target.dataset.accountKey || '';
      if (acctKeyForHint) _updateFxHint(overlay, acctKeyForHint, target.value, fxRates);
    });
    const fxStatusEl = overlay.querySelector('#snapd-fx-status') as HTMLElement | null;
    const prefetchCache = new Map<string, SnapshotDialogFxPrefetchResult>();
    let prefetchRequestSeq = 0;
    let fxRates: Record<string, number> = {};
    const triggerFxPrefetch = (yearMonth: string): void => {
      if (!opts.onFxPrefetchMonth || !fxStatusEl || !yearMonth) return;
      const cached = prefetchCache.get(yearMonth);
      if (cached) {
        fxRates = cached.rates;
        renderFxPrefetchStatus(fxStatusEl, cached);
        _updateAllFxHints(overlay, fxRates);
        return;
      }
      fxStatusEl.textContent = 'FX: fetching month-end rates…';
      const requestSeq = ++prefetchRequestSeq;
      void opts
        .onFxPrefetchMonth(yearMonth)
        .then((result) => {
          prefetchCache.set(yearMonth, result);
          if (requestSeq !== prefetchRequestSeq) return;
          fxRates = result.rates;
          renderFxPrefetchStatus(fxStatusEl, result);
          _updateAllFxHints(overlay, fxRates);
        })
        .catch(() => {
          if (requestSeq !== prefetchRequestSeq) return;
          fxStatusEl.classList.add('snapd-fx-status--warn');
          fxStatusEl.innerHTML =
            '<strong>⚠ FX rate fetch failed.</strong> Please convert non-EUR values to EUR manually before saving to ensure accuracy.';
        });
    };
    const monthInput = overlay.querySelector('#snapd-date') as HTMLInputElement | null;
    monthInput?.addEventListener('change', () => triggerFxPrefetch(monthInput.value.trim()));
    if (monthInput) triggerFxPrefetch(monthInput.value.trim());

    for (const acct of _getDialogAccounts(opts.accounts)) {
      _updateRecon(acct.key);
    }
  });
}

function _renderAccountFields(
  accounts: Account[],
  holdings: PortfolioData['etfs'],
  configHoldings: Holding[],
  draft?: Snapshot,
): string {
  const dialogAccounts = _getDialogAccounts(accounts);
  if (dialogAccounts.length === 0) {
    return '<div class="note" style="font-size:12px">No accounts configured yet. You can still save the month and note.</div>';
  }
  return dialogAccounts
    .map((acct) => {
      const value = draft?.[acct.key];
      return `
        <div class="snap-dialog-account">
          <div class="dialog-field">
            <label class="dialog-label" for="snapd-acc-${_esc(acct.key)}">${_esc(acct.label)} (${_esc(acct.currency)})</label>
            <input type="text" inputmode="decimal" id="snapd-acc-${_esc(acct.key)}"
              data-account-key="${_esc(acct.key)}"
              data-currency="${_esc(acct.currency)}"
              class="form-input dialog-input"
              value="${typeof value === 'number' || typeof value === 'string' ? _esc(String(value)) : ''}"
              placeholder="total value">
            ${acct.currency !== 'EUR' ? `<span id="snapd-acc-${_esc(acct.key)}-fx" class="note snapd-fx-hint" style="display:none" aria-live="polite"></span>` : ''}
            <span class="dialog-error dialog-error-compact" id="snapd-acc-${_esc(acct.key)}-err"></span>
          </div>
          ${acct.showEtfBreakdown ? _renderEtfBreakdown(acct.key, holdings, configHoldings, draft) : ''}
        </div>`;
    })
    .join('');
}

function _renderEtfBreakdown(
  acctKey: string,
  holdings: PortfolioData['etfs'],
  configHoldings: Holding[],
  draft?: Snapshot,
): string {
  const held = Object.values(holdings || {}).filter((pos) => !pos.exited && pos.shares >= 1e-6);
  if (held.length === 0) return '';

  const activeIsins = new Set(
    configHoldings.filter((h) => h.active && (h.targetPct ?? 0) > 0).map((h) => h.isin),
  );
  const contributing = held.filter((pos) => activeIsins.has(pos.isin));
  const legacy = held.filter((pos) => !activeIsins.has(pos.isin));

  const getName = (isin: string, fallbackName: string, shortName: string): string => {
    const cfg = configHoldings.find((h) => h.isin === isin);
    return cfg?.name || fallbackName || shortName;
  };
  const hasPrefilled = held.some((pos) => typeof draft?.[`etf_${pos.isin}`] === 'number');

  const renderRow = (pos: {
    isin: string;
    name: string;
    shortName: string;
    color: string;
  }): string => {
    const value = draft?.[`etf_${pos.isin}`];
    return `
      <div class="snap-etf-row">
        <div class="snap-etf-meta">
          <span class="hold-dot" style="background:${safeColor(pos.color)}"></span>
          <div class="snap-etf-name-col">
            <span class="snap-etf-name">${_esc(getName(pos.isin, pos.name, pos.shortName))}</span>
            <span class="snap-etf-isin">${_esc(pos.isin)}</span>
          </div>
        </div>
        <input type="text" inputmode="decimal"
               id="snapd-etf-${_esc(acctKey)}-${_esc(pos.isin)}"
               data-etf-isin="${_esc(pos.isin)}"
               data-acct-key="${_esc(acctKey)}"
               class="form-input form-input-sm snap-etf-input"
               value="${typeof value === 'number' || typeof value === 'string' ? _esc(String(value)) : ''}"
               placeholder="Value">
      </div>`;
  };

  const contribHtml =
    contributing.length > 0
      ? `<div class="snap-etf-group"><div class="snap-etf-group-label">Contributing</div>${contributing.map(renderRow).join('')}</div>`
      : '';
  const legacyHtml =
    legacy.length > 0
      ? `<div class="snap-etf-group"><div class="snap-etf-group-label">Held, not contributing</div>${legacy.map(renderRow).join('')}</div>`
      : '';

  return `
    <div class="snap-etf-wrap">
      <button type="button" class="snap-etf-toggle btn btn-sm btn-ghost"
              data-acct-key="${_esc(acctKey)}" aria-expanded="${hasPrefilled ? 'true' : 'false'}">
        <span class="snap-etf-chevron">${hasPrefilled ? '\u25be' : '\u25b8'}</span> ETF breakdown
      </button>
      <div class="snap-etf-section" id="snapd-etf-section-${_esc(acctKey)}" style="display:${hasPrefilled ? '' : 'none'}">
        ${contribHtml}
        ${legacyHtml}
        <div class="snap-etf-recon" id="snapd-etf-recon-${_esc(acctKey)}" style="display:none">
          <span class="snap-etf-recon-alloc">Allocated: <b>-</b></span>
          <span class="snap-etf-recon-sep">&middot;</span>
          <span class="snap-etf-recon-remain">Remaining: <b>-</b></span>
        </div>
        <span class="dialog-error dialog-error-compact" id="snapd-etf-${_esc(acctKey)}-err"></span>
      </div>
    </div>`;
}

function _submit(): void {
  const overlay = _dialog.overlay();
  if (!overlay || !_activeOpts) return;

  const { setErr } = makeDialogHelpers(overlay);
  const setSectionErr = (acctKey: string, msg: string): void => {
    const el = overlay.querySelector(`#snapd-etf-${acctKey}-err`) as HTMLElement | null;
    if (el) el.textContent = msg;
  };

  setErr('snapd-date', '');
  for (const acct of _getDialogAccounts(_activeOpts.accounts)) {
    setErr(`snapd-acc-${acct.key}`, '');
    setSectionErr(acct.key, '');
    overlay
      .querySelectorAll(`[data-acct-key="${acct.key}"]`)
      .forEach((el) => (el as HTMLElement).removeAttribute('aria-invalid'));
  }

  const date =
    (overlay.querySelector('#snapd-date') as HTMLInputElement | null)?.value.trim() || '';
  if (!date || !/^\d{4}-\d{2}$/.test(date)) {
    setErr('snapd-date', 'Required – use YYYY-MM format.');
  } else if (date > currentMonth()) {
    setErr('snapd-date', 'Cannot log a future month.');
  }

  const snap: Snapshot = {
    date,
    notes: (overlay.querySelector('#snapd-notes') as HTMLInputElement | null)?.value.trim() || '',
  };
  let valid = !(overlay.querySelector('#snapd-date-err') as HTMLElement | null)?.textContent;

  for (const acct of _getDialogAccounts(_activeOpts.accounts)) {
    const totalInput = overlay.querySelector(`#snapd-acc-${acct.key}`) as HTMLInputElement | null;
    const totalRaw = totalInput?.value.trim() || '';
    const totalVal = parseNum(totalRaw);
    if (totalRaw !== '' && isNaN(totalVal)) {
      setErr(`snapd-acc-${acct.key}`, 'Must be a number.');
      valid = false;
    }
    snap[acct.key] = totalRaw === '' ? 0 : totalVal;

    const section = overlay.querySelector(`#snapd-etf-section-${acct.key}`) as HTMLElement | null;
    if (!section) continue;

    const inputs = Array.from(section.querySelectorAll<HTMLInputElement>('[data-etf-isin]'));
    let allocated = 0;
    let anySet = false;
    let hasInvalidEtf = false;
    for (const input of inputs) {
      const raw = input.value.trim();
      const value = parseNum(raw);
      if (raw !== '' && isNaN(value)) {
        input.setAttribute('aria-invalid', 'true');
        hasInvalidEtf = true;
        valid = false;
        continue;
      }
      if (value > 0) {
        anySet = true;
        allocated += value;
        const isin = input.dataset.etfIsin;
        if (isin) snap[`etf_${isin}`] = value;
      }
    }
    if (hasInvalidEtf) {
      _setSectionOpen(acct.key, true);
      setSectionErr(acct.key, 'ETF values must be numbers.');
      continue;
    }
    if (!anySet) continue;
    if (!isNaN(totalVal) && allocated - totalVal > 0.005) {
      _setSectionOpen(acct.key, true);
      _updateRecon(acct.key);
      setSectionErr(
        acct.key,
        `${acct.label}: ETF values (${fmtEur2(allocated)}) cannot exceed the account total (${fmtEur2(totalVal)}). Reduce ETF values or increase the account total.`,
      );
      valid = false;
    }
  }

  if (!valid) {
    focusFirstInvalid(overlay);
    return;
  }

  _dismiss(snap);
}

function _updateRecon(acctKey: string): void {
  const overlay = _dialog.overlay();
  if (!overlay) return;
  const section = overlay.querySelector(`#snapd-etf-section-${acctKey}`) as HTMLElement | null;
  const reconEl = overlay.querySelector(`#snapd-etf-recon-${acctKey}`) as HTMLElement | null;
  if (!section || !reconEl) return;

  const totalInput = overlay.querySelector(`#snapd-acc-${acctKey}`) as HTMLInputElement | null;
  const totalVal = parseNum(String(totalInput?.value ?? ''));

  let allocated = 0;
  let anySet = false;
  const inputs = section.querySelectorAll<HTMLInputElement>('[data-etf-isin]');
  for (const input of Array.from(inputs)) {
    const val = parseNum(String(input.value ?? ''));
    if (!isNaN(val) && val > 0) {
      anySet = true;
      allocated += val;
    }
  }
  if (!anySet) {
    reconEl.style.display = 'none';
    return;
  }

  reconEl.style.display = '';
  const remain = (isNaN(totalVal) ? 0 : totalVal) - allocated;
  const allocEl = reconEl.querySelector('.snap-etf-recon-alloc b') as HTMLElement | null;
  const remainWrap = reconEl.querySelector('.snap-etf-recon-remain') as HTMLElement | null;
  const remainEl = reconEl.querySelector('.snap-etf-recon-remain b') as HTMLElement | null;
  if (allocEl) allocEl.textContent = fmtEur2(allocated);
  if (remainEl) remainEl.textContent = fmtEur2(remain);
  if (remainWrap) {
    remainWrap.classList.remove('snap-etf-recon-warn', 'snap-etf-recon-ok');
    remainWrap.classList.add(remain >= -0.005 ? 'snap-etf-recon-ok' : 'snap-etf-recon-warn');
  }
}

function _setSectionOpen(acctKey: string, open: boolean): void {
  const overlay = _dialog.overlay();
  if (!overlay) return;
  const section = overlay.querySelector(`#snapd-etf-section-${acctKey}`) as HTMLElement | null;
  const btn = overlay.querySelector(
    `.snap-etf-toggle[data-acct-key="${acctKey}"]`,
  ) as HTMLElement | null;
  if (section) section.style.display = open ? '' : 'none';
  if (btn) {
    btn.setAttribute('aria-expanded', String(open));
    const chevron = btn.querySelector('.snap-etf-chevron') as HTMLElement | null;
    if (chevron) chevron.textContent = open ? '\u25be' : '\u25b8';
  }
}

function _dismiss(result: Snapshot | null): void {
  _dialog.dismiss(result);
}

function _getDialogAccounts(accounts: Account[]): Array<{
  key: string;
  label: string;
  currency: string;
  showEtfBreakdown: boolean;
}> {
  return accounts
    .map((acct) => {
      const key = acct.id || acct.key || '';
      return {
        key,
        label:
          acct.label ||
          `${acct.moneyType || 'Account'}${acct.institution ? ` · ${acct.institution}` : ''}`,
        currency: (acct.currency || 'EUR').trim().toUpperCase() || 'EUR',
        showEtfBreakdown: !!(
          key &&
          acct.isPrimaryInvestment &&
          (acct.moneyType || '').toLowerCase() === 'investment'
        ),
      };
    })
    .filter((acct) => !!acct.key);
}

function _esc(s: string | null | undefined): string {
  return esc(s);
}

function _updateFxHint(
  overlay: HTMLElement,
  acctKey: string,
  rawValue: string,
  rates: Record<string, number>,
): void {
  const hintEl = overlay.querySelector(`#snapd-acc-${acctKey}-fx`) as HTMLElement | null;
  if (!hintEl) return; // EUR accounts have no hint span
  const input = overlay.querySelector(`#snapd-acc-${acctKey}`) as HTMLInputElement | null;
  const currency = (input?.dataset.currency || '').toUpperCase();
  const rate = rates[currency];
  if (!rate) {
    hintEl.style.display = 'none';
    return;
  }
  const val = parseNum(rawValue.trim());
  if (!rawValue.trim() || isNaN(val)) {
    hintEl.style.display = 'none';
    return;
  }
  hintEl.textContent = `≈ ${fmtEur2(val * rate)} EUR`;
  hintEl.style.display = '';
}

function _updateAllFxHints(overlay: HTMLElement, rates: Record<string, number>): void {
  const inputs = overlay.querySelectorAll<HTMLInputElement>('[data-account-key]');
  for (const input of Array.from(inputs)) {
    const acctKey = input.dataset.accountKey || '';
    if (acctKey) _updateFxHint(overlay, acctKey, input.value, rates);
  }
}

function renderFxPrefetchStatus(el: HTMLElement, result: SnapshotDialogFxPrefetchResult): void {
  el.classList.remove('snapd-fx-status--warn');
  if (!result.needed) {
    el.textContent = '';
    return;
  }
  if (result.disabled) {
    el.textContent = 'FX: integration disabled.';
    return;
  }
  if (result.failed > 0) {
    el.classList.add('snapd-fx-status--warn');
    el.innerHTML =
      '<strong>⚠ FX rate fetch failed.</strong> Please convert non-EUR values to EUR manually before saving to ensure accuracy.';
    return;
  }
  el.textContent = 'FX: month-end rates ready.';
}
