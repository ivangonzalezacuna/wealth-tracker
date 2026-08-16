import type { GoalMilestone, NamedGoal } from '../types';

export function validateGoalLabels(goals: NamedGoal[]): string | null {
  const seen = new Set<string>();
  for (const goal of goals) {
    const normalized = normalizeGoalLabel(goal.label || '');
    if (!normalized) continue;
    if (seen.has(normalized)) {
      return `Duplicate goal name "${goal.label}". Goal names must be unique.`;
    }
    seen.add(normalized);
  }
  return null;
}

export function normalizeGoalLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Validates milestones for a single goal.
 *
 * Rules:
 * - Each milestone amount must be a positive finite number.
 * - Each milestone amount must be strictly less than the goal's target net worth.
 * - Milestone amounts must be unique (no two milestones at the same amount).
 * - If the goal has no target date, milestones may not have a date.
 * - If the goal has a target date, milestone dates must not exceed it.
 *
 * Returns a human-readable error string, or null if valid.
 */
export function validateMilestones(
  milestones: GoalMilestone[],
  goalTargetNetWorth: string,
  goalTargetDate?: string,
): string | null {
  const target = parseFloat((goalTargetNetWorth || '').replace(/\./g, '').replace(',', '.'));
  const seen = new Set<number>();
  const hasGoalDate = Boolean(goalTargetDate?.trim());
  for (let i = 0; i < milestones.length; i++) {
    const raw = (milestones[i].targetAmount || '').replace(/\./g, '').replace(',', '.');
    const amount = parseFloat(raw);
    if (!isFinite(amount) || amount <= 0) {
      return `Milestone ${i + 1}: amount must be a positive number.`;
    }
    if (isFinite(target) && target > 0 && amount >= target) {
      return `Milestone ${i + 1}: amount must be less than the goal target (${goalTargetNetWorth}).`;
    }
    if (seen.has(amount)) {
      return `Milestone ${i + 1}: duplicate amount. Each milestone must have a unique amount.`;
    }
    seen.add(amount);
    const msDate = milestones[i].targetDate?.trim();
    if (msDate && goalTargetDate !== undefined) {
      if (!hasGoalDate) {
        return `Milestone ${i + 1}: cannot have a date when the goal has no target date.`;
      }
      if (msDate > goalTargetDate!) {
        return `Milestone ${i + 1}: date must not be later than the goal target date (${goalTargetDate}).`;
      }
    }
  }
  return null;
}
