import { normalizeSnapshotReview, type SnapshotReviewResult } from '../model/snapshotFx';
import { isValidISIN, normalizeISIN } from '../model/isin';
import { infoTip, attachInfoTips } from './infoTip';
import { currentMonth, fmtEur2, fmtMon, safeColor, esc } from '../utils';
import type { Account, Holding, PortfolioData, Snapshot } from '../types';
import {
  createDialogController,
  focusFirstInvalid,
  makeDialogHelpers,
  openDialogShell,
} from './modalShell';

let _activeOpts: SnapshotDialogOptions | null = null;
let _reviewed: Snapshot | null = null;
let _busy = false;
const _representedEtfKeys = new WeakMap<HTMLElement, Set<string>>();
const _dialog = createDialogController<Snapshot | null>(null, {
  overlaySelector: '.snap-dialog-overlay',
  reset: () => {
    _activeOpts = null;
    _reviewed = null;
    _busy = false;
  },
});

export interface SnapshotDialogOptions {
  existing?: Snapshot;
  accounts: Account[];
  holdings: PortfolioData['etfs'];
  configHoldings?: Holding[];
  prefill?: Snapshot;
  mode?: 'add' | 'edit';
  existingMonths?: string[];
  copiedFromMonth?: string;
  onReview?: (draft: Snapshot, currencies: Record<string, string>) => Promise<SnapshotReviewResult>;
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
    const previous = new Date();
    previous.setDate(1);
    previous.setMonth(previous.getMonth() - 1);
    const defaultMonth = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
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
                value="${_esc(draft?.date || defaultMonth)}" max="${today}" aria-describedby="snapd-month-note snapd-date-err">
              <div class="note snapd-field-note" id="snapd-month-note"></div>
              <span class="dialog-error dialog-error-compact" id="snapd-date-err"></span>
              ${
                opts.onFxPrefetchMonth
                  ? '<div class="note snapd-field-note" id="snapd-fx-status" aria-live="polite"></div>'
                  : ''
              }
            </div>
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" for="snapd-notes">Notes (optional)</label>
              <input type="text" id="snapd-notes" class="form-input dialog-input"
                value="${_esc(draft?.notes || '')}" placeholder="e.g. catch-up done, got raise...">
            </div>
          </div>
          ${_getDialogAccounts(opts.accounts).some((a) => a.currency !== 'EUR') ? `<div class="snapd-currency-help"><label class="dialog-label" style="cursor:pointer"><input type="checkbox" id="snapd-eur" ${draft ? 'checked' : ''}> Enter all values in EUR${infoTip('Otherwise use each account’s native currency. Stored values are EUR — switching converts the draft only when FX rates are available.')}</label></div>` : ''}
          ${_renderAccountFields(opts.accounts, opts.holdings, opts.configHoldings || [], draft)}
          <div class="dialog-error" id="snapd-review-err" role="alert"></div>
        </div>
        <div class="snapd-review" hidden tabindex="-1"></div>
        <div class="dialog-actions">
          <button class="btn btn-sm btn-ghost js-snapd-cancel">Cancel</button>
          <button class="btn btn-sm btn-ghost js-snapd-back" hidden>Back to edit</button>
          <button class="btn btn-sm btn-primary js-snapd-submit">Review</button>
        </div>
      </div>`;

    _representedEtfKeys.set(
      overlay,
      new Set(
        Array.from(overlay.querySelectorAll<HTMLInputElement>('[data-etf-isin]')).map(
          (input) => `etf_${input.dataset.etfIsin}`,
        ),
      ),
    );
    openDialogShell(_dialog, {
      overlay,
      onDismiss: () => _dismiss(null),
      onCancel: () => _dismiss(null),
      onSubmit: () => void _submit(),
      cancelSelector: '.js-snapd-cancel',
      submitSelector: '.js-snapd-submit',
      focusablesSelector:
        'input:not([disabled]):not([hidden]), button:not([disabled]):not([hidden]), summary, .info-tip',
      initialFocusSelector: '#snapd-date',
    });
    attachInfoTips(overlay);
    overlay.querySelector('.js-snapd-back')?.addEventListener('click', () => {
      _reviewed = null;
      (overlay.querySelector('.dialog-fields') as HTMLElement).hidden = false;
      (overlay.querySelector('.dialog-header') as HTMLElement).hidden = false;
      (overlay.querySelector('.snapd-review') as HTMLElement).hidden = true;
      (overlay.querySelector('.js-snapd-back') as HTMLElement).hidden = true;
      (overlay.querySelector('.js-snapd-submit') as HTMLElement).textContent = 'Review';
      (overlay.querySelector('#snapd-date') as HTMLElement).focus();
    });
    overlay.addEventListener('click', (e) => {
      const remove = (e.target as HTMLElement).closest('.js-snapd-remove') as HTMLElement | null;
      if (remove) {
        const row = remove.closest('.snap-etf-extra')!;
        const key = remove.dataset.acctKey || '';
        const group = row.parentElement!;
        const rows = Array.from(group.querySelectorAll('.snap-etf-extra'));
        const next = rows[rows.indexOf(row) + 1] || rows[rows.indexOf(row) - 1];
        row.remove();
        _updateRecon(key);
        (
          next?.querySelector<HTMLElement>('[data-extra-isin]') ||
          group.querySelector<HTMLElement>('.js-snapd-extra')
        )?.focus();
        return;
      }
      const add = (e.target as HTMLElement).closest('.js-snapd-extra') as HTMLElement | null;
      if (add) {
        const key = add.dataset.acctKey || '';
        const row = document.createElement('div');
        row.className = 'snap-etf-row snap-etf-extra';
        row.innerHTML = _renderManualEtfFields(key);
        add.before(row);
        (row.firstElementChild as HTMLElement).focus();
        return;
      }
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
      if (acctKeyForHint)
        _updateFxHint(
          overlay,
          acctKeyForHint,
          target.value,
          (overlay.querySelector('#snapd-eur') as HTMLInputElement | null)?.checked ? {} : fxRates,
        );
    });
    const fxStatusEl = overlay.querySelector('#snapd-fx-status') as HTMLElement | null;
    const prefetchCache = new Map<string, SnapshotDialogFxPrefetchResult>();
    let prefetchRequestSeq = 0;
    let fxRates: Record<string, number> = {};
    const triggerFxPrefetch = (yearMonth: string): void => {
      ++prefetchRequestSeq;
      fxRates = {};
      _updateAllFxHints(overlay, fxRates);
      if (!opts.onFxPrefetchMonth || !fxStatusEl || !yearMonth) return;
      const cached = prefetchCache.get(yearMonth);
      if (cached) {
        fxRates = cached.rates || {};
        renderFxPrefetchStatus(fxStatusEl, cached);
        _updateAllFxHints(overlay, fxRates);
        return;
      }
      fxStatusEl.textContent = 'FX: fetching month-end rates…';
      const requestSeq = prefetchRequestSeq;
      void opts
        .onFxPrefetchMonth(yearMonth)
        .then((result) => {
          prefetchCache.set(yearMonth, result);
          if (requestSeq !== prefetchRequestSeq || _dialog.overlay() !== overlay) return;
          fxRates = result.rates || {};
          renderFxPrefetchStatus(fxStatusEl, result);
          _updateAllFxHints(overlay, fxRates);
        })
        .catch(() => {
          if (requestSeq !== prefetchRequestSeq) return;
          fxStatusEl.classList.add('snapd-fx-status--warn');
          fxStatusEl.innerHTML =
            '<strong>⚠ FX rate fetch failed.</strong> Please enter values already converted to EUR before saving to ensure accuracy.';
        });
    };
    const monthInput = overlay.querySelector('#snapd-date') as HTMLInputElement | null;
    const updateMonthNote = () => {
      const month = monthInput?.value || '';
      const end = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
      (overlay.querySelector('#snapd-month-note') as HTMLElement).textContent =
        `Month-end balances as of ${month}-${end}.${month === today ? ' Current month is provisional.' : ''}`;
    };
    monthInput?.addEventListener('change', () => {
      const modeInput = overlay.querySelector('#snapd-eur') as HTMLInputElement | null;
      if (modeInput && !modeInput.checked && Object.keys(fxRates).length) {
        const primary = _getDialogAccounts(opts.accounts).find((a) => a.showEtfBreakdown);
        const fields = Array.from(
          overlay.querySelectorAll<HTMLInputElement>('[data-account-key], [data-etf-isin]'),
        );
        const nonEmptyForeign = fields.filter(
          (f) => f.value.trim() && (f.dataset.currency || primary?.currency || 'EUR') !== 'EUR',
        );
        if (
          nonEmptyForeign.every(
            (f) => fxRates[f.dataset.currency || primary?.currency || 'EUR'] > 0,
          )
        ) {
          for (const field of nonEmptyForeign) {
            const value = parseNum(field.value);
            if (Number.isFinite(value))
              field.value = String(
                value * fxRates[field.dataset.currency || primary?.currency || 'EUR'],
              );
          }
          modeInput.checked = true;
          updateCurrencyLabels();
          (overlay.querySelector('#snapd-review-err') as HTMLElement).textContent =
            'Month changed — draft converted to explicit EUR using the previous month’s rates. Check balances or switch back to native currency after the new month’s rates load.';
        }
      }
      updateMonthNote();
      triggerFxPrefetch(monthInput.value.trim());
    });
    updateMonthNote();
    const eurMode = overlay.querySelector('#snapd-eur') as HTMLInputElement | null;
    const updateCurrencyLabels = () => {
      for (const acct of _getDialogAccounts(opts.accounts)) {
        const label = overlay.querySelector(`label[for="snapd-acc-${acct.key}"]`);
        if (label)
          label.textContent = `${acct.label} (${eurMode?.checked ? 'EUR' : acct.currency})`;
      }
      _updateAllFxHints(overlay, eurMode?.checked ? {} : fxRates);
    };
    eurMode?.addEventListener('change', () => {
      const fields = Array.from(
        overlay.querySelectorAll<HTMLInputElement>('[data-account-key], [data-etf-isin]'),
      );
      const primary = _getDialogAccounts(opts.accounts).find((a) => a.showEtfBreakdown);
      const needed = fields
        .filter((f) => f.value.trim())
        .map((f) => f.dataset.currency || primary?.currency || 'EUR')
        .filter((c) => c !== 'EUR');
      if (needed.some((c) => !Number.isFinite(fxRates[c]) || fxRates[c] <= 0)) {
        eurMode.checked = !eurMode.checked;
        (overlay.querySelector('#snapd-review-err') as HTMLElement).textContent =
          'FX unavailable — clear foreign values to enter explicitly converted EUR amounts, or retry Review / change month to fetch rates.';
        return;
      }
      for (const field of fields) {
        const value = parseNum(field.value);
        if (!Number.isFinite(value)) continue;
        const currency = field.dataset.currency || primary?.currency || 'EUR';
        const rate = currency === 'EUR' ? 1 : fxRates[currency];
        field.value = String(eurMode.checked ? value * rate : value / rate);
      }
      updateCurrencyLabels();
      for (const acct of _getDialogAccounts(opts.accounts)) _updateRecon(acct.key);
    });
    updateCurrencyLabels();
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
              placeholder="${acct.currency !== 'EUR' ? `total value in ${_esc(acct.currency)}` : 'total value'}">
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
  const activeIsins = new Set(
    configHoldings
      .filter(
        (h) => h.active && ((h.targetPct ?? 0) > 0 || held.some((pos) => pos.isin === h.isin)),
      )
      .map((h) => h.isin),
  );
  const rows = new Map<string, { isin: string; name: string; shortName: string; color: string }>(
    Object.values(holdings || {})
      .filter(
        (pos) =>
          (!pos.exited && pos.shares >= 1e-6) || typeof draft?.[`etf_${pos.isin}`] === 'number',
      )
      .map((pos) => [pos.isin, pos]),
  );
  for (const h of configHoldings) {
    if (!rows.has(h.isin)) rows.set(h.isin, h);
  }
  const accountKeys = new Set(_activeOpts?.accounts.map((a) => a.id || a.key));
  for (const key of Object.keys(draft || {})) {
    if (
      key.startsWith('etf_') &&
      !accountKeys.has(key) &&
      typeof draft?.[key] === 'number' &&
      isValidISIN(key.slice(4))
    ) {
      const isin = key.slice(4);
      if (!rows.has(isin)) rows.set(isin, { isin, name: isin, shortName: isin, color: '#888888' });
    }
  }
  const contributing = Array.from(rows.values()).filter((pos) => activeIsins.has(pos.isin));
  const legacy = Array.from(rows.values()).filter((pos) => !activeIsins.has(pos.isin));
  const knownIsins = new Set([
    ...configHoldings.map((h) => h.isin),
    ...Object.values(holdings || {}).map((h) => h.isin),
  ]);
  const existingRows = legacy.filter((pos) => knownIsins.has(pos.isin));
  const manualRows = legacy.filter((pos) => !knownIsins.has(pos.isin));

  const getName = (isin: string, fallbackName: string, shortName: string): string => {
    const cfg = configHoldings.find((h) => h.isin === isin);
    return cfg?.name || fallbackName || shortName;
  };

  const renderRow = (pos: {
    isin: string;
    name: string;
    shortName: string;
    color: string;
  }): string => {
    const value = draft?.[`etf_${pos.isin}`];
    if (!knownIsins.has(pos.isin)) {
      return `<div class="snap-etf-row snap-etf-extra">${_renderManualEtfFields(acctKey, pos.isin, value)}</div>`;
    }
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
               aria-label="${_esc(getName(pos.isin, pos.name, pos.shortName))} ETF value"
               class="form-input form-input-sm snap-etf-input"
               value="${typeof value === 'number' || typeof value === 'string' ? _esc(String(value)) : ''}"
               placeholder="Value">
      </div>`;
  };

  const contribHtml =
    contributing.length > 0
      ? `<div class="snap-etf-group"><div class="snap-etf-group-label">Usual ETFs</div>${contributing.map(renderRow).join('')}</div>`
      : '';
  const legacyHtml = `<details class="snap-etf-other"><summary>Other ETFs</summary>${existingRows.length ? `<div class="snap-etf-group" role="group" aria-label="Existing holdings"><div class="snap-etf-group-label">Existing holdings</div>${existingRows.map(renderRow).join('')}</div>` : ''}<div class="snap-etf-group" role="group" aria-label="Manual entries"><div class="snap-etf-group-label">Manual entries</div>${manualRows.map(renderRow).join('')}<button type="button" class="btn btn-sm btn-ghost js-snapd-extra" data-acct-key="${_esc(acctKey)}">Add ETF</button><p class="note">Snapshot only · blank omits; 0 records zero.</p></div></details>`;

  return `
    <div class="snap-etf-wrap">
      <button type="button" class="snap-etf-toggle btn btn-sm btn-ghost"
              data-acct-key="${_esc(acctKey)}" aria-expanded="true" aria-controls="snapd-etf-section-${_esc(acctKey)}">
        <span class="snap-etf-chevron">\u25be</span> ETF breakdown
      </button>
      <div class="snap-etf-section" id="snapd-etf-section-${_esc(acctKey)}">
        ${contribHtml}
        ${legacyHtml}
        <div class="snap-etf-recon" id="snapd-etf-recon-${_esc(acctKey)}" style="display:none">
          <span class="snap-etf-recon-alloc">Allocated: <b>-</b></span>
          <span class="snap-etf-recon-sep">&middot;</span>
          <span class="snap-etf-recon-remain">Unexplained remainder (cash or unrecorded positions): <b>-</b></span>
        </div>
        <span class="dialog-error dialog-error-compact" id="snapd-etf-${_esc(acctKey)}-err"></span>
      </div>
    </div>`;
}

