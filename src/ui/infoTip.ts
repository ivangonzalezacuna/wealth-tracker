/**
 * Reusable inline info-tooltip component.
 *
 * Renders a small "?" icon. On hover (desktop) or tap (mobile), shows a
 * short explanation. Tapping anywhere else dismisses the tooltip.
 *
 * Usage in HTML template strings:
 *   `${infoTip('Explanation text here')}`
 *   `${infoTip('Warning text', 'warn')}`
 *
 * Attach listeners after DOM update:
 *   `attachInfoTips(rootElement)`
 */

/** Visual variants for the info-tip icon and popover. */
export type InfoTipVariant = 'warn' | 'alert';

/** Icon characters used per variant. */
const _VARIANT_ICON: Record<InfoTipVariant, string> = {
  warn: '\u25cf', // ● filled circle
  alert: '\u203c', // ‼ double exclamation
};

/**
 * Return an info-tip HTML snippet. Must call `attachInfoTips()` on the
 * container after inserting into DOM.
 * Pass an optional `variant` to render a warn (●) or alert (‼) style instead
 * of the default neutral "?" icon.
 */
export function infoTip(text: string, variant?: InfoTipVariant): string {
  // Escape for safe HTML attribute embedding
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const variantClass = variant ? ` info-tip--${variant}` : '';
  const icon = variant ? _VARIANT_ICON[variant] : '?';
  return `<span class="info-tip${variantClass}" data-tip="${escaped}" data-tip-variant="${variant ?? ''}" aria-label="${escaped}" tabindex="0">${icon}</span>`;
}

/**
 * Attach hover/click behaviour to all `.info-tip` elements within root.
 * Safe to call multiple times - already-bound tips are skipped.
 */
export function attachInfoTips(root: HTMLElement | Document = document): void {
  root.querySelectorAll('.info-tip:not([data-tip-bound])').forEach((el) => {
    (el as HTMLElement).dataset.tipBound = '1';

    // Single tap on mobile / click on desktop - show/hide
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      _togglePopover(el as HTMLElement);
    });

    // Desktop hover (non-touch) - show on enter, hide on leave
    el.addEventListener('mouseenter', () => {
      // Skip hover behavior on touch devices (avoids double-fire)
      if (_isTouchEvent()) return;
      _showPopover(el as HTMLElement);
    });
    el.addEventListener('mouseleave', () => {
      if (_isTouchEvent()) return;
      _hidePopover(el as HTMLElement);
    });
    el.addEventListener('focus', () => _showPopover(el as HTMLElement));
    el.addEventListener('blur', () => _hidePopover(el as HTMLElement));
  });
}

// ── Internal popover management ─────────────────────────────────

/** Extended HTMLElement with a reference to its body-appended popover. */
interface _TipEl extends HTMLElement {
  _tipPop?: HTMLElement;
  _tipScrollCleanup?: () => void;
}

/** Track if the device has seen a touch event (sticky after first touch). */
let _hasTouch = false;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'touchstart',
    () => {
      _hasTouch = true;
    },
    { once: true, passive: true },
  );
}

function _isTouchEvent(): boolean {
  return _hasTouch;
}

function _showPopover(trigger: HTMLElement): void {
  // Remove any other open popover first
  _dismissAll();
  if ((trigger as _TipEl)._tipPop) return;
  const text = trigger.dataset.tip || '';
  const pop = document.createElement('span');
  const variant = trigger.dataset.tipVariant;
  pop.className = variant ? `info-tip-pop info-tip-pop--${variant}` : 'info-tip-pop';
  pop.textContent = text;
  // Append to body so position:fixed is relative to the viewport,
  // not broken by CSS transforms on ancestor elements.
  document.body.appendChild(pop);
  (trigger as _TipEl)._tipPop = pop;
  // Position using fixed coordinates (escapes overflow:hidden/transform ancestors)
  _positionPopover(trigger, pop);

  // Dismiss when the page or any scroll ancestor scrolls / resizes
  const scrollAncestor = _findScrollAncestor(trigger);
  const dismiss = () => _hidePopover(trigger);
  window.addEventListener('scroll', dismiss, { passive: true, capture: true });
  window.addEventListener('resize', dismiss, { passive: true });
  if (scrollAncestor) {
    scrollAncestor.addEventListener('scroll', dismiss, { passive: true });
  }
  (trigger as _TipEl)._tipScrollCleanup = () => {
    window.removeEventListener('scroll', dismiss, { capture: true } as EventListenerOptions);
    window.removeEventListener('resize', dismiss);
    if (scrollAncestor) {
      scrollAncestor.removeEventListener('scroll', dismiss);
    }
  };
}

function _hidePopover(trigger: HTMLElement): void {
  const tipEl = trigger as _TipEl;
  const pop = tipEl._tipPop;
  if (pop) {
    pop.remove();
    delete tipEl._tipPop;
  }
  if (tipEl._tipScrollCleanup) {
    tipEl._tipScrollCleanup();
    delete tipEl._tipScrollCleanup;
  }
}

function _togglePopover(trigger: HTMLElement): void {
  if ((trigger as _TipEl)._tipPop) {
    _hidePopover(trigger);
  } else {
    _showPopover(trigger);
  }
}

function _positionPopover(trigger: HTMLElement, pop: HTMLElement): void {
  const rect = trigger.getBoundingClientRect();
  const left = rect.left + rect.width / 2;

  // Initially render hidden above the trigger to measure its dimensions
  pop.style.visibility = 'hidden';
  pop.style.left = `${left}px`;
  pop.style.top = `${rect.top - 6}px`;
  pop.style.transform = 'translate(-50%, -100%)';

  requestAnimationFrame(() => {
    const popRect = pop.getBoundingClientRect();
    const fitsAbove = rect.top - 6 - popRect.height >= 4;
    let top: number;
    let transform: string;

    if (fitsAbove) {
      top = rect.top - 6;
      transform = 'translate(-50%, -100%)';
    } else {
      // Not enough room above - show below the trigger instead
      top = rect.bottom + 6;
      transform = 'translate(-50%, 0)';
    }

    pop.style.top = `${top}px`;
    pop.style.transform = transform;

    // Clamp horizontal position to viewport
    const reRect = pop.getBoundingClientRect();
    let nextLeft = left;
    if (reRect.left < 4) {
      nextLeft = 4 + popRect.width / 2;
    } else if (reRect.right > window.innerWidth - 4) {
      nextLeft = window.innerWidth - 4 - popRect.width / 2;
    }
    pop.style.left = `${nextLeft}px`;
    pop.style.visibility = '';
  });
}

/** Walk up the DOM to find the nearest scrollable ancestor, if any. */
function _findScrollAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const { overflow, overflowY, overflowX } = getComputedStyle(node);
    if (/(auto|scroll)/.test(overflow + overflowY + overflowX)) return node;
    node = node.parentElement;
  }
  return null;
}

function _dismissAll(): void {
  document.querySelectorAll('.info-tip-pop').forEach((p) => p.remove());
  document.querySelectorAll<HTMLElement>('.info-tip[data-tip-bound]').forEach((el) => {
    const tipEl = el as _TipEl;
    delete tipEl._tipPop;
    if (tipEl._tipScrollCleanup) {
      tipEl._tipScrollCleanup();
      delete tipEl._tipScrollCleanup;
    }
  });
}

// Global: dismiss any open popovers on outside click
if (typeof document !== 'undefined') {
  document.addEventListener('click', _dismissAll);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') _dismissAll();
  });
}
