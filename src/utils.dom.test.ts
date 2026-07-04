/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { showMsg, reinjectPendingMsg, withButtonGuard } from './utils';

describe('showMsg', () => {
  beforeEach(() => {
    document.body.innerHTML = '<span id="test-msg"></span>';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes text and color to the target element', () => {
    showMsg('test-msg', 'Hello', true);
    const el = document.getElementById('test-msg')!;
    expect(el.textContent).toBe('Hello');
    expect(el.style.color).toBe('rgb(15, 110, 86)'); // #0F6E56
  });

  it('uses red color for errors (ok=false)', () => {
    showMsg('test-msg', 'Error!', false);
    const el = document.getElementById('test-msg')!;
    expect(el.textContent).toBe('Error!');
    expect(el.style.color).toBe('rgb(163, 45, 45)'); // #A32D2D
  });

  it('auto-clears success messages after 3500ms', () => {
    showMsg('test-msg', 'Saved', true);
    const el = document.getElementById('test-msg')!;
    expect(el.textContent).toBe('Saved');
    vi.advanceTimersByTime(3499);
    expect(el.textContent).toBe('Saved');
    vi.advanceTimersByTime(2);
    expect(el.textContent).toBe('');
  });

  it('does not auto-clear error messages', () => {
    showMsg('test-msg', 'Failed', false);
    const el = document.getElementById('test-msg')!;
    vi.advanceTimersByTime(10000);
    expect(el.textContent).toBe('Failed');
  });
});

describe('reinjectPendingMsg', () => {
  beforeEach(() => {
    document.body.innerHTML = '<span id="test-msg"></span>';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('restores text/color onto a freshly-recreated element with the same id', () => {
    showMsg('test-msg', 'Saved', true);
    // Simulate a full DOM rebuild: destroy and recreate the element
    document.body.innerHTML = '<span id="test-msg"></span>';
    const el = document.getElementById('test-msg')!;
    expect(el.textContent).toBe(''); // freshly created, empty
    reinjectPendingMsg();
    expect(el.textContent).toBe('Saved');
    expect(el.style.color).toBe('rgb(15, 110, 86)');
  });

  it('no-ops once the 5s window has elapsed', () => {
    showMsg('test-msg', 'Done', true);
    vi.advanceTimersByTime(5001);
    // Rebuild DOM
    document.body.innerHTML = '<span id="test-msg"></span>';
    reinjectPendingMsg();
    const el = document.getElementById('test-msg')!;
    expect(el.textContent).toBe('');
  });

  it('no-ops when there is no pending message', () => {
    reinjectPendingMsg();
    const el = document.getElementById('test-msg')!;
    expect(el.textContent).toBe('');
  });
});

describe('withButtonGuard', () => {
  let btn: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = '<button id="btn">Save</button>';
    btn = document.getElementById('btn') as HTMLButtonElement;
  });

  it('disables the button and swaps its label immediately', async () => {
    let captured = { disabled: false, text: '' };
    const action = () =>
      new Promise<string>((resolve) => {
        captured = { disabled: btn.disabled, text: btn.textContent || '' };
        resolve('ok');
      });
    await withButtonGuard(btn, action, { busyText: 'Saving...' });
    expect(captured.disabled).toBe(true);
    expect(captured.text).toBe('Saving...');
  });

  it('restores both disabled and label on success', async () => {
    await withButtonGuard(btn, () => Promise.resolve('ok'), { busyText: 'Saving...' });
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Save');
  });

  it('restores both and re-throws on rejection', async () => {
    const err = new Error('fail');
    await expect(
      withButtonGuard(btn, () => Promise.reject(err), { busyText: 'Saving...' }),
    ).rejects.toThrow('fail');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Save');
  });

  it('keepDisabledOnSuccess leaves button disabled with busy label after success', async () => {
    await withButtonGuard(btn, () => Promise.resolve('ok'), {
      busyText: 'Removing...',
      keepDisabledOnSuccess: true,
    });
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Removing...');
  });

  it('disables without changing label when no busyText specified', async () => {
    let capturedText = '';
    await withButtonGuard(btn, () => {
      capturedText = btn.textContent || '';
      return Promise.resolve('ok');
    });
    expect(capturedText).toBe('Save');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Save');
  });
});
