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
import { validateMonthInput, wireMonthInputs } from './monthInput';
import { CLEAR_ICON, DELETE_ICON } from '../views/icons';

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

function _renderMilestoneRows(container: HTMLElement, goalDate?: string): void {
  const hasGoalDate = Boolean(goalDate?.trim());
  container.innerHTML = _milestones
    .map((m, i) => {
      const dateVal = hasGoalDate ? m.targetDate || '' : '';
      return `
    <div class="goal-milestone-row" data-ms-idx="${i}" data-ms-stored-date="${esc(m.targetDate || '')}">
      <div class="ms-header">
        <span class="ms-title">Milestone ${i + 1}</span>
        <button type="button" class="btn btn-sm btn-ghost btn-icon js-ms-del" data-ms-idx="${i}"
          aria-label="Remove milestone ${i + 1}" title="Remove milestone">${DELETE_ICON}</button>
      </div>
      <div class="ms-body">
        <div class="ms-row">
          <div class="ms-field">
            <span class="ms-field-label">Amount (€)</span>
            <input class="form-input dialog-input ms-amount" type="text" inputmode="decimal"
              value="${esc(m.targetAmount)}" placeholder="e.g. 250 000"
              aria-label="Milestone ${i + 1} amount" aria-describedby="goald-ms-err">
          </div>
          <div class="ms-field ms-date-field">
            <span class="ms-field-label">Deadline <span class="ms-opt">(optional)</span></span>
            <div class="ms-date-wrap ${dateVal ? 'has-clear' : ''}" data-month-host>
              <span class="ms-date-control">
              <input id="goald-ms-date-${i}" class="form-input dialog-input ms-date" type="month" value="${esc(dateVal)}" data-month-input
                max="${esc(hasGoalDate ? (goalDate ?? '') : '')}"
                ${!hasGoalDate ? 'disabled title="Set a target date on the goal first"' : ''}
                aria-label="Milestone ${i + 1} deadline" aria-describedby="goald-ms-err">
              <button type="button" class="btn btn-sm btn-ghost btn-icon ms-date-clear-btn js-ms-date-clear"
                ${dateVal ? '' : 'hidden'} data-ms-idx="${i}" aria-label="Clear deadline for milestone ${i + 1}" title="Clear deadline">${CLEAR_ICON}</button>
              </span>
            </div>
          </div>
        </div>
        <div class="ms-row">
          <div class="ms-field ms-label-field">
            <span class="ms-field-label">Label <span class="ms-opt">(optional)</span></span>
            <input class="form-input dialog-input ms-label" type="text"
              value="${esc(m.label || '')}" placeholder="e.g. Halfway"
              aria-label="Milestone ${i + 1} label">
          </div>
        </div>
      </div>
    </div>`;
    })
    .join('');
  wireMonthInputs(container);
}

