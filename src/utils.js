import { getACCTSList } from './constants.js';

export function snapTotal(s) {
  return getACCTSList().reduce((sum, a) => sum + (s[a.key] || 0), 0);
}

export function fmt(n, d = 0) {
  return '€' + Number(n).toLocaleString('de-DE', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function fmtMon(d) {
  if (!d) return '—';
  const [y, m] = d.split('-');
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1] + ' ' + y;
}

export function fmtDay(d) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('de-DE', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function showMsg(elId, text, ok) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? '#0F6E56' : '#A32D2D';
  if (ok) setTimeout(() => { el.textContent = ''; }, 3500);
}

/** Escape HTML special characters to prevent XSS via innerHTML. */
export function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Sanitize a CSS color value — only allow safe patterns. */
export function safeColor(c) {
  if (!c) return '#888';
  const s = String(c).trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
  if (/^(rgb|hsl)a?\([0-9,.\s%]+\)$/.test(s)) return s;
  if (/^[a-zA-Z]{1,20}$/.test(s)) return s;
  return '#888';
}
