/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateModalShell } from './modalShell';

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('modal keyboard handling', () => {
  it('dismisses with Escape normally, but honors a nested control consuming the event', () => {
    const overlay = document.createElement('div');
    document.body.append(overlay);
    const dismiss = vi.fn();
    const cleanup = activateModalShell({ overlay, onDismiss: dismiss });
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    consumed.preventDefault();
    document.dispatchEvent(consumed);
    expect(dismiss).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(dismiss).toHaveBeenCalledOnce();
    cleanup();
  });

  it('leaves Escape to an open native select before dismissing its parent', () => {
    const overlay = document.createElement('div');
    const select = document.createElement('select');
    overlay.append(select);
    document.body.append(overlay);
    vi.stubGlobal('CSS', { supports: () => true });
    // jsdom has no native popup; browser tests exercise the actual :open state.
    const query = vi
      .spyOn(overlay, 'querySelector')
      .mockReturnValueOnce(select)
      .mockReturnValue(null);
    const dismiss = vi.fn();
    const cleanup = activateModalShell({ overlay, onDismiss: dismiss });
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    document.dispatchEvent(escape);
    expect(query).toHaveBeenCalledWith('select:open');
    expect(escape.defaultPrevented).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(dismiss).toHaveBeenCalledOnce();
    cleanup();
  });
});