function _syncMilestonesFromDom(container: HTMLElement): void {
  _milestones = Array.from(container.querySelectorAll<HTMLElement>('.goal-milestone-row')).map(
    (row) => ({
      targetAmount: (row.querySelector<HTMLInputElement>('.ms-amount')?.value || '').trim(),
      label: (row.querySelector<HTMLInputElement>('.ms-label')?.value || '').trim(),
      targetDate: (row.querySelector<HTMLInputElement>('.ms-date')?.disabled
        ? row.dataset.msStoredDate
        : row.querySelector<HTMLInputElement>('.ms-date')?.value
      )?.trim(),
    }),
  );
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

    const existingDate = existing?.targetDate || '';

    overlay.innerHTML = `
      <div class="dialog-card">
        <div class="dialog-header">
          <div class="dialog-title" id="goal-dialog-title">${esc(title)}</div>
        </div>
        <div class="dialog-fields">
          <div class="dialog-row">
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label" for="goald-label">Goal label</label>
              <input id="goald-label" class="form-input dialog-input" type="text" value="${esc(existing?.label || '')}" placeholder="e.g. Financial independence" aria-describedby="goald-label-err">
              <span class="dialog-error dialog-error-compact" id="goald-label-err"></span>
            </div>
          </div>
          <div class="dialog-row goal-dialog-row-compact">
            <div class="dialog-field">
              <label class="dialog-label" for="goald-target">
                Target net worth (€)${infoTip('Supports plain numbers and German-formatted amounts such as 100.000,00.')}
              </label>
              <input id="goald-target" class="form-input dialog-input" type="text" inputmode="decimal" value="${esc(existing?.targetNetWorth || '')}" placeholder="e.g. 500000" aria-describedby="goald-target-err">
              <span class="dialog-error dialog-error-compact" id="goald-target-err"></span>
            </div>
            <div class="dialog-field goal-date-field">
              <label class="dialog-label" for="goald-date">
                Target date${infoTip('Optional. Leave empty to track progress and ETA without a deadline.')}
              </label>
              <div class="ms-date-wrap ${existingDate ? 'has-clear' : ''}" data-month-host>
                <span class="ms-date-control">
                <input id="goald-date" class="form-input dialog-input ms-date" type="month" value="${esc(existingDate)}"
                  data-month-input aria-label="Goal target date">
                <button type="button" class="btn btn-sm btn-ghost btn-icon ms-date-clear-btn js-goal-date-clear"
                  ${existingDate ? '' : 'hidden'} aria-label="Clear target date" title="Clear target date">${CLEAR_ICON}</button>
                </span>
              </div>
            </div>
          </div>
          <div class="dialog-row">
            <div class="dialog-field dialog-field-wide">
              <label class="dialog-label">
                Milestones${infoTip('Optional intermediate targets. Each amount must be less than the goal target. They appear as tick marks on the progress bar.')}
              </label>
              <span class="dialog-error dialog-error-compact" id="goald-ms-err" role="alert"></span>
              <div id="goald-ms-list"></div>
              <button type="button" class="btn btn-sm btn-outline js-ms-add" style="margin-top:4px">+ Add milestone</button>
            </div>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-sm btn-ghost js-goald-cancel">Cancel</button>
          <button class="btn btn-sm btn-primary js-goald-submit">${existing ? 'Update draft' : 'Add to draft'}</button>
        </div>
      </div>`;

    const msList = overlay.querySelector<HTMLElement>('#goald-ms-list')!;
    const dateInput = overlay.querySelector<HTMLInputElement>('#goald-date')!;
    const goalDateClearBtn = overlay.querySelector<HTMLButtonElement>('.js-goal-date-clear')!;
    const goalDateWrap = dateInput.closest('.ms-date-wrap') as HTMLElement;
    const getGoalDate = () => dateInput.value.trim();

    const updateGoalDateBtn = () => {
      const val = dateInput.value;
      goalDateClearBtn.hidden = !val;
      goalDateWrap.classList.toggle('has-clear', Boolean(val));
    };

    _renderMilestoneRows(msList, getGoalDate());

    overlay.addEventListener('click', (e) => {
      const t = e.target as Element;
      if (t.closest('.js-goal-date-clear')) {
        dateInput.value = '';
        validateMonthInput(dateInput);
        updateGoalDateBtn();
        _syncMilestonesFromDom(msList);
        _renderMilestoneRows(msList, getGoalDate());
        dateInput.focus();
        return;
      }
    });

    wireMonthInputs(overlay);
    dateInput.addEventListener('change', () => {
      updateGoalDateBtn();
      _syncMilestonesFromDom(msList);
      _renderMilestoneRows(msList, getGoalDate());
    });

    msList.addEventListener('click', (e) => {
      const t = e.target as Element;
      const clearBtn = t.closest('.js-ms-date-clear') as HTMLElement | null;
      if (clearBtn) {
        _syncMilestonesFromDom(msList);
        const idx = parseInt(clearBtn.dataset.msIdx ?? '0', 10);
        if (_milestones[idx]) _milestones[idx].targetDate = '';
        _renderMilestoneRows(msList, getGoalDate());
        msList.querySelector<HTMLInputElement>(`#goald-ms-date-${idx}`)?.focus();
        return;
      }
      const delBtn = t.closest('.js-ms-del') as HTMLElement | null;
      if (!delBtn) return;
      _syncMilestonesFromDom(msList);
      const index = parseInt(delBtn.dataset.msIdx!, 10);
      _milestones.splice(index, 1);
      _renderMilestoneRows(msList, getGoalDate());
      const amounts = msList.querySelectorAll<HTMLInputElement>('.ms-amount');
      (
        amounts[Math.min(index, amounts.length - 1)] ??
        overlay.querySelector<HTMLButtonElement>('.js-ms-add')
      )?.focus();
    });

    msList.addEventListener('change', (e) => {
      if ((e.target as Element).classList.contains('ms-date')) {
        const input = e.target as HTMLInputElement;
        const wrap = input.closest('.ms-date-wrap')!;
        wrap.classList.toggle('has-clear', Boolean(input.value));
        const clear = wrap.querySelector<HTMLButtonElement>('.js-ms-date-clear');
        if (clear) clear.hidden = !input.value;
        _syncMilestonesFromDom(msList);
      }
    });

    overlay.querySelector('.js-ms-add')?.addEventListener('click', () => {
      _syncMilestonesFromDom(msList);
      _milestones.push({ targetAmount: '', label: '', targetDate: '' });
      _renderMilestoneRows(msList, getGoalDate());
      msList.querySelectorAll<HTMLInputElement>('.ms-amount')[_milestones.length - 1]?.focus();
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
  if (msErr) {
    msErr.textContent = '';
    msErr.removeAttribute('aria-invalid');
  }
  msList
    .querySelectorAll('[aria-invalid]')
    .forEach((input) => input.removeAttribute('aria-invalid'));
  const datesValid = Array.from(
    overlay.querySelectorAll<HTMLInputElement>('input[data-month-input]'),
  )
    .map(validateMonthInput)
    .every(Boolean);

  const label = get('goald-label');
  const targetNetWorth = get('goald-target');
  const normalizedLabel = normalizeGoalLabel(label);
  if (
    normalizedLabel &&
    _activeExistingLabels.some((l) => normalizeGoalLabel(l) === normalizedLabel)
  ) {
    setErr('goald-label', 'This goal name is already defined in another goal.');
  }
  if (!targetNetWorth) {
    setErr('goald-target', 'Target net worth is required.');
  }

  _syncMilestonesFromDom(msList);
  const filledRows = Array.from(msList.querySelectorAll<HTMLElement>('.goal-milestone-row')).filter(
    (row) => row.querySelector<HTMLInputElement>('.ms-amount')?.value.trim(),
  );
  const targetDate = get('goald-date');
  const filledMilestones = _milestones
    .filter((m) => m.targetAmount.trim() !== '')
    .map((m) => (targetDate ? m : { ...m, targetDate: '' }));
  const msErrMsg = validateMilestones(filledMilestones, targetNetWorth, targetDate);
  if (datesValid && msErrMsg && msErr) {
    msErr.textContent = msErrMsg;
    const index = Number(/^Milestone (\d+):/.exec(msErrMsg)?.[1] ?? 1) - 1;
    filledRows[index]
      ?.querySelector<HTMLInputElement>('.ms-amount')
      ?.setAttribute('aria-invalid', 'true');
  }

  if (overlay.querySelector('[aria-invalid="true"]')) {
    focusFirstInvalid(overlay);
    return;
  }

  _dismiss({
    label,
    targetNetWorth,
    targetDate,
    milestones: filledMilestones.length > 0 ? filledMilestones : undefined,
  });
}

function _dismiss(result: NamedGoal | null): void {
  _dialog.dismiss(result);
}
