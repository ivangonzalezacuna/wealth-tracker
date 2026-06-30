/** Pure predicate: should we auto-resync right now? */
export function shouldAutoResync(opts: {
  signedIn: boolean;
  online: boolean;
  syncing: boolean;
  lastSyncAt: number;
  now: number;
  minIntervalMs: number;
}): boolean {
  const { signedIn, online, syncing, lastSyncAt, now, minIntervalMs } = opts;
  return signedIn && online && !syncing && now - lastSyncAt >= minIntervalMs;
}
