/** Promise-based confirmation dialog. Resolves true on confirm, false on cancel/dismiss. Single instance. */

import { esc } from '../utils';
import { activateModalShell, createDialogController } from './modalShell';

const _dialog = createDialogController(false, {
  overlaySelector: '.confirm-overlay',
});

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // true => confirm button uses .btn-danger styling
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    _dialog.begin(resolve);

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
    _dialog.setOverlay(overlay);
    _dialog.setCleanup(
      activateModalShell({
      overlay,
      onDismiss: () => _dismiss(false),
      focusablesSelector: 'button:not([disabled])',
      }),
    );

    // Focus the cancel button by default (safer default for destructive actions)
    cancelBtn.focus();
  });
}

function _dismiss(result: boolean): void {
  _dialog.dismiss(result);
}
