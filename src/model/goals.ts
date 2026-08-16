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
 *
 * Returns a human-readable error string, or null if valid.
 */
export function validateMilestones(
  milestones: GoalMilestone[],
  goalTargetNetWorth: string,
): string | null {
  const target = parseFloat((goalTargetNetWorth || '').replace(/\./g, '').replace(',', '.'));
  const seen = new Set<number>();
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
  }
  return null;
}
