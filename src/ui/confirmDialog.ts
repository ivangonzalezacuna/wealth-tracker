/** Promise-based confirmation dialog. Resolves true on confirm, false on cancel/dismiss. Single instance. */

let _activeResolve: ((v: boolean) => void) | null = null;
let _activeTrigger: HTMLElement | null = null;
let _activeOverlay: HTMLElement | null = null;

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // true => confirm button uses .btn-danger styling
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    _dismiss(false); // close any existing dialog first, resolving it false
    _activeResolve = resolve;
    _activeTrigger = document.activeElement as HTMLElement | null;

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div class="confirm-title" id="confirm-title">${_esc(opts.title)}</div>
        ${opts.body ? `<div class="confirm-body">${_esc(opts.body)}</div>` : ''}
        <div class="confirm-actions">
          <button class="btn btn-sm btn-ghost js-confirm-cancel">${_esc(opts.cancelLabel || 'Cancel')}</button>
          <button class="btn btn-sm ${opts.danger ? 'btn-danger' : 'btn-primary'} js-confirm-ok">${_esc(opts.confirmLabel || 'Confirm')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    _activeOverlay = overlay;

    const okBtn = overlay.querySelector('.js-confirm-ok') as HTMLElement;
    const cancelBtn = overlay.querySelector('.js-confirm-cancel') as HTMLElement;
    okBtn.addEventListener('click', () => _dismiss(true));
    cancelBtn.addEventListener('click', () => _dismiss(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) _dismiss(false);
    });
    document.addEventListener('keydown', _onKeydown);

    // Focus the cancel button by default (safer default for destructive actions)
    cancelBtn.focus();
  });
}

function _onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    _dismiss(false);
    return;
  }
  if (e.key !== 'Tab' || !_activeOverlay) return;
  const focusables = Array.from(
    _activeOverlay.querySelectorAll('button:not([disabled])'),
  ) as HTMLElement[];
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey) {
    if (active === first || !active || !_activeOverlay.contains(active)) {
      e.preventDefault();
      last.focus();
    }
    return;
  }
  if (active === last || !active || !_activeOverlay.contains(active)) {
    e.preventDefault();
    first.focus();
  }
}

function _dismiss(result: boolean): void {
  const overlay = document.querySelector('.confirm-overlay');
  overlay?.remove();
  document.body.style.overflow = '';
  document.removeEventListener('keydown', _onKeydown);
  _activeOverlay = null;
  if (_activeTrigger && document.body.contains(_activeTrigger)) _activeTrigger.focus();
  _activeTrigger = null;
  const resolve = _activeResolve;
  _activeResolve = null;
  if (resolve) resolve(result);
}

function _esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
