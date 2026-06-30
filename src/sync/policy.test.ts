import { describe, it, expect } from 'vitest';
import { shouldAutoResync } from './policy';

const BASE = {
  signedIn: true,
  online: true,
  syncing: false,
  lastSyncAt: 0,
  now: 200_000,
  minIntervalMs: 120_000,
};

describe('shouldAutoResync', () => {
  it('returns true when all conditions are met and interval has elapsed', () => {
    expect(shouldAutoResync(BASE)).toBe(true);
  });

  it('returns false when not signed in', () => {
    expect(shouldAutoResync({ ...BASE, signedIn: false })).toBe(false);
  });

  it('returns false when offline', () => {
    expect(shouldAutoResync({ ...BASE, online: false })).toBe(false);
  });

  it('returns false when already syncing', () => {
    expect(shouldAutoResync({ ...BASE, syncing: true })).toBe(false);
  });

  it('returns false when interval has not elapsed', () => {
    expect(
      shouldAutoResync({ ...BASE, lastSyncAt: 100_000, now: 200_000, minIntervalMs: 120_000 }),
    ).toBe(false);
  });

  it('returns true when exactly at the interval boundary', () => {
    expect(
      shouldAutoResync({ ...BASE, lastSyncAt: 80_000, now: 200_000, minIntervalMs: 120_000 }),
    ).toBe(true);
  });

  it('returns true when well past the interval', () => {
    expect(
      shouldAutoResync({ ...BASE, lastSyncAt: 0, now: 1_000_000, minIntervalMs: 120_000 }),
    ).toBe(true);
  });

  it('returns false when multiple conditions fail simultaneously', () => {
    expect(shouldAutoResync({ ...BASE, signedIn: false, online: false, syncing: true })).toBe(
      false,
    );
  });
});
