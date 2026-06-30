/**
 * Reusable inline info-tooltip component.
 *
 * Renders a small "?" icon. On hover (desktop) or tap (mobile), shows a
 * short explanation. Tapping anywhere else dismisses the tooltip.
 *
 * Usage in HTML template strings:
 *   `${infoTip('Explanation text here')}`
 *
 * Attach listeners after DOM update:
 *   `attachInfoTips(rootElement)`
 */

/**
 * Return an info-tip HTML snippet. Must call `attachInfoTips()` on the
 * container after inserting into DOM.
 */
export function infoTip(text: string): string {
  // Escape for safe HTML attribute embedding
  const escaped = text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<span class="info-tip" data-tip="${escaped}" aria-label="${escaped}" tabindex="0">?</span>`;
}

/**
 * Attach hover/click behaviour to all `.info-tip` elements within root.
 * Safe to call multiple times — already-bound tips are skipped.
 */
export function attachInfoTips(root: HTMLElement | Document = document): void {
  root.querySelectorAll('.info-tip:not([data-tip-bound])').forEach(el => {
    (el as HTMLElement).dataset.tipBound = '1';

    // Single tap on mobile / click on desktop — show/hide
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      _togglePopover(el as HTMLElement);
    });

    // Desktop hover (non-touch) — show on enter, hide on leave
    el.addEventListener('mouseenter', (e) => {
      // Skip hover behavior on touch devices (avoids double-fire)
      if (_isTouchEvent(e as MouseEvent)) return;
      _showPopover(el as HTMLElement);
    });
    el.addEventListener('mouseleave', (e) => {
      if (_isTouchEvent(e as MouseEvent)) return;
      _hidePopover(el as HTMLElement);
    });
    el.addEventListener('focus', () => _showPopover(el as HTMLElement));
    el.addEventListener('blur', () => _hidePopover(el as HTMLElement));
  });
}

// ── Internal popover management ─────────────────────────────────

/** Track if the device has seen a touch event (sticky after first touch). */
let _hasTouch = false;
if (typeof window !== 'undefined') {
  window.addEventListener('touchstart', () => { _hasTouch = true; }, { once: true, passive: true });
}

function _isTouchEvent(_e: MouseEvent): boolean {
  return _hasTouch;
}

function _showPopover(trigger: HTMLElement): void {
  // Remove any other open popover first
  _dismissAll();
  if (trigger.querySelector('.info-tip-pop')) return;
  const text = trigger.dataset.tip || '';
  const pop = document.createElement('span');
  pop.className = 'info-tip-pop';
  pop.textContent = text;
  trigger.appendChild(pop);
  // Position using fixed coordinates (escapes overflow:hidden ancestors)
  _positionPopover(trigger, pop);
}

function _hidePopover(trigger: HTMLElement): void {
  trigger.querySelector('.info-tip-pop')?.remove();
}

function _togglePopover(trigger: HTMLElement): void {
  if (trigger.querySelector('.info-tip-pop')) {
    _hidePopover(trigger);
  } else {
    _showPopover(trigger);
  }
}

function _positionPopover(trigger: HTMLElement, pop: HTMLElement): void {
  const rect = trigger.getBoundingClientRect();
  // Place above the trigger, centered horizontally
  const top = rect.top - 6;
  const left = rect.left + rect.width / 2;

  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.transform = 'translate(-50%, -100%)';

  // After positioning, check if it overflows the viewport top — flip below if so
  requestAnimationFrame(() => {
    const popRect = pop.getBoundingClientRect();
    if (popRect.top < 4) {
      // Flip below
      const belowTop = rect.bottom + 6;
      pop.style.top = `${belowTop}px`;
      pop.style.transform = 'translate(-50%, 0)';
    }
    // Check horizontal overflow
    if (popRect.left < 4) {
      pop.style.left = `${4 + popRect.width / 2}px`;
    } else if (popRect.right > window.innerWidth - 4) {
      pop.style.left = `${window.innerWidth - 4 - popRect.width / 2}px`;
    }
  });
}

function _dismissAll(): void {
  document.querySelectorAll('.info-tip-pop').forEach(p => p.remove());
}

// Global: dismiss any open popovers on outside click
if (typeof document !== 'undefined') {
  document.addEventListener('click', _dismissAll);
}
