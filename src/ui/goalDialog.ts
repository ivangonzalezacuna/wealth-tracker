import { esc } from '../utils';
import type { GoalMilestone, NamedGoal } from '../types';
import { normalizeGoalLabel, validateMilestones } from '../model/goals';
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
let _milestones: GoalMilestone[] = [];

const _dialog = createDialogController<NamedGoal | null>(null, {
  overlaySelector: '.goal-dialog-overlay',
  reset: () => {
    _activeExistingLabels = [];
    _milestones = [];
  },
});

function _renderMilestoneRows(container: HTMLElement): void {
  container.innerHTML = _milestones
    .map(
      (m, i) => `
    <div class="goal-milestone-row" data-ms-idx="${i}" style="display:flex;gap:6px;align-items:flex-start;margin-bottom:6px">
      <input class="form-input dialog-input ms-amount" type="text" inputmode="decimal"
        value="${esc(m.targetAmount)}" placeholder="Amount (€)" aria-label="Milestone ${i + 1} amount"
        style="flex:1 1 90px;min-width:60px">
      <input class="form-input dialog-input ms-label" type="text"
        value="${esc(m.label || '')}" placeholder="Label (optional)" aria-label="Milestone ${i + 1} label"
        style="flex:2 1 120px;min-width:80px">
      <input class="form-input dialog-input ms-date" type="month"
        value="${esc(m.targetDate || '')}" aria-label="Milestone ${i + 1} date"
        style="flex:1 1 110px;min-width:90px">
      <button type="button" class="btn btn-sm btn-danger btn-icon js-ms-del" data-ms-idx="${i}"
        aria-label="Remove milestone ${i + 1}" title="Remove milestone"
        style="flex-shrink:0;align-self:center">&#x2715;</button>
    </div>`,
    )
    .join('');
}

function _syncMilestonesFromDom(container: HTMLElement): void {
  const rows = container.querySelectorAll<HTMLElement>('.goal-milestone-row');
  _milestones = Array.from(rows).map((row) => ({
    targetAmount: (row.querySelector<HTMLInputElement>('.ms-amount')?.value || '').trim(),
    label: (row.querySelector<HTMLInputElement>('.ms-label')?.value || '').trim(),
    targetDate: (row.querySelector<HTMLInputElement>('.ms-date')?.value || '').trim(),
  }));
}

export function goalDialog(opts: GoalDialogOptions = {}): Promise<NamedGoal | null> {
  return new Promise<NamedGoal | null>((resolve) => {
    _dialog.begin(resolve);
    _activeExistingLabels = opts.existingLabels ?? [];
    _milestones = (opts.existing?.milestones ?? []).map((m) => ({ ...m }));
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
          <div class="dialog-row">
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label">
                Milestones${infoTip('Optional intermediate targets. Each amount must be less than the goal target. They appear as tick marks on the progress bar.')}
              </label>
              <span class="dialog-error dialog-error-compact" id="goald-ms-err"></span>
              <div id="goald-ms-list"></div>
              <button type="button" class="btn btn-sm btn-outline js-ms-add" style="margin-top:4px">+ Add milestone</button>
            </div>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-sm btn-ghost js-goald-cancel">Cancel</button>
          <button class="btn btn-sm btn-primary js-goald-submit">${existing ? 'Save changes' : 'Add goal'}</button>
        </div>
      </div>`;

    const msList = overlay.querySelector<HTMLElement>('#goald-ms-list')!;
    _renderMilestoneRows(msList);

    msList.addEventListener('click', (e) => {
      const delBtn = (e.target as Element).closest('.js-ms-del') as HTMLElement | null;
      if (!delBtn) return;
      _syncMilestonesFromDom(msList);
      const idx = parseInt(delBtn.dataset.msIdx!);
      _milestones.splice(idx, 1);
      _renderMilestoneRows(msList);
    });

    overlay.querySelector('.js-ms-add')?.addEventListener('click', () => {
      _syncMilestonesFromDom(msList);
      _milestones.push({ targetAmount: '', label: '', targetDate: '' });
      _renderMilestoneRows(msList);
      const rows = msList.querySelectorAll<HTMLInputElement>('.ms-amount');
      rows[rows.length - 1]?.focus();
    });

    openDialogShell(_dialog, {
      overlay,
      onDismiss: () => _dismiss(null),
      onCancel: () => _dismiss(null),
      onSubmit: () => _submit(msList),
      cancelSelector: '.js-goald-cancel',
      submitSelector: '.js-goald-submit',
      focusablesSelector: DIALOG_INPUT_FOCUSABLES,
      initialFocusSelector: '#goald-label',
    });
    attachInfoTips(overlay);
  });
}

function _submit(msList: HTMLElement): void {
  const overlay = _dialog.overlay();
  if (!overlay) return;
  const { get, setErr } = makeDialogHelpers(overlay);

  setErr('goald-label', '');
  setErr('goald-target', '');
  const msErr = overlay.querySelector<HTMLElement>('#goald-ms-err');
  if (msErr) msErr.textContent = '';

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

  // Sync and validate milestones (skip empty rows)
  _syncMilestonesFromDom(msList);
  const filledMilestones = _milestones.filter((m) => m.targetAmount.trim() !== '');
  const msErrMsg = validateMilestones(filledMilestones, targetNetWorth);
  if (msErrMsg && msErr) {
    msErr.textContent = msErrMsg;
    // Mark as invalid so focusFirstInvalid picks it up
    msErr.setAttribute('aria-invalid', 'true');
  }

  if (overlay.querySelector('[aria-invalid="true"]')) {
    focusFirstInvalid(overlay);
    return;
  }

  const draft: NamedGoal = {
    label,
    targetNetWorth,
    targetDate: get('goald-date'),
    milestones: filledMilestones.length > 0 ? filledMilestones : undefined,
  };
  _dismiss(draft);
}

function _dismiss(result: NamedGoal | null): void {
  _dialog.dismiss(result);
}
