/**
 * Setup state helper — determines which onboarding step the user is on.
 * Pure function, no side effects. Used by the setup banner to guide first-run.
 */

export type SetupStep = 'signin' | 'accounts' | 'first-update' | 'done';

export function getSetupState(opts: {
  signedIn: boolean;
  accountCount: number;
  snapshotCount: number;
}): SetupStep {
  if (!opts.signedIn) return 'signin';
  if (opts.accountCount === 0) return 'accounts';
  if (opts.snapshotCount === 0) return 'first-update';
  return 'done';
}
