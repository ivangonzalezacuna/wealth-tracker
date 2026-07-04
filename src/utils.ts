import { getACCTSList } from './constants';
import type { Snapshot } from './types';

export function snapTotal(s: Snapshot): number {
  const accts: Array<{ key?: string; id?: string }> = getACCTSList();
  return accts.reduce((sum: number, a) => sum + (Number(s[a.key ?? a.id ?? '']) || 0), 0);
}

export function fmt(n: number, d = 0): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(Number(n));
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
    minimumFractionDigits: d,
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
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  return sign + abs + '%';
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
  if (!d) return '-';
  const [y, m] = d.split('-');
  return (
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1] +
    ' ' +
    y
  );
}

export function fmtDay(d: string): string {
  if (!d) return '-';
  return new Date(d + 'T12:00:00').toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ── Transient message persistence ────────────────────────
let _pendingMsg: { id: string; text: string; ok: boolean } | null = null;
let _pendingMsgTimer: ReturnType<typeof setTimeout> | null = null;

function _writeMsg(elId: string, text: string, ok: boolean): void {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? '#0F6E56' : '#A32D2D';
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
    el.style.color = _pendingMsg.ok ? '#0F6E56' : '#A32D2D';
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
    .replace(/"/g, '&quot;');
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
