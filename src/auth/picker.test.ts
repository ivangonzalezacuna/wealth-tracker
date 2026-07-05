/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.stubEnv('VITE_GOOGLE_SHEET_ID', 'sheet-abc');
vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', 'test-picker-key');

vi.mock('./google', () => ({
  getToken: vi.fn(async () => 'test-oauth-token'),
}));

import {
  isDriveFileAuthorized,
  ensureDriveFileAuthorized,
  _resetPickerAuthorizationForTests,
} from './picker';

// Minimal fake google.picker namespace. setCallback captures the callback
// so each test can invoke it directly with a fake PickerResponse, instead
// of driving a real (impossible-to-simulate-in-jsdom) picker UI.
function stubPickerNamespace() {
  let capturedCallback: ((data: { action: string; docs?: Array<{ id: string }> }) => void) | null =
    null;

  const builder = {
    addView: () => builder,
    setOAuthToken: () => builder,
    setDeveloperKey: () => builder,
    setCallback: (cb: typeof capturedCallback) => {
      capturedCallback = cb;
      return builder;
    },
    build: () => ({ setVisible: () => {} }),
  };

  (window as unknown as { google: unknown }).google = {
    picker: {
      PickerBuilder: vi.fn(function PickerBuilder(this: unknown) {
        return builder;
      }),
      DocsView: vi.fn(function DocsView(this: unknown) {
        return { setMimeTypes: () => ({}) };
      }),
      ViewId: { SPREADSHEETS: 'spreadsheets' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' },
      Document: { ID: 'id' },
    },
  };

  return {
    fire: (data: { action: string; docs?: Array<{ id: string }> }) => capturedCallback?.(data),
  };
}

describe('isDriveFileAuthorized / ensureDriveFileAuthorized', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetPickerAuthorizationForTests();
  });

  afterEach(() => {
    delete (window as unknown as { google?: unknown }).google;
  });

  it('is false before any picker flow has run', () => {
    expect(isDriveFileAuthorized()).toBe(false);
  });

  it('resolves and marks authorized when the correct sheet is picked', async () => {
    const picker = stubPickerNamespace();
    const pending = ensureDriveFileAuthorized();
    // Let the getToken()/loadPickerApi() microtasks settle before firing the callback.
    await Promise.resolve();
    await Promise.resolve();
    picker.fire({ action: 'picked', docs: [{ id: 'sheet-abc' }] });

    await expect(pending).resolves.toBeUndefined();
    expect(isDriveFileAuthorized()).toBe(true);
  });

  it('rejects with picker_wrong_file and does not mark authorized when a different sheet is picked', async () => {
    const picker = stubPickerNamespace();
    const pending = ensureDriveFileAuthorized();
    await Promise.resolve();
    await Promise.resolve();
    picker.fire({ action: 'picked', docs: [{ id: 'some-other-sheet' }] });

    await expect(pending).rejects.toThrow('picker_wrong_file');
    expect(isDriveFileAuthorized()).toBe(false);
  });

  it('rejects with picker_cancelled when the user closes the dialog', async () => {
    const picker = stubPickerNamespace();
    const pending = ensureDriveFileAuthorized();
    await Promise.resolve();
    await Promise.resolve();
    picker.fire({ action: 'cancel' });

    await expect(pending).rejects.toThrow('picker_cancelled');
    expect(isDriveFileAuthorized()).toBe(false);
  });

  it('short-circuits (never opens the picker) once already authorized', async () => {
    stubPickerNamespace();
    const picker = stubPickerNamespace();
    const first = ensureDriveFileAuthorized();
    await Promise.resolve();
    await Promise.resolve();
    picker.fire({ action: 'picked', docs: [{ id: 'sheet-abc' }] });
    await first;

    const builderSpy = (
      window as unknown as { google: { picker: { PickerBuilder: ReturnType<typeof vi.fn> } } }
    ).google.picker.PickerBuilder;
    builderSpy.mockClear();

    await ensureDriveFileAuthorized();
    expect(builderSpy).not.toHaveBeenCalled();
  });
});
