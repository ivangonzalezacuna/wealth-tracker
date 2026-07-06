/**
 * Single shared write/sync busy flag, used across main.ts and settings.ts.
 * Both call sites check the SAME flag so a background sync can never race
 * an in-flight Settings card save (and vice versa).
 */
let _busy = false;

export function isBusy(): boolean {
  return _busy;
}

export function setBusy(v: boolean): void {
  _busy = v;
}
