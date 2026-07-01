/**
 * Sheet-backed mirror for UI collapse state.
 *
 * Low-frequency backup: writes collapse state into the Settings sheet
 * as a single `ui_collapse_state` key with JSON value.
 * Used to restore preferences when IndexedDB cache is cleared or on a new device.
 *
 * Read: called once after config is loaded (syncInBackground / loadAllData).
 * Write: called opportunistically after a successful sync completes.
 */

import { getSettings, setSetting } from '../store/config';
import { getCollapseSnapshot, replaceCollapseState, isCollapseStateLoaded } from './collapseState';
import type { CollapseState } from '../cache/db';

const SETTINGS_KEY = 'ui_collapse_state';

/**
 * Restore collapse state from the Sheet-backed settings if IDB was empty.
 * Should be called after config is loaded (so getSettings() is available).
 * Only applies if the local collapse state is empty (fresh device / cleared cache).
 */
export function restoreCollapseFromSheet(): void {
  if (!isCollapseStateLoaded()) return;
  const current = getCollapseSnapshot();
  // Only restore if local state is empty (fresh start)
  if (Object.keys(current).length > 0) return;

  const settings = getSettings();
  const raw = settings[SETTINGS_KEY];
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw) as CollapseState;
    if (parsed && typeof parsed === 'object') {
      replaceCollapseState(parsed);
    }
  } catch {
    // Malformed JSON - ignore, local state stays empty
  }
}

/**
 * Persist current collapse state to the Sheet (opportunistic, fire-and-forget).
 * Should be called after a successful sync completes.
 */
export async function backupCollapseToSheet(): Promise<void> {
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
