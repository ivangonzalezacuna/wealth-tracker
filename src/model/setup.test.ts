import { describe, it, expect } from 'vitest';
import { getSetupState } from './setup';

describe('getSetupState', () => {
  it('returns "signin" when not signed in', () => {
    expect(getSetupState({ signedIn: false, accountCount: 0, snapshotCount: 0 })).toBe('signin');
    expect(getSetupState({ signedIn: false, accountCount: 3, snapshotCount: 5 })).toBe('signin');
  });

  it('returns "accounts" when signed in but no accounts', () => {
    expect(getSetupState({ signedIn: true, accountCount: 0, snapshotCount: 0 })).toBe('accounts');
  });

  it('returns "first-update" when signed in with accounts but no snapshots', () => {
    expect(getSetupState({ signedIn: true, accountCount: 2, snapshotCount: 0 })).toBe(
      'first-update',
    );
  });

  it('returns "done" when signed in with accounts and at least one snapshot', () => {
    expect(getSetupState({ signedIn: true, accountCount: 2, snapshotCount: 1 })).toBe('done');
    expect(getSetupState({ signedIn: true, accountCount: 5, snapshotCount: 12 })).toBe('done');
  });

  it('edge: signed-in + 0 accounts + snapshots → still "accounts" (accounts gate precedes update)', () => {
    expect(getSetupState({ signedIn: true, accountCount: 0, snapshotCount: 3 })).toBe('accounts');
  });

  // cacheLoaded tests
  it('cached-but-unauthenticated with full data returns "done"', () => {
    expect(
      getSetupState({ signedIn: false, cacheLoaded: true, accountCount: 3, snapshotCount: 5 }),
    ).toBe('done');
  });

  it('cached-but-unauthenticated with no accounts still returns "accounts"', () => {
    expect(
      getSetupState({ signedIn: false, cacheLoaded: true, accountCount: 0, snapshotCount: 0 }),
    ).toBe('accounts');
  });

  it('neither signed in nor cached returns "signin" (unchanged)', () => {
    expect(
      getSetupState({ signedIn: false, cacheLoaded: false, accountCount: 3, snapshotCount: 5 }),
    ).toBe('signin');
  });

  it('omitting cacheLoaded preserves prior behavior (regression guard)', () => {
    expect(getSetupState({ signedIn: false, accountCount: 3, snapshotCount: 5 })).toBe('signin');
  });
});