function _renderManualEtfFields(acctKey: string, isin = '', value?: Snapshot[string]): string {
  return `<input class="form-input form-input-sm" placeholder="ISIN" aria-label="Other ETF ISIN" data-extra-isin data-acct-key="${_esc(acctKey)}" value="${_esc(isin)}"><input class="form-input form-input-sm snap-etf-input" inputmode="decimal" placeholder="Value" aria-label="Other ETF value" data-etf-isin="${_esc(isin)}" data-acct-key="${_esc(acctKey)}" value="${typeof value === 'number' ? _esc(String(value)) : ''}"><button type="button" class="btn btn-sm btn-ghost js-snapd-remove" data-acct-key="${_esc(acctKey)}" aria-label="Remove other ETF">Remove</button>`;
}

async function _submit(): Promise<void> {
  const overlay = _dialog.overlay();
  if (!overlay || !_activeOpts || _busy) return;
  if (_reviewed) {
    _dismiss(_reviewed);
    return;
  }
  const opts = _activeOpts;
  overlay.querySelectorAll('[data-extra-isin]').forEach((el) => el.removeAttribute('aria-invalid'));
  const eurMode = !!(overlay.querySelector('#snapd-eur') as HTMLInputElement | null)?.checked;
  const currencies: Record<string, string> = {};
  (overlay.querySelector('#snapd-review-err') as HTMLElement).textContent = '';

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
  if (!date || !/^\d{4}-(0[1-9]|1[0-2])$/.test(date)) {
    setErr('snapd-date', 'Required – use YYYY-MM format.');
  } else if (date > currentMonth()) {
    setErr('snapd-date', 'Cannot log a future month.');
  }

  const snap: Snapshot = {
    ...opts.existing,
    ...opts.prefill,
    date,
    notes: (overlay.querySelector('#snapd-notes') as HTMLInputElement | null)?.value.trim() || '',
  };
  // Clear every originally represented key before applying current rows, including renames/removals.
  for (const key of _representedEtfKeys.get(overlay) || []) delete snap[key];
  let valid = !(overlay.querySelector('#snapd-date-err') as HTMLElement | null)?.textContent;

  for (const acct of _getDialogAccounts(_activeOpts.accounts)) {
    const totalInput = overlay.querySelector(`#snapd-acc-${acct.key}`) as HTMLInputElement | null;
    const totalRaw = totalInput?.value.trim() || '';
    const totalVal = parseNum(totalRaw);
    if (totalRaw === '' || !Number.isFinite(totalVal)) {
      setErr(`snapd-acc-${acct.key}`, 'Enter an explicit finite balance (0 is allowed).');
      valid = false;
    }
    snap[acct.key] = totalVal;
    currencies[acct.key] = eurMode ? 'EUR' : acct.currency;

    const section = overlay.querySelector(`#snapd-etf-section-${acct.key}`) as HTMLElement | null;
    if (!section) continue;

    const inputs = Array.from(section.querySelectorAll<HTMLInputElement>('[data-etf-isin]'));
    let allocated = 0;
    let anySet = false;
    let hasInvalidEtf = false;
    const seen = new Set<string>();
    for (const input of inputs) {
      const raw = input.value.trim();
      const value = parseNum(raw);
      const extraIsin = input.parentElement?.querySelector<HTMLInputElement>('[data-extra-isin]');
      const isin = normalizeISIN(extraIsin ? extraIsin.value : input.dataset.etfIsin || '');
      if (extraIsin && !raw && !isin) continue;
      if (
        !isin ||
        !/^[A-Z0-9]+$/.test(isin) ||
        seen.has(isin) ||
        _getDialogAccounts(opts.accounts).some((a) => a.key === `etf_${isin}`) ||
        (extraIsin && !isValidISIN(isin))
      ) {
        input.setAttribute('aria-invalid', 'true');
        if (extraIsin) extraIsin.setAttribute('aria-invalid', 'true');
        hasInvalidEtf = true;
        valid = false;
        continue;
      }
      seen.add(isin);
      if (raw !== '' && (!Number.isFinite(value) || value < 0)) {
        input.setAttribute('aria-invalid', 'true');
        hasInvalidEtf = true;
        valid = false;
        continue;
      }
      const key = `etf_${isin}`;
      delete snap[key];
      if (raw !== '') {
        anySet = true;
        allocated += value;
        snap[key] = value;
        currencies[key] = eurMode ? 'EUR' : acct.currency;
      }
    }
    if (hasInvalidEtf) {
      _setSectionOpen(acct.key, true);
      section.querySelectorAll('details').forEach((d) => (d.open = true));
      setSectionErr(
        acct.key,
        'ETF values must be finite non-negative numbers; use valid, unique ISINs (no duplicates).',
      );
      continue;
    }
    if (!anySet) continue;
    if (Number.isFinite(totalVal) && allocated - totalVal > 0.005) {
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

  const submit = overlay.querySelector<HTMLButtonElement>('.js-snapd-submit')!;
  _busy = true;
  submit.disabled = true;
  submit.textContent = 'Preparing review…';
  const draftControls = Array.from(
    overlay.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      '.dialog-fields input, .dialog-fields button',
    ),
  );
  for (const control of draftControls) control.disabled = true;
  try {
    const result = await (opts.onReview || normalizeSnapshotReview)(snap, currencies);
    if (_dialog.overlay() !== overlay) return;
    if (!result.snapshot || result.error) {
      (overlay.querySelector('#snapd-review-err') as HTMLElement).textContent =
        result.error || 'Unable to prepare review. Retry.';
      return;
    }
    _reviewed = result.snapshot;
    const review = overlay.querySelector<HTMLElement>('.snapd-review')!;
    const replacing = opts.existingMonths?.includes(date) || opts.existing?.date === date;
    const numeric = Object.entries(_reviewed).filter(([, v]) => typeof v === 'number');
    const baseline = Object.entries(opts.prefill || {}).filter(([, v]) => typeof v === 'number');
    const copiedUnchanged =
      !opts.existing &&
      !replacing &&
      opts.mode !== 'edit' &&
      !!opts.copiedFromMonth &&
      opts.copiedFromMonth !== date &&
      !!opts.prefill &&
      numeric.length === baseline.length &&
      baseline.every(([key, value]) => _reviewed![key] === value);
    const primary = _getDialogAccounts(opts.accounts).find((a) => a.showEtfBreakdown);
    const allocation = numeric
      .filter(
        ([key]) =>
          key.startsWith('etf_') && !_getDialogAccounts(opts.accounts).some((a) => a.key === key),
      )
      .reduce((sum, [, value]) => sum + Number(value), 0);
    const rateSummary = Object.entries(result.rates || {})
      .map(([currency, rate]) => `1 ${_esc(currency)} = ${rate} EUR`)
      .join(' — ');
    const accounts = _getDialogAccounts(opts.accounts);
    const isEtf = (key: string) => key.startsWith('etf_') && !accounts.some((a) => a.key === key);
    const renderValues = (entries: typeof numeric): string =>
      entries
        .map(([key, value]) => {
          const acct = accounts.find((a) => a.key === key);
          const isin = isEtf(key) ? key.slice(4) : '';
          const holding = opts.configHoldings?.find((h) => h.isin === isin);
          const label = acct?.label || holding?.name || (isin ? `ETF ${isin}` : key);
          const detail = holding ? `<span class="snapd-review-isin">${_esc(isin)}</span>` : '';
          return `<div><dt>${_esc(label)}${detail}</dt><dd>${fmtEur2(Number(value))}</dd></div>`;
        })
        .join('');
    const accountValues = numeric.filter(([key]) => !isEtf(key));
    const etfValues = numeric.filter(([key]) => isEtf(key));
    review.innerHTML = `
      <div class="snapd-review-header">
        <div class="dialog-title">Review snapshot — ${_esc(fmtMon(date))}</div>
        <p class="snapd-review-context">Month-end balances · EUR${date === currentMonth() ? ' · Provisional' : ''}</p>
      </div>
      ${copiedUnchanged ? `<p class="snapd-review-warning" role="status">Copied from ${_esc(opts.copiedFromMonth)} — values are unchanged; check before saving.</p>` : ''}
      ${rateSummary ? `<p class="snapd-review-context">FX applied: ${rateSummary}</p>` : ''}
      ${replacing ? '<p class="snapd-review-warning" role="alert">Saving will replace the existing snapshot for this month.</p>' : ''}
      <section class="snapd-review-section" aria-label="Account balances">
        <div class="section-label">Accounts</div>
        <dl class="snapd-review-values">${renderValues(accountValues)}</dl>
      </section>
      ${etfValues.length ? `<section class="snapd-review-section" aria-label="ETF values"><div class="section-label">ETF breakdown</div><dl class="snapd-review-values">${renderValues(etfValues)}</dl></section>` : ''}
      ${primary && etfValues.length ? `<div class="snapd-review-summary"><dl class="snapd-review-values"><div><dt>ETF allocated</dt><dd>${fmtEur2(allocation)}</dd></div><div><dt>Unexplained remainder</dt><dd>${fmtEur2(Number(_reviewed[primary.key]) - allocation)}</dd></div></dl><p class="snapd-review-context">Remainder may be cash or unrecorded positions.</p></div>` : ''}
      ${_reviewed.notes ? `<p class="snapd-review-context snapd-review-notes"><strong>Notes</strong> — ${_esc(_reviewed.notes)}</p>` : ''}`;
    overlay.querySelector('.info-tip')?.dispatchEvent(new Event('blur'));
    (overlay.querySelector('.dialog-fields') as HTMLElement).hidden = true;
    (overlay.querySelector('.dialog-header') as HTMLElement).hidden = true;
    review.hidden = false;
    (overlay.querySelector('.js-snapd-back') as HTMLElement).hidden = false;
    review.focus();
  } catch {
    if (_dialog.overlay() === overlay)
      (overlay.querySelector('#snapd-review-err') as HTMLElement).textContent =
        'Review failed — your draft is kept. Retry.';
  } finally {
    if (_dialog.overlay() === overlay) {
      _busy = false;
      for (const control of draftControls) control.disabled = false;
      submit.disabled = false;
      submit.textContent = _reviewed ? 'Save snapshot' : 'Review';
    }
  }
}

/** Accept a complete decimal token, never parse a numeric prefix or grouping ambiguities. */
function parseNum(raw: string): number {
  const value = raw.trim();
  if (/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value)) {
    return Number(value.replace(',', '.'));
  }
  if (/^[+-]?\d{1,3}(?:,\d{3})+\.\d+$/.test(value)) return Number(value.replaceAll(',', ''));
  if (/^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/.test(value))
    return Number(value.replaceAll('.', '').replace(',', '.'));
  return NaN;
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
    if (Number.isFinite(val) && input.value.trim() && val >= 0) {
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
  if (section) {
    section.hidden = !open;
    section.style.display = open ? '' : 'none';
  }
  if (btn) {
    btn.setAttribute('aria-expanded', String(open));
    const chevron = btn.querySelector('.snap-etf-chevron') as HTMLElement | null;
    if (chevron) chevron.textContent = open ? '\u25be' : '\u25b8';
  }
}

function _dismiss(result: Snapshot | null): void {
  _dialog.overlay()?.querySelector('.info-tip')?.dispatchEvent(new Event('blur'));
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
  hintEl.textContent = `≈ ${fmtEur2(val * rate)} EUR · rate: 1 ${currency} = ${rate.toFixed(4)} EUR`;
  hintEl.style.display = '';
}

function _updateAllFxHints(overlay: HTMLElement, rates: Record<string, number>): void {
  if ((overlay.querySelector('#snapd-eur') as HTMLInputElement | null)?.checked) rates = {};
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
      '<strong>⚠ FX rate fetch failed.</strong> Please enter values already converted to EUR before saving to ensure accuracy.';
    return;
  }
  el.textContent = 'FX: month-end rates ready.';
}
