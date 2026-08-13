import { tradeRepublicProfile } from './trade_republic';
import type { ImportProfile } from '../../types';

/**
 * Registry of built-in import profiles.
 * To support a new bank, add a profile object here - no parser code change needed.
 */
export const builtInProfiles: ImportProfile[] = [tradeRepublicProfile];

/**
 * Returns a human-readable label for an import source ID.
 * Uses the built-in profile label if available; otherwise, title-cases the id.
 */
export function sourceLabel(id: string): string {
  const profile = builtInProfiles.find((p) => p.id === id);
  return profile?.label || id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
