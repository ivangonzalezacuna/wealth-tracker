/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showSigninOverlay, hideSigninOverlay } from './signinOverlay';

describe('signinOverlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    hideSigninOverlay();
  });

  it('showSigninOverlay appends exactly one #signin-overlay.confirm-overlay to body', () => {
    showSigninOverlay(() => {});
    const overlays = document.querySelectorAll('#signin-overlay.confirm-overlay');
    expect(overlays.length).toBe(1);
  });

  it('hideSigninOverlay removes the overlay and does not call the cancel callback', () => {
    const cb = vi.fn();
    showSigninOverlay(cb);
    hideSigninOverlay();
    expect(document.querySelector('#signin-overlay')).toBeNull();
    expect(cb).not.toHaveBeenCalled();
  });

  it('clicking .js-signin-cancel removes overlay and calls cancel callback once', () => {
    const cb = vi.fn();
    showSigninOverlay(cb);
    const cancelBtn = document.querySelector('.js-signin-cancel') as HTMLElement;
    cancelBtn.click();
    expect(document.querySelector('#signin-overlay')).toBeNull();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('pressing Escape removes overlay and calls cancel callback once', () => {
    const cb = vi.fn();
    showSigninOverlay(cb);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('#signin-overlay')).toBeNull();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop removes overlay and calls cancel callback', () => {
    const cb = vi.fn();
    showSigninOverlay(cb);
    const overlay = document.querySelector('#signin-overlay') as HTMLElement;
    // Simulate click on the overlay itself (not the card)
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('#signin-overlay')).toBeNull();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('calling showSigninOverlay a second time replaces without calling first cancel callback', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    showSigninOverlay(cb1);
    showSigninOverlay(cb2);
    // First callback was not invoked (silent replace)
    expect(cb1).not.toHaveBeenCalled();
    // Only one overlay exists
    expect(document.querySelectorAll('#signin-overlay').length).toBe(1);
    // Second overlay is functional
    const cancelBtn = document.querySelector('.js-signin-cancel') as HTMLElement;
    cancelBtn.click();
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});
