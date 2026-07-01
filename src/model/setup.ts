/**
 * Setup state helper — determines which onboarding step the user is on.
 * Pure function, no side effects. Used by the setup banner to guide first-run.
 */

export type SetupStep = 'signin' | 'accounts' | 'first-update' | 'done';

export function getSetupState(opts: {
  signedIn: boolean;
  accountCount: number;
  snapshotCount: number;
  cacheLoaded?: boolean;
}): SetupStep {
  // Only force the "sign in" step when there is neither an active session
  // NOR usable cached data. A cached, unauthenticated (read-only, Phase 19)
  // boot with real accounts/snapshots already present is not a fresh
  // install — it should progress through the normal gates below rather
  // than perpetually nagging to sign in over data that's already visible.
  if (!opts.signedIn && !opts.cacheLoaded) return 'signin';
  if (opts.accountCount === 0) return 'accounts';
  if (opts.snapshotCount === 0) return 'first-update';
  return 'done';
}
