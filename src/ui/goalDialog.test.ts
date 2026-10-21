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
    const deadlineInput = row.querySelector('.ms-date') as HTMLInputElement;

    expect(deadlineInput.disabled).toBe(true);
    expect(deadlineInput.hasAttribute('aria-hidden')).toBe(false);
    expect(deadlineInput.tabIndex).toBe(0);

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

    const goalDateWrap = document.querySelector('#goald-date')?.closest('.ms-date-wrap');
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
    expect((row.querySelector('.ms-date') as HTMLInputElement).disabled).toBe(true);

    goalDate.value = '2035-01';
    goalDate.dispatchEvent(new Event('change'));

    row = getMilestoneRows()[0];
    expect((row.querySelector('.ms-amount') as HTMLInputElement).value).toBe('250000');
    expect((row.querySelector('.ms-label') as HTMLInputElement).value).toBe('Halfway');
    expect((row.querySelector('.ms-date') as HTMLInputElement).value).toBe('2034-06');
    expect((row.querySelector('.ms-date') as HTMLInputElement).disabled).toBe(false);

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

  it('recovers from a milestone amount error without reopening the dialog', async () => {
    const pending = goalDialog({
      existing: {
        ...EXISTING_GOAL,
        targetNetWorth: '100000',
        milestones: [{ targetAmount: '' }, { targetAmount: '120000' }],
      },
    });
    const amount = getMilestoneRows()[1].querySelector<HTMLInputElement>('.ms-amount')!;
    getSubmit()!.click();
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(amount);
    expect(document.getElementById('goald-ms-err')?.textContent).toContain('less than');
    amount.value = '25000';
    getSubmit()!.click();
    expect((await pending)?.milestones).toEqual([
      { targetAmount: '25000', label: '', targetDate: '' },
    ]);
    expect(getOverlay()).toBeNull();
  });

  it('rejects a late milestone date and accepts its correction', async () => {
    const pending = goalDialog({
      existing: {
        ...EXISTING_GOAL,
        milestones: [{ targetAmount: '25000', targetDate: '2036-01' }],
      },
    });
    const date = getMilestoneRows()[0].querySelector<HTMLInputElement>('.ms-date')!;
    getSubmit()!.click();
    expect(date.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(date);
    expect(date.validationMessage).toContain('2035-01');
    date.value = '2034-06';
    date.dispatchEvent(new Event('input'));
    expect(date.hasAttribute('aria-invalid')).toBe(false);
    getSubmit()!.click();
    expect((await pending)?.milestones?.[0].targetDate).toBe('2034-06');
  });

  it('clears dates accessibly and omits disabled deadlines from the submitted draft', async () => {
    const pending = goalDialog({
      existing: {
        ...EXISTING_GOAL,
        milestones: [{ targetAmount: '25000', targetDate: '2034-06' }],
      },
    });
    document.querySelector<HTMLButtonElement>('.js-ms-date-clear')!.click();
    let date = getMilestoneRows()[0].querySelector<HTMLInputElement>('.ms-date')!;
    expect(date.value).toBe('');
    expect(document.activeElement).toBe(date);
    date.value = '2034-06';
    date.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('.js-goal-date-clear')!.click();
    date = getMilestoneRows()[0].querySelector<HTMLInputElement>('.ms-date')!;
    expect(date.disabled).toBe(true);
    expect(document.activeElement?.id).toBe('goald-date');
    getSubmit()!.click();
    const draft = await pending;
    expect(draft?.targetDate).toBe('');
    expect(draft?.milestones?.[0].targetDate).toBe('');
  });
});
