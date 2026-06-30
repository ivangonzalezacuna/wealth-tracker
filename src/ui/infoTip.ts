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
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      _togglePopover(el as HTMLElement);
    });
    el.addEventListener('mouseenter', () => _showPopover(el as HTMLElement));
    el.addEventListener('mouseleave', () => _hidePopover(el as HTMLElement));
    el.addEventListener('focus', () => _showPopover(el as HTMLElement));
    el.addEventListener('blur', () => _hidePopover(el as HTMLElement));
  });
}

// ── Internal popover management ─────────────────────────────────

function _showPopover(trigger: HTMLElement): void {
  if (trigger.querySelector('.info-tip-pop')) return;
  const text = trigger.dataset.tip || '';
  const pop = document.createElement('span');
  pop.className = 'info-tip-pop';
  pop.textContent = text;
  trigger.appendChild(pop);
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

// Global: dismiss any open popovers on outside click
if (typeof document !== 'undefined') {
  document.addEventListener('click', () => {
    document.querySelectorAll('.info-tip-pop').forEach(p => p.remove());
  });
}
