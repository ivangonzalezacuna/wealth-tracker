/** Determine which onboarding step the user is on. */

export type SetupStep = 'signin' | 'accounts' | 'first-update' | 'done';

export function getSetupState(opts: {
  signedIn: boolean;
  accountCount: number;
  snapshotCount: number;
  cacheLoaded?: boolean;
}): SetupStep {
  // Don't force sign-in when cached data already provides a usable read-only view.
  if (!opts.signedIn && !opts.cacheLoaded) return 'signin';
  if (opts.accountCount === 0) return 'accounts';
  if (opts.snapshotCount === 0) return 'first-update';
  return 'done';
}
