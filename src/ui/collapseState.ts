/** Persists UI collapse state to IndexedDB across sessions. Debounced writes. */

import { getCollapseState, setCollapseState } from '../cache/db';
import type { CollapseState } from '../cache/db';

// ── In-memory mirror (authoritative after boot) ──────────────────

let _state: CollapseState = {};
let _loaded = false;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 300;

/**
 * Load persisted collapse state from IndexedDB into memory.
 * Call once at app boot (best-effort - gracefully degrades).
 */
export async function loadCollapseState(): Promise<void> {
  try {
    const stored = await getCollapseState();
    if (stored) _state = stored;
  } catch {
    /* degrade: start with empty state */
  }
  _loaded = true;
}

/** Whether the collapse state has been loaded from IDB. */
export function isCollapseStateLoaded(): boolean {
  return _loaded;
}

/** Check if a given key is currently collapsed. */
export function isCollapsed(key: string): boolean {
  return !!_state[key];
}

/**
 * Set collapse state for a key and persist (debounced).
 * @param key Unique identifier for the collapsible element
 * @param collapsed true = collapsed, false = expanded (removes from store)
 */
export function setCollapsed(key: string, collapsed: boolean): void {
  if (collapsed) {
    _state[key] = true;
  } else {
    delete _state[key];
  }
  _schedulePersist();
}

/** Toggle and persist. Returns the new collapsed state. */
export function toggleCollapsed(key: string): boolean {
  const next = !_state[key];
  setCollapsed(key, next);
  return next;
}

/** Get a snapshot of the full state (for Sheet backup). */
export function getCollapseSnapshot(): CollapseState {
  return { ..._state };
}

/** Replace the full state (e.g. when restoring from Sheet). */
export function replaceCollapseState(state: CollapseState): void {
  _state = { ...state };
  _schedulePersist();
}

// ── Debounced IDB persist ────────────────────────────────────────

function _schedulePersist(): void {
  if (_debounceTimer !== null) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    setCollapseState(_state);
  }, DEBOUNCE_MS);
}
