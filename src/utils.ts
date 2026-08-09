import { getACCTSList } from './constants';
import { APP_CURRENCY } from './fx';
import type { Snapshot } from './types';
import { formatEnglishDay, formatEnglishMonth } from './dateFormat';

export function snapTotal(s: Snapshot): number {
  const accts: Array<{ key?: string; id?: string }> = getACCTSList();
  return accts.reduce((sum: number, a) => {
    const k = a.key ?? a.id ?? '';
    if (!k) console.warn('[snapTotal] account with no key or id will be skipped');
    return sum + (Number(s[k]) || 0);
  }, 0);
}

export function fmt(n: number, d = 0): string {
  const v = Number(n);
  if (!isFinite(v)) return '–';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: APP_CURRENCY,
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(v);
}

/** Whole-euro display (no decimals). */
export const fmtEur = (n: number) => fmt(n);
/** Euro display with cents (2 decimals). */
export const fmtEur2 = (n: number) => fmt(n, 2);

/** Format with U+2212 minus for negatives; no sign for positive/zero. */
export function fmtEurNeg(n: number, d = 0): string {
  return n < 0 ? '\u2212' + fmt(Math.abs(n), d) : fmt(n, d);
}

/** Percent format with U+2212 minus for negatives. */
export function fmtPctNeg(n: number, d = 1): string {
  const abs = Math.abs(n).toLocaleString('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: d,
  });
  return n < 0 ? '\u2212' + abs + '%' : abs + '%';
}

/** Full signed display: '+' for positive, U+2212 for negative, '' for zero. */
export function fmtEurSigned(n: number, d = 0): string {
  const sign = n > 0 ? '+' : n < 0 ? '\u2212' : '';
  return sign + fmt(Math.abs(n), d);
}

/** Percent format with explicit +/- signs. */
export function fmtPctSigned(n: number, d = 1): string {
  const sign = n > 0 ? '+' : n < 0 ? '\u2212' : '';
  const abs = Math.abs(n).toLocaleString('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: d,
  });
  return sign + abs + '%';
}

/**
 * Unsigned percentage with a smart decimal. By default shows 1 decimal only
 * when the value is not a whole number (e.g. 45 => "45%", 45.1 => "45.1%").
 * Pass decimals=2 to always show 2 decimal places (e.g. 0.33 => "0.33%").
 * Pass decimals='auto' to use the minimum precision needed to faithfully represent
 * the value: 0 decimals for whole numbers, 1 for x.y values, 2 for x.yz values
 * (e.g. 5 => "5%", 5.1 => "5.1%", 5.05 => "5.05%").
 * Uses English-style period decimal (consistent with the inline cost-basis
 * and drift target/actual columns).
 */
export function fmtPctVal(n: number, decimals: 1 | 2 | 'auto' = 1): string {
  if (decimals === 'auto') {
    const r2 = Math.round(n * 100) / 100;
    const r1 = Math.round(n * 10) / 10;
    if (r2 % 1 !== 0 && r2 !== r1) return r2.toFixed(2) + '%';
    if (r1 % 1 !== 0) return r1.toFixed(1) + '%';
    return Math.round(n).toFixed(0) + '%';
  }
  if (decimals === 2) {
    const rounded = Math.round(n * 100) / 100;
    return rounded.toFixed(2) + '%';
  }
  const rounded = Math.round(n * 10) / 10;
  return (rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)) + '%';
}

