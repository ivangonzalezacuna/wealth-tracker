import { describe, it, expect, beforeEach } from 'vitest';
import { isBusy, setBusy } from './lock';

describe('sync/lock', () => {
  beforeEach(() => {
    setBusy(false);
  });

  it('isBusy() starts false', () => {
    expect(isBusy()).toBe(false);
  });

  it('setBusy(true) then isBusy() returns true', () => {
    setBusy(true);
    expect(isBusy()).toBe(true);
  });

  it('setBusy(false) resets it', () => {
    setBusy(true);
    setBusy(false);
    expect(isBusy()).toBe(false);
  });
});
