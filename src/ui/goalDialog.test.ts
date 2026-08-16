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
});
