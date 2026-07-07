/** Promise-based confirmation dialog. Resolves true on confirm, false on cancel/dismiss. Single instance. */

let _activeResolve: ((v: boolean) => void) | null = null;
let _activeTrigger: HTMLElement | null = null;

export interface ConfirmOptions {
  title: string;
  body?: string;
  /** Pre-built HTML body (not escaped). Use only with trusted content. Takes precedence over `body`. */
  bodyHtml?: string;
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
        ${opts.bodyHtml ? `<div class="confirm-body">${opts.bodyHtml}</div>` : opts.body ? `<div class="confirm-body">${_esc(opts.body)}</div>` : ''}
        <div class="confirm-actions">
          <button class="btn btn-sm btn-ghost js-confirm-cancel">${_esc(opts.cancelLabel || 'Cancel')}</button>
          <button class="btn btn-sm ${opts.danger ? 'btn-danger' : 'btn-primary'} js-confirm-ok">${_esc(opts.confirmLabel || 'Confirm')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

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
  if (e.key === 'Escape') _dismiss(false);
  if (e.key === 'Enter') {
    const overlay = document.querySelector('.confirm-overlay');
    if (overlay) _dismiss(true);
  }
}

function _dismiss(result: boolean): void {
  const overlay = document.querySelector('.confirm-overlay');
  overlay?.remove();
  document.body.style.overflow = '';
  document.removeEventListener('keydown', _onKeydown);
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
