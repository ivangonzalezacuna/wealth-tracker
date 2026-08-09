export type ConflictResolutionChoice = 'backup' | 'keep-local' | 'keep-cloud' | 'cancel';

let _activeResolve: ((value: ConflictResolutionChoice) => void) | null = null;
let _activeTrigger: HTMLElement | null = null;
let _activeOverlay: HTMLElement | null = null;

export function conflictDialog(): Promise<ConflictResolutionChoice> {
  return new Promise<ConflictResolutionChoice>((resolve) => {
    dismiss('cancel');
    _activeResolve = resolve;
    _activeTrigger = document.activeElement as HTMLElement | null;

    const overlay = document.createElement('div');
    overlay.className = 'conflict-overlay';
    overlay.innerHTML = `
      <div class="conflict-card" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title">
        <div class="conflict-title" id="conflict-title">Sync conflict</div>
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
    document.body.style.overflow = 'hidden';
    _activeOverlay = overlay;

    const backupBtn = overlay.querySelector('.js-conflict-backup') as HTMLElement;
    const cancelBtn = overlay.querySelector('.js-conflict-cancel') as HTMLElement;
    const keepLocalBtn = overlay.querySelector('.js-conflict-keep-local') as HTMLElement;
    const keepCloudBtn = overlay.querySelector('.js-conflict-keep-cloud') as HTMLElement;

    backupBtn.addEventListener('click', () => dismiss('backup'));
    cancelBtn.addEventListener('click', () => dismiss('cancel'));
    keepLocalBtn.addEventListener('click', () => dismiss('keep-local'));
    keepCloudBtn.addEventListener('click', () => dismiss('keep-cloud'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dismiss('cancel');
    });
    document.addEventListener('keydown', onKeydown);

    backupBtn.focus();
  });
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    dismiss('cancel');
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

function dismiss(result: ConflictResolutionChoice): void {
  const overlay = document.querySelector('.conflict-overlay');
  overlay?.remove();
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onKeydown);
  _activeOverlay = null;
  if (_activeTrigger && document.body.contains(_activeTrigger)) _activeTrigger.focus();
  _activeTrigger = null;
  const resolve = _activeResolve;
  _activeResolve = null;
  if (resolve) resolve(result);
}
