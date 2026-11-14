/**
 * Mirror UI collapse preferences into the SQLite settings that follow Drive sync.
 *
 * Local IndexedDB preferences take priority. Synced settings restore preferences
 * on a fresh device; successful syncs back up the current state when changed.
 */

import { getSettings, setSetting } from '../store/config';
import { getCollapseSnapshot, replaceCollapseState, isCollapseStateLoaded } from './collapseState';
import type { CollapseState } from '../cache/db';

const SETTINGS_KEY = 'ui_collapse_state';

/**
 * Restore collapse state from synced settings if local preferences were empty.
 * Should be called after config is loaded (so getSettings() is available).
 * Only applies if the local collapse state is empty (fresh device / cleared cache).
 * Returns true when it restored a state (rendered cards need a repaint to show it).
 */
export function restoreCollapseFromSettings(): boolean {
  if (!isCollapseStateLoaded()) return false;
  const current = getCollapseSnapshot();
  // Only restore if local state is empty (fresh start)
  if (Object.keys(current).length > 0) return false;

  const settings = getSettings();
  const raw = settings[SETTINGS_KEY];
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw) as CollapseState;
    if (parsed && typeof parsed === 'object') {
      replaceCollapseState(parsed);
      return true;
    }
  } catch {
    // Malformed JSON - ignore, local state stays empty
  }
  return false;
}

/**
 * Back up changed preferences after a successful sync; failure is non-critical.
 */
export async function backupCollapseToSettings(): Promise<void> {
  try {
    const snapshot = getCollapseSnapshot();
    const json = JSON.stringify(snapshot);
    // Only write if the value actually changed
    const settings = getSettings();
    if (settings[SETTINGS_KEY] === json) return;
    await setSetting(SETTINGS_KEY, json);
  } catch {
    // Best-effort - don't block the sync flow
  }
}
