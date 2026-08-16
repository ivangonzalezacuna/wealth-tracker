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
import { CALENDAR_ICON } from '../views/icons';

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

function _fmtMonthLabel(ym: string): string {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const [year, month] = ym.split('-');
  return `${months[parseInt(month, 10) - 1]} ${year}`;
}

function _renderGoalDateField(dateLabel: string, existingDate: string): string {
  return `
    <div class="dialog-field goal-date-field">
      <label class="dialog-label">
        Target date${infoTip('Optional. Leave empty to track progress and ETA without a deadline.')}
      </label>
      <div class="ms-date-wrap">
        <button type="button" class="btn btn-sm btn-ghost ms-date-btn js-goal-date-btn"
          aria-label="${existingDate ? `Target date: ${esc(dateLabel)}` : 'Set target date'}">
          ${CALENDAR_ICON}<span id="goald-date-val" class="ms-date-val">${esc(dateLabel)}</span>
        </button>
        <button type="button" class="btn btn-sm btn-ghost btn-icon js-goal-date-clear"
          ${existingDate ? '' : 'hidden'}
          aria-label="Clear target date" title="Clear target date">&#x2715;</button>
        <input id="goald-date" class="ms-date" type="month" value="${esc(existingDate)}"
          aria-hidden="true" tabindex="-1" aria-label="Goal target date">
      </div>
    </div>`;
}

