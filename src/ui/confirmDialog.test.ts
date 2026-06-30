/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { confirmDialog } from './confirmDialog';

describe('confirmDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.querySelector('.confirm-overlay')?.remove();
  });

  it('appends exactly one .confirm-overlay to document.body', () => {
    confirmDialog({ title: 'Test?' });
    const overlays = document.querySelectorAll('.confirm-overlay');
    expect(overlays.length).toBe(1);
  });

  it('clicking .js-confirm-ok resolves true and removes overlay', async () => {
    const p = confirmDialog({ title: 'Delete?' });
    const ok = document.querySelector('.js-confirm-ok') as HTMLElement;
    ok.click();
    expect(await p).toBe(true);
    expect(document.querySelector('.confirm-overlay')).toBeNull();
  });

  it('clicking .js-confirm-cancel resolves false and removes overlay', async () => {
    const p = confirmDialog({ title: 'Delete?' });
    const cancel = document.querySelector('.js-confirm-cancel') as HTMLElement;
    cancel.click();
    expect(await p).toBe(false);
    expect(document.querySelector('.confirm-overlay')).toBeNull();
  });

  it('clicking the overlay backdrop resolves false', async () => {
    const p = confirmDialog({ title: 'Delete?' });
    const overlay = document.querySelector('.confirm-overlay') as HTMLElement;
    // Simulate click on the overlay itself (not the card)
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await p).toBe(false);
  });

  it('pressing Escape resolves false', async () => {
    const p = confirmDialog({ title: 'Delete?' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await p).toBe(false);
    expect(document.querySelector('.confirm-overlay')).toBeNull();
  });

  it('pressing Enter while open resolves true', async () => {
    const p = confirmDialog({ title: 'Delete?' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(await p).toBe(true);
    expect(document.querySelector('.confirm-overlay')).toBeNull();
  });

  it('calling confirmDialog a second time resolves first call false', async () => {
    const p1 = confirmDialog({ title: 'First?' });
    const p2 = confirmDialog({ title: 'Second?' });
    // First should resolve false (dismissed by the second call)
    expect(await p1).toBe(false);
    // Only one overlay should exist
    expect(document.querySelectorAll('.confirm-overlay').length).toBe(1);
    // Confirm second is still open
    const ok = document.querySelector('.js-confirm-ok') as HTMLElement;
    ok.click();
    expect(await p2).toBe(true);
  });

  it('title and body text are escaped', () => {
    confirmDialog({ title: '<b>XSS</b>', body: '<script>alert(1)</script>' });
    const title = document.querySelector('.confirm-title')!;
    const body = document.querySelector('.confirm-body')!;
    expect(title.innerHTML).not.toContain('<b>');
    expect(title.innerHTML).toContain('&lt;b&gt;');
    expect(body.innerHTML).not.toContain('<script>');
    expect(body.innerHTML).toContain('&lt;script&gt;');
  });

  it('uses danger styling when danger option is true', () => {
    confirmDialog({ title: 'Delete?', danger: true, confirmLabel: 'Delete' });
    const ok = document.querySelector('.js-confirm-ok') as HTMLElement;
    expect(ok.classList.contains('btn-danger')).toBe(true);
    expect(ok.classList.contains('btn-primary')).toBe(false);
  });

  it('uses primary styling when danger option is false', () => {
    confirmDialog({ title: 'Confirm?', danger: false });
    const ok = document.querySelector('.js-confirm-ok') as HTMLElement;
    expect(ok.classList.contains('btn-primary')).toBe(true);
    expect(ok.classList.contains('btn-danger')).toBe(false);
  });

  it('focuses cancel button by default', () => {
    confirmDialog({ title: 'Delete?' });
    const cancel = document.querySelector('.js-confirm-cancel') as HTMLElement;
    expect(document.activeElement).toBe(cancel);
  });
});