/** Share-count display, de-DE locale (comma decimal), up to 4 fraction digits, no trailing zeros. */
export function fmtShares(n: number): string {
  return Number(n).toLocaleString('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

/** Current month as 'YYYY-MM' (local time) - the max allowed snapshot month. */
export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function fmtMon(d: string): string {
  return formatEnglishMonth(d);
}

export function fmtDay(d: string): string {
  return formatEnglishDay(d);
}

// ── Transient message persistence ────────────────────────
let _pendingMsg: { id: string; text: string; ok: boolean } | null = null;
let _pendingMsgTimer: ReturnType<typeof setTimeout> | null = null;

function _writeMsg(elId: string, text: string, ok: boolean): void {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.classList.remove('msg-ok', 'msg-err');
  el.classList.add(ok ? 'msg-ok' : 'msg-err');
  if (ok)
    setTimeout(() => {
      if (el.textContent === text) el.textContent = '';
    }, 3500);
}

export function showMsg(elId: string, text: string, ok: boolean): void {
  _writeMsg(elId, text, ok);
  requestAnimationFrame(() => _writeMsg(elId, text, ok));
  if (_pendingMsgTimer) clearTimeout(_pendingMsgTimer);
  _pendingMsg = { id: elId, text, ok };
  _pendingMsgTimer = setTimeout(() => {
    _pendingMsg = null;
  }, 5000);
}

/** Re-injects the still-active terminal message ("Saved"/"Removed"/an error),
 *  if any, into its target element. Needed for a genuine full DOM rebuild;
 *  a scoped, data-only refresh never touches a message span at all, so it
 *  does not need this; call it defensively anyway since it is a cheap no-op. */
export function reinjectPendingMsg(): void {
  if (!_pendingMsg) return;
  const el = document.getElementById(_pendingMsg.id);
  if (el) {
    el.textContent = _pendingMsg.text;
    el.classList.remove('msg-ok', 'msg-err');
    el.classList.add(_pendingMsg.ok ? 'msg-ok' : 'msg-err');
  }
}

/** Disable a button for the duration of an async action and swap its label
 *  to a progress text (e.g. "Saving..."), so the button itself is the primary
 *  "something is happening" signal. Always restores the original label and
 *  re-enables, even on throw, unless keepDisabledOnSuccess is set (used by
 *  deletes, whose success path removes the row/button entirely via a table
 *  rebuild, so there is nothing left to restore). */
export async function withButtonGuard<T>(
  btn: HTMLButtonElement,
  action: () => Promise<T>,
  opts: { busyText?: string; keepDisabledOnSuccess?: boolean } = {},
): Promise<T> {
  const originalText = btn.textContent;
  btn.disabled = true;
  if (opts.busyText) btn.textContent = opts.busyText;
  try {
    const result = await action();
    if (!opts.keepDisabledOnSuccess) {
      btn.disabled = false;
      if (opts.busyText) btn.textContent = originalText;
    }
    return result;
  } catch (err) {
    btn.disabled = false;
    if (opts.busyText) btn.textContent = originalText;
    throw err;
  }
}

/** Escape HTML special characters to prevent XSS via innerHTML. */
export function esc(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Sanitize a CSS color value - only allow safe patterns. */
export function safeColor(c: string | null | undefined): string {
  if (!c) return '#888';
  const s = String(c).trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
  if (/^(rgb|hsl)a?\([0-9,.\s%]+\)$/.test(s)) return s;
  if (/^[a-zA-Z]{1,20}$/.test(s)) return s;
  return '#888';
}

/**
 * Renders one KPI tile (`.kpi` block used across Portfolio, Dividends,
 * Contributions, and Net Worth). `value` and `sub` must already be
 * pre-formatted/escaped by the caller, this only assembles the markup.
 */
export function kpiTile(opts: {
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
}): string {
  const cls = opts.valueClass ? ` ${opts.valueClass}` : '';
  const sub = opts.sub ? `<div class="kpi-sub">${opts.sub}</div>` : '';
  // Separate any trailing info-tip span from the label text so the label layout
  // can use flexbox without the badge ever wrapping to a new line.
  const tipIdx = opts.label.indexOf('<span class="info-tip"');
  const labelHtml =
    tipIdx >= 0
      ? `<span class="kpi-label-text">${opts.label.slice(0, tipIdx)}</span>${opts.label.slice(tipIdx)}`
      : `<span class="kpi-label-text">${opts.label}</span>`;
  return `<div class="kpi"><div class="kpi-label">${labelHtml}</div><div class="kpi-val${cls}">${opts.value}</div>${sub}</div>`;
}
