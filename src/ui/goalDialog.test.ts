/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { goalDialog } from './goalDialog';
import type { NamedGoal } from '../types';

function getOverlay() {
  return document.querySelector('.goal-dialog-overlay') as HTMLElement | null;
}

function setField(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el) el.value = value;
}

function getSubmit() {
  return document.querySelector('.js-goald-submit') as HTMLButtonElement | null;
}

function addMilestone() {
  (document.querySelector('.js-ms-add') as HTMLButtonElement | null)?.click();
}

function getMilestoneRows() {
  return Array.from(document.querySelectorAll('.goal-milestone-row')) as HTMLElement[];
}

const EXISTING_GOAL: NamedGoal = {
  label: 'Financial independence',
  targetNetWorth: '500000',
  targetDate: '2035-01',
};

describe('goalDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    getOverlay()?.remove();
  });

  it('uses info tips instead of inline notes', () => {
    goalDialog();
    const infoTips = Array.from(document.querySelectorAll('.info-tip')) as HTMLElement[];
    expect(infoTips).toHaveLength(3);
    expect(infoTips.every((tip) => tip.dataset.tipBound === '1')).toBe(true);
    expect(document.querySelectorAll('.goal-dialog-overlay .note')).toHaveLength(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('uses shared dialog sizing and compact error slots', () => {
    goalDialog();

    expect(getOverlay()?.querySelector('.dialog-card')).not.toBeNull();
    expect(getOverlay()?.querySelector('.goal-dialog-card')).toBeNull();
    expect(getOverlay()?.querySelector('.goal-dialog-row-compact')).not.toBeNull();
    expect(
      document.getElementById('goald-label-err')?.classList.contains('dialog-error-compact'),
    ).toBe(true);
    expect(
      document.getElementById('goald-target-err')?.classList.contains('dialog-error-compact'),
    ).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('rejects duplicate goal names after trimming and lowercasing', async () => {
    const p = goalDialog({ existingLabels: ['Financial independence'] });
    setField('goald-label', '  financial independence  ');
    setField('goald-target', '500000');

    let settled = false;
    void p.then(() => {
      settled = true;
    });

    getSubmit()!.click();
    await Promise.resolve();

    expect(settled).toBe(false);
    expect((document.getElementById('goald-label-err') as HTMLElement).textContent).toContain(
      'already defined',
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
  });

  it('accepts the current goal name unchanged while editing', async () => {
    const p = goalDialog({
      existing: EXISTING_GOAL,
      existingLabels: ['House deposit'],
    });

    getSubmit()!.click();
    const draft = await p;

    expect(draft?.label).toBe('Financial independence');
  });

  it('renders milestone fields in two compact rows', () => {
    goalDialog({
      existing: { ...EXISTING_GOAL, milestones: [{ targetAmount: '250000', label: 'Halfway' }] },
    });

    const row = getMilestoneRows()[0];
    expect(row).toBeTruthy();
    expect(row.querySelector('.ms-header')).not.toBeNull();
    expect(row.querySelector('.ms-title')).not.toBeNull();
    expect(row.querySelectorAll('.ms-row')).toHaveLength(2);
    expect(row.querySelector('.ms-date-field')).not.toBeNull();
    expect(row.querySelector('.ms-action-field')).toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('disables milestone deadlines until the goal has a target date', () => {
    goalDialog();
    addMilestone();

    const row = getMilestoneRows()[0];
    const deadlineBtn = row.querySelector('.js-ms-date-btn') as HTMLButtonElement;
    const deadlineInput = row.querySelector('.ms-date') as HTMLInputElement;

    expect(deadlineBtn.disabled).toBe(true);
    expect(deadlineInput.disabled).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('only reserves clear-button space when a date exists', () => {
    goalDialog({
      existing: {
        ...EXISTING_GOAL,
        milestones: [
          { targetAmount: '100000', label: 'No date' },
          { targetAmount: '200000', label: 'With date', targetDate: '2034-06' },
        ],
      },
    });

    const goalDateWrap = document.querySelector('.js-goal-date-btn')?.closest('.ms-date-wrap');
    expect(goalDateWrap?.classList.contains('has-clear')).toBe(true);

    let rows = getMilestoneRows();
    expect(rows[0]?.querySelector('.ms-date-wrap')?.classList.contains('has-clear')).toBe(false);
    expect(rows[1]?.querySelector('.ms-date-wrap')?.classList.contains('has-clear')).toBe(true);

    const goalDate = document.getElementById('goald-date') as HTMLInputElement;
    goalDate.value = '';
    goalDate.dispatchEvent(new Event('change'));
    expect(goalDateWrap?.classList.contains('has-clear')).toBe(false);

    goalDate.value = '2035-01';
    goalDate.dispatchEvent(new Event('change'));
    expect(goalDateWrap?.classList.contains('has-clear')).toBe(true);

    rows = getMilestoneRows();
    expect(rows[0]?.querySelector('.ms-date-wrap')?.classList.contains('has-clear')).toBe(false);
    expect(rows[1]?.querySelector('.ms-date-wrap')?.classList.contains('has-clear')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('keeps milestone values when the goal date is changed and restored', () => {
    goalDialog({
      existing: {
        ...EXISTING_GOAL,
        milestones: [{ targetAmount: '250000', label: 'Halfway', targetDate: '2034-06' }],
      },
    });

    const goalDate = document.getElementById('goald-date') as HTMLInputElement;
    goalDate.value = '';
    goalDate.dispatchEvent(new Event('change'));

    let row = getMilestoneRows()[0];
    expect((row.querySelector('.ms-amount') as HTMLInputElement).value).toBe('250000');
    expect((row.querySelector('.ms-label') as HTMLInputElement).value).toBe('Halfway');
    expect((row.querySelector('.ms-date') as HTMLInputElement).value).toBe('');
    expect((row.querySelector('.js-ms-date-btn') as HTMLButtonElement).disabled).toBe(true);

    goalDate.value = '2035-01';
    goalDate.dispatchEvent(new Event('change'));

    row = getMilestoneRows()[0];
    expect((row.querySelector('.ms-amount') as HTMLInputElement).value).toBe('250000');
    expect((row.querySelector('.ms-label') as HTMLInputElement).value).toBe('Halfway');
    expect((row.querySelector('.ms-date') as HTMLInputElement).value).toBe('2034-06');
    expect((row.querySelector('.js-ms-date-btn') as HTMLButtonElement).disabled).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('ignores empty milestone rows on submit', async () => {
    const p = goalDialog();
    setField('goald-label', 'Emergency fund');
    setField('goald-target', '100000');
    addMilestone();

    getSubmit()!.click();
    const draft = await p;

    expect(draft?.milestones).toBeUndefined();
  });
});
