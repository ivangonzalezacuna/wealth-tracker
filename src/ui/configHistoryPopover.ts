const ATTR = 'data-config-history-popover-body';
const POP_CLASS = 'config-history-pop';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface _PopEl extends HTMLElement {
  _configHistoryScrollCleanup?: () => void;
}

function _findScrollAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const { overflow, overflowY, overflowX } = getComputedStyle(node);
    if (/(auto|scroll)/.test(overflow + overflowY + overflowX)) return node;
    node = node.parentElement;
  }
  return null;
}

export function attachConfigHistoryPopovers(root: HTMLElement | Document = document): void {
  root.querySelectorAll<HTMLElement>(`[${ATTR}]:not([data-config-history-popover-bound])`).forEach((el) => {
    el.dataset.configHistoryPopoverBound = '1';
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      _toggle(el);
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
  const body = trigger.dataset.configHistoryPopoverBody || '';
  if (!body.trim()) return;
  const title = trigger.dataset.configHistoryPopoverTitle || '';

  const pop = document.createElement('div');
  pop.className = POP_CLASS;
  pop.dataset.forEl = _id(trigger);
  pop.innerHTML = `${title ? `<div class="config-history-pop-title">${esc(title)}</div>` : ''}<pre class="config-history-pop-body">${esc(body)}</pre>`;
  document.body.appendChild(pop);

  const scrollAncestor = _findScrollAncestor(trigger);
  const dismiss = () => _dismissAll();
  window.addEventListener('scroll', dismiss, { passive: true, capture: true });
  window.addEventListener('resize', dismiss, { passive: true });
  if (scrollAncestor) {
    scrollAncestor.addEventListener('scroll', dismiss, { passive: true });
  }
  (trigger as _PopEl)._configHistoryScrollCleanup = () => {
    window.removeEventListener('scroll', dismiss, { capture: true } as EventListenerOptions);
    window.removeEventListener('resize', dismiss);
    if (scrollAncestor) {
      scrollAncestor.removeEventListener('scroll', dismiss);
    }
  };

  const rect = trigger.getBoundingClientRect();
  const top = rect.bottom + 6;
  const left = rect.left + rect.width / 2;
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
  pop.style.transform = 'translateX(-50%)';

  requestAnimationFrame(() => {
    const popRect = pop.getBoundingClientRect();
    if (popRect.right > window.innerWidth - 8) {
      pop.style.left = `${window.innerWidth - 8 - popRect.width / 2}px`;
    }
    if (popRect.left < 8) {
      pop.style.left = `${8 + popRect.width / 2}px`;
    }
    if (popRect.bottom > window.innerHeight - 8) {
      pop.style.top = `${rect.top - 6 - popRect.height}px`;
    }
  });
}

let _counter = 0;
function _id(el: HTMLElement): string {
  if (!el.dataset.configHistoryPopoverId) el.dataset.configHistoryPopoverId = String(++_counter);
  return el.dataset.configHistoryPopoverId;
}

function _dismissAll(): void {
  document
    .querySelectorAll<HTMLElement>('[data-config-history-popover-bound]')
    .forEach((el) => {
      const popEl = el as _PopEl;
      if (popEl._configHistoryScrollCleanup) {
        popEl._configHistoryScrollCleanup();
        delete popEl._configHistoryScrollCleanup;
      }
    });
  document.querySelectorAll(`.${POP_CLASS}`).forEach((p) => p.remove());
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', _dismissAll);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') _dismissAll();
  });
}
