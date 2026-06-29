import { getACCTSList } from './constants';
import type { Snapshot } from './types';

export function snapTotal(s: Snapshot): number {
  const accts: Array<{ key?: string; id?: string }> = getACCTSList();
  return accts.reduce((sum: number, a) => sum + (Number(s[a.key ?? a.id ?? '']) || 0), 0);
}

export function fmt(n: number, d = 0): string {
  return '€' + Number(n).toLocaleString('de-DE', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/** Whole-euro display (no decimals). */
export const fmtEur  = (n: number) => fmt(n);
/** Euro display with cents (2 decimals). */
export const fmtEur2 = (n: number) => fmt(n, 2);

/** Current month as 'YYYY-MM' (local time) — the max allowed snapshot month. */
export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function fmtMon(d: string): string {
  if (!d) return '—';
  const [y, m] = d.split('-');
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1] + ' ' + y;
}

export function fmtDay(d: string): string {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('de-DE', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function showMsg(elId: string, text: string, ok: boolean): void {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? '#0F6E56' : '#A32D2D';
  if (ok) setTimeout(() => { el.textContent = ''; }, 6000);
}

/** Escape HTML special characters to prevent XSS via innerHTML. */
export function esc(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Sanitize a CSS color value — only allow safe patterns. */
export function safeColor(c: string | null | undefined): string {
  if (!c) return '#888';
  const s = String(c).trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
  if (/^(rgb|hsl)a?\([0-9,.\s%]+\)$/.test(s)) return s;
  if (/^[a-zA-Z]{1,20}$/.test(s)) return s;
  return '#888';
}