function _renderMilestoneRows(container: HTMLElement, goalDate?: string): void {
  const hasGoalDate = Boolean(goalDate?.trim());
  container.innerHTML = _milestones
    .map((m, i) => {
      const dateVal = hasGoalDate ? m.targetDate || '' : '';
      const dateLabel = dateVal ? _fmtMonthLabel(dateVal) : 'Set deadline';
      return `
    <div class="goal-milestone-row" data-ms-idx="${i}">
      <div class="ms-body">
        <div class="ms-row">
          <div class="ms-field">
            <span class="ms-field-label">
              <span class="ms-index">Milestone ${i + 1}</span>
              <span>Amount (€)</span>
            </span>
            <input class="form-input dialog-input ms-amount" type="text" inputmode="decimal"
              value="${esc(m.targetAmount)}" placeholder="e.g. 250 000"
              aria-label="Milestone ${i + 1} amount">
          </div>
          <div class="ms-field ms-date-field">
            <span class="ms-field-label">Deadline <span class="ms-opt">(optional)</span></span>
            <div class="ms-date-wrap">
              <button type="button" class="btn btn-sm btn-ghost ms-date-btn js-ms-date-btn"
                aria-label="${dateVal ? `Deadline: ${esc(dateLabel)}` : `Set deadline for milestone ${i + 1}`}"
                ${!hasGoalDate ? `disabled title="Set a target date on the goal first"` : ''}>
                ${CALENDAR_ICON}
                <span class="ms-date-val">${esc(dateLabel)}</span>
              </button>
              ${
                dateVal
                  ? `<button type="button" class="btn btn-sm btn-ghost btn-icon js-ms-date-clear"
                  data-ms-idx="${i}" aria-label="Clear deadline for milestone ${i + 1}" title="Clear deadline">&#x2715;</button>`
                  : ''
              }
              <input class="ms-date" type="month"
                value="${esc(dateVal)}"
                max="${esc(hasGoalDate ? (goalDate ?? '') : '')}"
                aria-hidden="true" tabindex="-1"
                ${!hasGoalDate ? 'disabled' : ''}
                aria-label="Milestone ${i + 1} deadline">
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
          <div class="ms-field ms-action-field">
            <span class="ms-field-label ms-action-label">Actions</span>
            <button type="button" class="btn btn-sm btn-ghost js-ms-del" data-ms-idx="${i}"
              aria-label="Remove milestone ${i + 1}" title="Remove milestone">Remove</button>
          </div>
        </div>
      </div>
    </div>`;
    })
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

    const _existingDate = existing?.targetDate || '';
    const _existingDateLabel = _existingDate ? _fmtMonthLabel(_existingDate) : 'Set date';

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
          <div class="dialog-row goal-dialog-row-compact">
            <div class="dialog-field">
              <label class="dialog-label" for="goald-target">
                Target net worth (€)${infoTip('Supports plain numbers and German-formatted amounts such as 100.000,00.')}
              </label>
              <input id="goald-target" class="form-input dialog-input" type="text" inputmode="decimal" value="${esc(existing?.targetNetWorth || '')}" placeholder="e.g. 500000">
              <span class="dialog-error dialog-error-compact" id="goald-target-err"></span>
            </div>
            ${_renderGoalDateField(_existingDateLabel, _existingDate)}
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
    const dateInput = overlay.querySelector<HTMLInputElement>('#goald-date')!;
    const dateValSpan = overlay.querySelector<HTMLElement>('#goald-date-val')!;
    const goalDateClearBtn = overlay.querySelector<HTMLButtonElement>('.js-goal-date-clear')!;
    const goalDateBtn = overlay.querySelector<HTMLButtonElement>('.js-goal-date-btn')!;

    const getGoalDate = () => dateInput?.value.trim() ?? '';

    const _updateGoalDateBtn = () => {
      const val = dateInput.value;
      const label = val ? _fmtMonthLabel(val) : 'Set date';
      dateValSpan.textContent = label;
      goalDateBtn.setAttribute(
        'aria-label',
        val ? `Target date: ${label}` : 'Set target date',
      );
      goalDateClearBtn.hidden = !val;
    };

    _renderMilestoneRows(msList, getGoalDate());

    overlay.addEventListener('click', (e) => {
      if ((e.target as Element).closest('.js-goal-date-btn')) {
        try {
          (dateInput as HTMLInputElement & { showPicker(): void }).showPicker();
        } catch {
          /* not supported in this browser */
        }
        return;
      }
      if ((e.target as Element).closest('.js-goal-date-clear')) {
        dateInput.value = '';
        _updateGoalDateBtn();
        _syncMilestonesFromDom(msList);
        _renderMilestoneRows(msList, getGoalDate());
        return;
      }
    });

    dateInput?.addEventListener('change', () => {
      _updateGoalDateBtn();
      _syncMilestonesFromDom(msList);
      _renderMilestoneRows(msList, getGoalDate());
    });

    msList.addEventListener('click', (e) => {
      const dateBtn = (e.target as Element).closest('.js-ms-date-btn') as HTMLElement | null;
      if (dateBtn) {
        const input = dateBtn.closest('.ms-date-wrap')?.querySelector<HTMLInputElement>('.ms-date');
        if (input && !input.disabled) {
          try {
            (input as HTMLInputElement & { showPicker(): void }).showPicker();
          } catch {
            /* not supported in this browser */
          }
        }
        return;
      }

      const clearBtn = (e.target as Element).closest('.js-ms-date-clear') as HTMLElement | null;
      if (clearBtn) {
        _syncMilestonesFromDom(msList);
        const idx = parseInt(clearBtn.dataset.msIdx ?? '0', 10);
        if (_milestones[idx]) _milestones[idx].targetDate = '';
        _renderMilestoneRows(msList, getGoalDate());
        return;
      }

      const delBtn = (e.target as Element).closest('.js-ms-del') as HTMLElement | null;
      if (!delBtn) return;
      _syncMilestonesFromDom(msList);
      const idx = parseInt(delBtn.dataset.msIdx!, 10);
      _milestones.splice(idx, 1);
      _renderMilestoneRows(msList, getGoalDate());
    });

    msList.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (!input.classList.contains('ms-date')) return;
      _syncMilestonesFromDom(msList);
      _renderMilestoneRows(msList, getGoalDate());
    });

    overlay.querySelector('.js-ms-add')?.addEventListener('click', () => {
      _syncMilestonesFromDom(msList);
      _milestones.push({ targetAmount: '', label: '', targetDate: '' });
      _renderMilestoneRows(msList, getGoalDate());
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
  const targetDate = get('goald-date');
  const msErrMsg = validateMilestones(filledMilestones, targetNetWorth, targetDate);
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
    targetDate,
    milestones: filledMilestones.length > 0 ? filledMilestones : undefined,
  };
  _dismiss(draft);
}

function _dismiss(result: NamedGoal | null): void {
  _dialog.dismiss(result);
}
