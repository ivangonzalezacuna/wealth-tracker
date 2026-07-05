/**
 * One-time Google Picker flow, required by the drive.file OAuth scope.
 *
 * drive.file only grants access to files the app created or that the user
 * explicitly opened with it - opening happens through the Picker. This
 * module runs that flow exactly once per browser (result cached in
 * localStorage) and verifies the user picked the same spreadsheet the app
 * is configured to use (VITE_GOOGLE_SHEET_ID), since the rest of the app
 * still addresses the sheet by that fixed ID, not by whatever the user
 * clicks.
 */
import { getToken } from './google';

declare global {
  interface Window {
    gapi?: {
      load: (api: string, callback: () => void) => void;
    };
  }
}

interface GooglePickerNamespace {
  PickerBuilder: new () => GooglePickerBuilder;
  DocsView: new (viewId?: string) => GoogleDocsView;
  ViewId: { SPREADSHEETS: string };
  Action: { PICKED: string; CANCEL: string };
  Response: { ACTION: string; DOCUMENTS: string };
  Document: { ID: string };
}

interface GoogleDocsView {
  setMimeTypes(mimeTypes: string): GoogleDocsView;
}

interface GooglePickerBuilder {
  addView(view: GoogleDocsView): GooglePickerBuilder;
  setOAuthToken(token: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  setCallback(cb: (data: PickerResponse) => void): GooglePickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

interface PickerResponse {
  action: string;
  docs?: Array<{ id: string }>;
}

/** window.google.picker, typed locally to avoid redeclaring the global
 *  Window.google shape already owned by auth/google.ts (GIS). */
function getPickerNamespace(): GooglePickerNamespace {
  return (window as unknown as { google: { picker: GooglePickerNamespace } }).google.picker;
}

const PICKER_API_KEY: string = import.meta.env.VITE_GOOGLE_PICKER_API_KEY;
const AUTHORIZED_KEY = 'gdrive_authorized_sheet_id';

let _pickerApiReady: Promise<void> | null = null;

function loadPickerApi(): Promise<void> {
  if (_pickerApiReady) return _pickerApiReady;
  _pickerApiReady = new Promise<void>((resolve, reject) => {
    if ((window as unknown as { google?: { picker?: unknown } }).google?.picker) return resolve();
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.async = true;
    s.defer = true;
    s.onload = () => {
      window.gapi!.load('picker', () => resolve());
    };
    s.onerror = () => reject(new Error('Failed to load Google Picker API'));
    document.head.appendChild(s);
  });
  return _pickerApiReady;
}

/** True once this browser has picked-and-confirmed the configured sheet. */
export function isDriveFileAuthorized(): boolean {
  try {
    const sheetId: string = import.meta.env.VITE_GOOGLE_SHEET_ID;
    return localStorage.getItem(AUTHORIZED_KEY) === sheetId;
  } catch {
    return false;
  }
}

function markAuthorized(sheetId: string): void {
  try {
    localStorage.setItem(AUTHORIZED_KEY, sheetId);
  } catch {
    /* quota - non-fatal, the flow simply re-runs next sign-in */
  }
}

/**
 * Opens the Picker restricted to Google Sheets files, and resolves once the
 * user has picked the specific spreadsheet this app is configured for
 * (VITE_GOOGLE_SHEET_ID). Rejects with 'picker_cancelled' if the user
 * closes the dialog, or 'picker_wrong_file' if they pick a different sheet
 * (drive.file only authorizes what's picked - picking the wrong file would
 * silently leave the configured sheet still inaccessible).
 */
export async function ensureDriveFileAuthorized(): Promise<void> {
  if (isDriveFileAuthorized()) return;

  const sheetId: string = import.meta.env.VITE_GOOGLE_SHEET_ID;
  const [token] = await Promise.all([getToken(), loadPickerApi()]);

  return new Promise<void>((resolve, reject) => {
    const picker = getPickerNamespace();
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);

    const instance = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(PICKER_API_KEY)
      .setCallback((data: PickerResponse) => {
        if (data.action === picker.Action.CANCEL) {
          reject(new Error('picker_cancelled'));
          return;
        }
        if (data.action === picker.Action.PICKED) {
          const pickedId = data.docs?.[0]?.id;
          if (pickedId !== sheetId) {
            reject(new Error('picker_wrong_file'));
            return;
          }
          markAuthorized(sheetId);
          resolve();
        }
      })
      .build();
    instance.setVisible(true);
  });
}

/** Test-only reset. */
export function _resetPickerAuthorizationForTests(): void {
  try {
    localStorage.removeItem(AUTHORIZED_KEY);
  } catch {
    /* ignore */
  }
  _pickerApiReady = null;
}
