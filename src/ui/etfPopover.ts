/**
 * Lightweight ETF info popover - shows ISIN + long name on click.
 *
 * Usage:
 *   Add `data-etf-isin="..."` and `data-etf-name="..."` to any clickable element.
 *   Then call `attachEtfPopovers(container)` after DOM rendering.
 *
 * Clicking the element shows a small popover. Clicking elsewhere dismisses it.
 */

const ATTR = 'data-etf-isin';
const POP_CLASS = 'etf-pop';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Attach click-to-show popover on elements within `root` that have `data-etf-isin`.
 * Safe to call repeatedly — already-bound elements are skipped.
 */
export function attachEtfPopovers(root: HTMLElement | Document = document): void {
  root.querySelectorAll(`[${ATTR}]:not([data-etf-bound])`).forEach((el) => {
    (el as HTMLElement).dataset.etfBound = '1';
    (el as HTMLElement).style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      _toggle(el as HTMLElement);
    });
  });
}

function _toggle(trigger: HTMLElement): void {
  const existing = document.querySelector(`.${POP_CLASS}`) as HTMLElement | null;
  if (existing) {
    const wasThis = existing.dataset.forEl === _id(trigger);
    existing.remove();
    if (wasThis) return;
  }
  _show(trigger);
}

function _show(trigger: HTMLElement): void {
  const isin = trigger.dataset.etfIsin || '';
  const name = trigger.dataset.etfName || '';
  if (!isin && !name) return;

  const pop = document.createElement('div');
  pop.className = POP_CLASS;
  pop.dataset.forEl = _id(trigger);
  let html = '';
  if (name) html += `<div class="etf-pop-name">${esc(name)}</div>`;
  if (isin) html += `<div class="etf-pop-isin">${esc(isin)}</div>`;
  pop.innerHTML = html;
  document.body.appendChild(pop);

  // Position below the trigger
  const rect = trigger.getBoundingClientRect();
  const top = rect.bottom + 6;
  const left = rect.left + rect.width / 2;
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
  pop.style.transform = 'translateX(-50%)';

  // Adjust if overflowing
  requestAnimationFrame(() => {
    const popRect = pop.getBoundingClientRect();
    if (popRect.right > window.innerWidth - 8) {
      pop.style.left = `${window.innerWidth - 8 - popRect.width / 2}px`;
    }
    if (popRect.left < 8) {
      pop.style.left = `${8 + popRect.width / 2}px`;
    }
    // If below viewport, flip above
    if (popRect.bottom > window.innerHeight - 8) {
      pop.style.top = `${rect.top - 6 - popRect.height}px`;
    }
  });
}

let _counter = 0;
function _id(el: HTMLElement): string {
  if (!el.dataset.etfPopId) el.dataset.etfPopId = String(++_counter);
  return el.dataset.etfPopId;
}

function _dismissAll(): void {
  document.querySelectorAll(`.${POP_CLASS}`).forEach((p) => p.remove());
}

// Global dismiss on outside click or Escape
if (typeof document !== 'undefined') {
  document.addEventListener('click', _dismissAll);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') _dismissAll();
  });
}
