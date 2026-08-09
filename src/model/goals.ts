import type { NamedGoal } from '../types';

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
