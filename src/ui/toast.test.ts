/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from './toast';

const toasts = () => Array.from(document.querySelectorAll<HTMLElement>('.toast-host .toast'));

describe('toast notifications', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('renders safe, dismissible notifications with source and live announcements', () => {
    notify('<b>Saved</b>', { variant: 'success', source: 'accts-msg' });
    notify('Failed', { variant: 'error' });
    const [success, error] = toasts();
    expect(success.dataset.source).toBe('accts-msg');
    expect(success.querySelector('.toast-text')?.textContent).toBe('<b>Saved</b>');
    expect(success.querySelector('b')).toBeNull();
    expect(success.getAttribute('aria-live')).toBe('polite');
    expect(error.getAttribute('aria-live')).toBe('assertive');
    const close = success.querySelector<HTMLButtonElement>('.toast-close')!;
    expect(close.getAttribute('aria-label')).toBe('Dismiss notification');
    close.click();
    expect(toasts()).toEqual([error]);
  });

  it('auto-dismisses successes after five seconds and errors after eight', () => {
    notify('Saved', { variant: 'success' });
    notify('Failed', { variant: 'error' });
    vi.advanceTimersByTime(5000);
    expect(toasts().map((toast) => toast.textContent)).toEqual(['Failed✕']);
    vi.advanceTimersByTime(3000);
    expect(toasts()).toHaveLength(0);
  });
});
