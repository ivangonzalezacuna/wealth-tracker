/** Promise-based confirmation dialog. Resolves true on confirm, false on cancel/dismiss. Single instance. */

import { esc } from '../utils';
import { activateModalShell, restoreFocus } from './modalShell';

let _activeResolve: ((v: boolean) => void) | null = null;
let _activeTrigger: HTMLElement | null = null;
let _activeCleanup: (() => void) | null = null;

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
    overlay.className = 'dialog-overlay confirm-overlay';
    overlay.innerHTML = `
      <div class="dialog-card confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div class="dialog-title confirm-title" id="confirm-title">${esc(opts.title)}</div>
        ${opts.body ? `<div class="confirm-body">${esc(opts.body)}</div>` : ''}
        <div class="confirm-actions">
          <button class="btn btn-sm btn-ghost js-confirm-cancel">${esc(opts.cancelLabel || 'Cancel')}</button>
          <button class="btn btn-sm ${opts.danger ? 'btn-danger' : 'btn-primary'} js-confirm-ok">${esc(opts.confirmLabel || 'Confirm')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const okBtn = overlay.querySelector('.js-confirm-ok') as HTMLElement;
    const cancelBtn = overlay.querySelector('.js-confirm-cancel') as HTMLElement;
    okBtn.addEventListener('click', () => _dismiss(true));
    cancelBtn.addEventListener('click', () => _dismiss(false));
    _activeCleanup = activateModalShell({
      overlay,
      onDismiss: () => _dismiss(false),
      focusablesSelector: 'button:not([disabled])',
    });

    // Focus the cancel button by default (safer default for destructive actions)
    cancelBtn.focus();
  });
}

function _dismiss(result: boolean): void {
  const overlay = document.querySelector('.confirm-overlay');
  overlay?.remove();
  _activeCleanup?.();
  _activeCleanup = null;
  restoreFocus(_activeTrigger);
  _activeTrigger = null;
  const resolve = _activeResolve;
  _activeResolve = null;
  if (resolve) resolve(result);
}
