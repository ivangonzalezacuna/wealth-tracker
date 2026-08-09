import { describe, expect, it } from 'vitest';
import type { NamedGoal } from '../types';
import { validateGoalLabels } from './goals';

describe('validateGoalLabels', () => {
  it('accepts unique goal labels', () => {
    const goals: NamedGoal[] = [
      { label: 'Financial independence', targetNetWorth: '500000', targetDate: '2035-01' },
      { label: 'House deposit', targetNetWorth: '100000', targetDate: '' },
    ];
    expect(validateGoalLabels(goals)).toBeNull();
  });

  it('rejects duplicate labels after trimming and lowercasing', () => {
    const goals: NamedGoal[] = [
      { label: 'Financial independence', targetNetWorth: '500000', targetDate: '2035-01' },
      { label: '  financial independence  ', targetNetWorth: '600000', targetDate: '' },
    ];
    expect(validateGoalLabels(goals)).toContain('Duplicate goal name');
  });

  it('ignores blank labels', () => {
    const goals: NamedGoal[] = [
      { label: '', targetNetWorth: '500000', targetDate: '' },
      { label: '   ', targetNetWorth: '600000', targetDate: '' },
    ];
    expect(validateGoalLabels(goals)).toBeNull();
  });
});
