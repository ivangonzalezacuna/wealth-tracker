/**
 * Single shared write/sync busy flag, used across main.ts (background sync,
 * snapshot/import/backup writes) and settings.ts (per-card config writes).
 * Both call sites check and set the SAME flag, so a background auto-resync
 * can never race an in-flight Settings card save (and vice versa) - two
 * independent locks that don't know about each other was the bug this
 * closes (Phase 69).
 */
let _busy = false;

export function isBusy(): boolean {
  return _busy;
}

export function setBusy(v: boolean): void {
  _busy = v;
}
