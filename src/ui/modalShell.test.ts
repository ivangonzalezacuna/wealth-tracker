/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateModalShell, createDialogController, openDialogShell } from './modalShell';

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('modal keyboard handling', () => {
  it('keeps an editing dialog open when Escape dismisses the conflict above it', () => {
    const editor = document.createElement('div');
    editor.innerHTML = '<div role="dialog" aria-modal="true"><input value="unsaved draft"></div>';
    const conflict = document.createElement('div');
    conflict.innerHTML = '<div role="alertdialog" aria-modal="true"></div>';
    document.body.append(editor, conflict);
    const closeEditor = vi.fn();
    const closeConflict = vi.fn();
    const cleanupEditor = activateModalShell({ overlay: editor, onDismiss: closeEditor });
    const cleanupConflict = activateModalShell({ overlay: conflict, onDismiss: closeConflict });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(closeConflict).toHaveBeenCalledOnce();
    expect(closeEditor).not.toHaveBeenCalled();
    expect(editor.querySelector('input')?.value).toBe('unsaved draft');
    cleanupConflict();
    cleanupEditor();
  });
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

  it('wraps Tab and Shift+Tab inside the modal', () => {
    const overlay = document.createElement('div');
    overlay.innerHTML = '<button id="first">First</button><button id="last">Last</button>';
    document.body.append(overlay);
    const cleanup = activateModalShell({ overlay, onDismiss: vi.fn() });

    const last = overlay.querySelector('#last') as HTMLButtonElement;
    last.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(overlay.querySelector('#first'));

    const first = overlay.querySelector('#first') as HTMLButtonElement;
    first.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(last);
    cleanup();
  });

  it('focuses the configured initial target and restores the trigger on dismissal', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const overlay = document.createElement('div');
    overlay.innerHTML = '<input id="initial">';
    const controller = createDialogController(false);
    controller.begin(vi.fn());
    openDialogShell(controller, {
      overlay,
      onDismiss: () => controller.dismiss(false),
      initialFocusSelector: '#initial',
    });
    expect(document.activeElement).toBe(overlay.querySelector('#initial'));

    controller.dismiss(false);
    expect(document.activeElement).toBe(trigger);
  });
});
