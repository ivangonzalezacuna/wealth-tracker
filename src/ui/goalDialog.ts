import { esc } from '../utils';
import type { NamedGoal } from '../types';
import { activateModalShell, restoreFocus } from './modalShell';
import { infoTip, attachInfoTips } from './infoTip';

export interface GoalDialogOptions {
  existing?: NamedGoal;
  existingLabels?: string[];
}

let _activeResolve: ((v: NamedGoal | null) => void) | null = null;
let _activeTrigger: HTMLElement | null = null;
let _activeOverlay: HTMLElement | null = null;
let _activeCleanup: (() => void) | null = null;
let _activeExistingLabels: string[] = [];

export function goalDialog(opts: GoalDialogOptions = {}): Promise<NamedGoal | null> {
  return new Promise<NamedGoal | null>((resolve) => {
    _dismiss(null);
    _activeResolve = resolve;
    _activeTrigger = document.activeElement as HTMLElement | null;
    _activeExistingLabels = opts.existingLabels ?? [];
    const existing = opts.existing;
    const title = existing ? 'Edit goal' : 'Add goal';

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay goal-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'goal-dialog-title');

    overlay.innerHTML = `
      <div class="dialog-card goal-dialog-card">
        <div class="dialog-header">
          <div class="dialog-title" id="goal-dialog-title">${esc(title)}</div>
        </div>
        <div class="dialog-fields">
          <div class="dialog-row">
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" for="goald-label">Goal label</label>
              <input id="goald-label" class="form-input dialog-input" type="text" value="${esc(existing?.label || '')}" placeholder="e.g. Financial independence">
              <span class="dialog-error" id="goald-label-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field">
              <label class="dialog-label" for="goald-target">
                Target net worth (€)${infoTip('Supports plain numbers and German-formatted amounts such as 100.000,00.')}
              </label>
              <input id="goald-target" class="form-input dialog-input" type="text" inputmode="decimal" value="${esc(existing?.targetNetWorth || '')}" placeholder="e.g. 500000">
              <span class="dialog-error" id="goald-target-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field">
              <label class="dialog-label" for="goald-date">
                Target date${infoTip('Optional. Leave empty to track progress and ETA without a deadline.')}
              </label>
              <input id="goald-date" class="form-input dialog-input" type="month" value="${esc(existing?.targetDate || '')}">
            </div>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-sm btn-ghost js-goald-cancel">Cancel</button>
          <button class="btn btn-sm btn-primary js-goald-submit">${existing ? 'Save changes' : 'Add goal'}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    _activeOverlay = overlay;
    attachInfoTips(overlay);

    overlay.querySelector('.js-goald-submit')?.addEventListener('click', () => _submit());
    overlay.querySelector('.js-goald-cancel')?.addEventListener('click', () => _dismiss(null));
    _activeCleanup = activateModalShell({
      overlay,
      onDismiss: () => _dismiss(null),
      onSubmitEnter: _submit,
      submitWhenActive: (active) => !!active?.classList.contains('js-goald-submit'),
      focusablesSelector: 'input:not([disabled]), button:not([disabled])',
    });

    (overlay.querySelector('#goald-label') as HTMLElement | null)?.focus();
  });
}

function _submit(): void {
  if (!_activeOverlay) return;
  const get = (id: string): string =>
    (_activeOverlay!.querySelector('#' + id) as HTMLInputElement | null)?.value.trim() || '';
  const setErr = (id: string, msg: string): void => {
    const el = _activeOverlay!.querySelector('#' + id + '-err') as HTMLElement | null;
    if (!el) return;
    el.textContent = msg;
    const field = _activeOverlay!.querySelector('#' + id) as HTMLElement | null;
    if (msg) field?.setAttribute('aria-invalid', 'true');
    else field?.removeAttribute('aria-invalid');
  };

  setErr('goald-label', '');
  setErr('goald-target', '');

  const label = get('goald-label');
  const targetNetWorth = get('goald-target');
  const normalizedLabel = label.trim().replace(/\s+/g, ' ').toLowerCase();
  if (
    normalizedLabel &&
    _activeExistingLabels.some(
      (existingLabel) =>
        existingLabel.trim().replace(/\s+/g, ' ').toLowerCase() === normalizedLabel,
    )
  ) {
    setErr('goald-label', 'This goal name is already defined in another goal.');
  }
  if (!targetNetWorth) {
    setErr('goald-target', 'Target net worth is required.');
  }
  if (_activeOverlay.querySelector('[aria-invalid="true"]')) {
    const firstErr = _activeOverlay.querySelector('[aria-invalid="true"]') as HTMLElement | null;
    firstErr?.focus();
    return;
  }

  const draft: NamedGoal = {
    label,
    targetNetWorth,
    targetDate: get('goald-date'),
  };
  _dismiss(draft);
}

function _dismiss(result: NamedGoal | null): void {
  if (_activeOverlay) _activeOverlay.remove();
  _activeCleanup?.();
  _activeCleanup = null;
  const resolve = _activeResolve;
  _activeResolve = null;
  _activeOverlay = null;
  _activeExistingLabels = [];
  resolve?.(result);
  if (_activeTrigger) restoreFocus(_activeTrigger);
  _activeTrigger = null;
}
