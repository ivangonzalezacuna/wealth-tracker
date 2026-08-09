export type ConflictResolutionChoice = 'backup' | 'keep-local' | 'keep-cloud' | 'cancel';

import { activateModalShell, restoreFocus } from './modalShell';

let _activeResolve: ((value: ConflictResolutionChoice) => void) | null = null;
let _activeTrigger: HTMLElement | null = null;
let _activeCleanup: (() => void) | null = null;

export function conflictDialog(): Promise<ConflictResolutionChoice> {
  return new Promise<ConflictResolutionChoice>((resolve) => {
    dismiss('cancel');
    _activeResolve = resolve;
    _activeTrigger = document.activeElement as HTMLElement | null;

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

    document.body.appendChild(overlay);

    const backupBtn = overlay.querySelector('.js-conflict-backup') as HTMLElement;
    const keepLocalBtn = overlay.querySelector('.js-conflict-keep-local') as HTMLElement;
    const keepCloudBtn = overlay.querySelector('.js-conflict-keep-cloud') as HTMLElement;

    backupBtn.addEventListener('click', () => dismiss('backup'));
    (overlay.querySelector('.js-conflict-cancel') as HTMLElement).addEventListener('click', () =>
      dismiss('cancel'),
    );
    keepLocalBtn.addEventListener('click', () => dismiss('keep-local'));
    keepCloudBtn.addEventListener('click', () => dismiss('keep-cloud'));
    _activeCleanup = activateModalShell({
      overlay,
      onDismiss: () => dismiss('cancel'),
      focusablesSelector: 'button:not([disabled])',
    });

    backupBtn.focus();
  });
}

function dismiss(result: ConflictResolutionChoice): void {
  const overlay = document.querySelector('.conflict-overlay');
  overlay?.remove();
  _activeCleanup?.();
  _activeCleanup = null;
  restoreFocus(_activeTrigger);
  _activeTrigger = null;
  const resolve = _activeResolve;
  _activeResolve = null;
  if (resolve) resolve(result);
}
