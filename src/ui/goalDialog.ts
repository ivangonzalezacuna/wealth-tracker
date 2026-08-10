import { esc } from '../utils';
import type { NamedGoal } from '../types';
import { normalizeGoalLabel } from '../model/goals';
import {
  createDialogController,
  DIALOG_INPUT_FOCUSABLES,
  focusFirstInvalid,
  makeDialogHelpers,
  openDialogShell,
} from './modalShell';
import { infoTip, attachInfoTips } from './infoTip';

export interface GoalDialogOptions {
  existing?: NamedGoal;
  existingLabels?: string[];
}

let _activeExistingLabels: string[] = [];
const _dialog = createDialogController<NamedGoal | null>(null, {
  overlaySelector: '.goal-dialog-overlay',
  reset: () => {
    _activeExistingLabels = [];
  },
});

export function goalDialog(opts: GoalDialogOptions = {}): Promise<NamedGoal | null> {
  return new Promise<NamedGoal | null>((resolve) => {
    _dialog.begin(resolve);
    _activeExistingLabels = opts.existingLabels ?? [];
    const existing = opts.existing;
    const title = existing ? 'Edit goal' : 'Add goal';

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay goal-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'goal-dialog-title');

    overlay.innerHTML = `
      <div class="dialog-card">
        <div class="dialog-header">
          <div class="dialog-title" id="goal-dialog-title">${esc(title)}</div>
        </div>
        <div class="dialog-fields">
          <div class="dialog-row">
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" for="goald-label">Goal label</label>
              <input id="goald-label" class="form-input dialog-input" type="text" value="${esc(existing?.label || '')}" placeholder="e.g. Financial independence">
              <span class="dialog-error dialog-error-compact" id="goald-label-err"></span>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field">
              <label class="dialog-label" for="goald-target">
                Target net worth (€)${infoTip('Supports plain numbers and German-formatted amounts such as 100.000,00.')}
              </label>
              <input id="goald-target" class="form-input dialog-input" type="text" inputmode="decimal" value="${esc(existing?.targetNetWorth || '')}" placeholder="e.g. 500000">
              <span class="dialog-error dialog-error-compact" id="goald-target-err"></span>
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

    openDialogShell(_dialog, {
      overlay,
      onDismiss: () => _dismiss(null),
      onCancel: () => _dismiss(null),
      onSubmit: _submit,
      cancelSelector: '.js-goald-cancel',
      submitSelector: '.js-goald-submit',
      focusablesSelector: DIALOG_INPUT_FOCUSABLES,
      initialFocusSelector: '#goald-label',
    });
    attachInfoTips(overlay);
  });
}

function _submit(): void {
  const overlay = _dialog.overlay();
  if (!overlay) return;
  const { get, setErr } = makeDialogHelpers(overlay);

  setErr('goald-label', '');
  setErr('goald-target', '');

  const label = get('goald-label');
  const targetNetWorth = get('goald-target');
  const normalizedLabel = normalizeGoalLabel(label);
  if (
    normalizedLabel &&
    _activeExistingLabels.some(
      (existingLabel) => normalizeGoalLabel(existingLabel) === normalizedLabel,
    )
  ) {
    setErr('goald-label', 'This goal name is already defined in another goal.');
  }
  if (!targetNetWorth) {
    setErr('goald-target', 'Target net worth is required.');
  }
  if (overlay.querySelector('[aria-invalid="true"]')) {
    focusFirstInvalid(overlay);
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
  _dialog.dismiss(result);
}
