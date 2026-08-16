import { describe, expect, it } from 'vitest';
import type { GoalMilestone, NamedGoal } from '../types';
import { validateGoalLabels, validateMilestones } from './goals';

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

describe('validateMilestones', () => {
  const target = '500000';

  it('accepts valid milestones below the target', () => {
    const milestones: GoalMilestone[] = [
      { targetAmount: '100000', label: 'First 100k' },
      { targetAmount: '250000', label: 'Halfway' },
    ];
    expect(validateMilestones(milestones, target)).toBeNull();
  });

  it('accepts an empty milestones list', () => {
    expect(validateMilestones([], target)).toBeNull();
  });

  it('rejects a milestone with amount equal to the goal target', () => {
    const milestones: GoalMilestone[] = [{ targetAmount: '500000' }];
    expect(validateMilestones(milestones, target)).toContain('less than the goal target');
  });

  it('rejects a milestone with amount greater than the goal target', () => {
    const milestones: GoalMilestone[] = [{ targetAmount: '600000' }];
    expect(validateMilestones(milestones, target)).toContain('less than the goal target');
  });

  it('rejects a milestone with a non-positive amount', () => {
    const milestones: GoalMilestone[] = [{ targetAmount: '0' }];
    expect(validateMilestones(milestones, target)).toContain('positive number');
  });

  it('rejects a milestone with a non-numeric amount', () => {
    const milestones: GoalMilestone[] = [{ targetAmount: 'abc' }];
    expect(validateMilestones(milestones, target)).toContain('positive number');
  });

  it('rejects duplicate milestone amounts', () => {
    const milestones: GoalMilestone[] = [{ targetAmount: '100000' }, { targetAmount: '100000' }];
    expect(validateMilestones(milestones, target)).toContain('duplicate amount');
  });

  it('accepts German-formatted amounts', () => {
    const milestones: GoalMilestone[] = [{ targetAmount: '100.000,00' }];
    expect(validateMilestones(milestones, '500.000')).toBeNull();
  });

  it('identifies the correct milestone index in the error message', () => {
    const milestones: GoalMilestone[] = [{ targetAmount: '100000' }, { targetAmount: 'bad' }];
    const err = validateMilestones(milestones, target);
    expect(err).toContain('Milestone 2');
  });

  it('allows milestones when goal target is not yet set', () => {
    const milestones: GoalMilestone[] = [{ targetAmount: '100000' }];
    // Empty target means no upper-bound check is possible
    expect(validateMilestones(milestones, '')).toBeNull();
  });

  it('rejects a milestone with a date when the goal has no target date', () => {
    const milestones: GoalMilestone[] = [{ targetAmount: '100000', targetDate: '2040-01' }];
    const err = validateMilestones(milestones, '500000', '');
    expect(err).toContain('cannot have a date');
  });

  it('rejects a milestone with a date later than the goal target date', () => {
    const milestones: GoalMilestone[] = [{ targetAmount: '100000', targetDate: '2060-01' }];
    const err = validateMilestones(milestones, '500000', '2050-01');
    expect(err).toContain('not be later than the goal target date');
  });

  it('accepts a milestone with a date equal to the goal target date', () => {
    const milestones: GoalMilestone[] = [{ targetAmount: '100000', targetDate: '2050-01' }];
    expect(validateMilestones(milestones, '500000', '2050-01')).toBeNull();
  });

  it('accepts a milestone with a date before the goal target date', () => {
    const milestones: GoalMilestone[] = [{ targetAmount: '100000', targetDate: '2040-06' }];
    expect(validateMilestones(milestones, '500000', '2050-01')).toBeNull();
  });

  it('allows milestones without dates even when goal has a target date', () => {
    const milestones: GoalMilestone[] = [{ targetAmount: '100000' }];
    expect(validateMilestones(milestones, '500000', '2050-01')).toBeNull();
  });

  it('does not apply date checks when goalTargetDate is undefined', () => {
    const milestones: GoalMilestone[] = [{ targetAmount: '100000', targetDate: '2060-01' }];
    // No goalTargetDate passed at all → date rules are not enforced
    expect(validateMilestones(milestones, '500000')).toBeNull();
  });
});
