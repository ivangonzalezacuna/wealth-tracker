export type ConflictResolutionChoice = 'backup' | 'keep-local' | 'keep-cloud' | 'cancel';

import { createDialogController, DIALOG_BUTTON_FOCUSABLES, openDialogShell } from './modalShell';

const _dialog = createDialogController<ConflictResolutionChoice>('cancel', {
  overlaySelector: '.conflict-overlay',
});

export function conflictDialog(): Promise<ConflictResolutionChoice> {
  return new Promise<ConflictResolutionChoice>((resolve) => {
    _dialog.begin(resolve);

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay conflict-overlay';
    overlay.innerHTML = `
      <div class="dialog-card conflict-card" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title">
        <div class="dialog-title conflict-title" id="conflict-title">Sync conflict</div>
        <div class="conflict-body">Drive changed elsewhere and this device also has local changes.</div>
        <div class="conflict-note">Sync is paused to avoid silently discarding data. Export a backup first, then choose which copy to keep.</div>
        <div class="conflict-actions">
          <button class="btn btn-sm btn-primary js-conflict-backup">Export backup first</button>
          <button class="btn btn-sm btn-ghost js-conflict-cancel">Cancel</button>
        </div>
        <div class="conflict-actions conflict-actions-destructive">
          <button class="btn btn-sm btn-danger js-conflict-keep-local">Keep local and overwrite Drive</button>
          <button class="btn btn-sm btn-danger js-conflict-keep-cloud">Keep cloud and replace local</button>
        </div>
      </div>`;

    (overlay.querySelector('.js-conflict-backup') as HTMLElement).addEventListener('click', () =>
      dismiss('backup'),
    );
    (overlay.querySelector('.js-conflict-keep-local') as HTMLElement).addEventListener(
      'click',
      () => dismiss('keep-local'),
    );
    (overlay.querySelector('.js-conflict-keep-cloud') as HTMLElement).addEventListener(
      'click',
      () => dismiss('keep-cloud'),
    );
    openDialogShell(_dialog, {
      overlay,
      onDismiss: () => dismiss('cancel'),
      onCancel: () => dismiss('cancel'),
      cancelSelector: '.js-conflict-cancel',
      focusablesSelector: DIALOG_BUTTON_FOCUSABLES,
      initialFocusSelector: '.js-conflict-backup',
    });
  });
}

function dismiss(result: ConflictResolutionChoice): void {
  _dialog.dismiss(result);
}
