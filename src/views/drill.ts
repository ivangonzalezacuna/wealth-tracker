/**
 * Chart drill-down: jump from a chart point to the matching rows elsewhere in the app.
 * Navigation presses the real tab buttons so hash routing, lazy renders and tab state
 * stay owned by main.ts.
 */
import { revealSnapshot, showTransactions } from './log';

function press(selector: string): void {
  document.querySelector<HTMLElement>(selector)?.click();
}

function goToLog(view: 'transactions' | 'snapshots'): void {
  press('.nav button[data-section="log"]');
  press(`#log-tab-${view}`);
}

/** Scroll a drill target into view, focus it and briefly highlight it. */
export function revealElement(el: HTMLElement | null): void {
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  el.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  el.classList.remove('drill-flash');
  void el.offsetWidth;
  el.classList.add('drill-flash');
  el.addEventListener('animationend', () => el.classList.remove('drill-flash'), { once: true });
}

/** Log › Snapshots with the month's snapshot expanded. */
export function drillToSnapshot(month: string): void {
  goToLog('snapshots');
  revealElement(revealSnapshot(month));
}

/** Log › Transactions filtered to a month (`YYYY-MM`) and optional transaction type. */
export function drillToTransactions(month: string, type = ''): void {
  goToLog('transactions');
  revealElement(showTransactions({ search: month, type }));
}
