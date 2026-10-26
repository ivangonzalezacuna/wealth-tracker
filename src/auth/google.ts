/**
 * Google OAuth via Google Identity Services (GIS) token client.
 * Token kept in memory + localStorage (instant boot); ~1h lifetime.
 *
 * GIS has no hidden-iframe refresh: every token request opens a popup, which
 * browsers only allow from a user gesture. So a new token is only ever
 * requested from a click (signIn); background callers get NeedsAuthError.
 */

import { NeedsAuthError } from './errors';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: typeof google.accounts.oauth2;
      };
    };
  }
}

interface StoredToken {
  access_token: string;
  expires_at: number;
}

const CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID;
// drive.appdata: grants access only to the hidden, per-app AppData folder in
// Google Drive. Each OAuth application has its own isolated AppData space, so
// dev and prod environments (separate OAuth apps) can never access each other's
// data. No Picker flow is needed - the scope covers the folder automatically.
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
const STORE_KEY = 'gtoken';
const GRANTED_KEY = 'ggranted'; // "this browser has completed a real consent grant"
const ACCOUNT_KEY = 'gaccount'; // email of the account last used here (login_hint)

let _token: StoredToken | null = null;
let _tokenClient: google.accounts.oauth2.TokenClient | null = null;
let _gisReady: Promise<void> | null = null;
let _pendingReject: ((e: Error) => void) | null = null;
// Set after a failed request that wasn't a plain cancel: the next attempt
// asks for full consent in case the earlier grant was revoked elsewhere.
let _forceConsent = false;

// ── restore cached token (survives reloads & app restarts) ──
try {
  const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as StoredToken | null;
  if (s?.expires_at && Date.now() < s.expires_at - 60_000) _token = s;
  else localStorage.removeItem(STORE_KEY);
} catch {
  /* ignore parse errors */
}

function _save(tok: StoredToken): void {
  _token = tok;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(tok));
    localStorage.setItem(GRANTED_KEY, '1');
  } catch {
    /* quota */
  }
}

// ── load GIS script once, then init the token client ───────
function _loadGis(): Promise<void> {
  if (_gisReady) return _gisReady;
  const ready = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  }).then(() => {
    _tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: () => {}, // set per-request below
      error_callback: (err) => {
        _pendingReject?.(
          new Error(err?.type === 'popup_closed' ? 'popup_closed' : err?.type || 'sign_in_error'),
        );
        _pendingReject = null;
      },
    });
  });
  // Allow a later retry if the script failed to load (e.g. offline at boot).
  _gisReady = ready.catch((err) => {
    _gisReady = null;
    throw err;
  });
  return _gisReady;
}

/**
 * Load GIS ahead of time so a later click can open the popup immediately.
 * Browsers only allow popups during a short window after a user gesture;
 * waiting for the script download inside that window can get it blocked.
 */
export function preloadGis(): void {
  _loadGis().catch(() => {});
}

function _requestToken(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    _loadGis()
      .then(() => {
        _tokenClient!.callback = (resp: google.accounts.oauth2.TokenResponse) => {
          _pendingReject = null;
          if (resp.error) return reject(new Error(resp.error));
          _save({
            access_token: resp.access_token,
            expires_at: Date.now() + Number(resp.expires_in) * 1000,
          });
          resolve(_token!.access_token);
        };
        _pendingReject = reject;
        try {
          // prompt '' shows UI only when needed (first grant), so a returning
          // user just sees a popup that closes by itself.
          const light = hasEverGranted() && !_forceConsent;
          const hint = getRememberedAccount();
          _tokenClient!.requestAccessToken(
            hint
              ? { prompt: light ? '' : 'consent', login_hint: hint }
              : { prompt: light ? '' : 'consent' },
          );
        } catch (e) {
          _pendingReject = null;
          reject(e);
        }
      })
      .catch(reject);
  });
}

/** Returns a valid token, or throws NeedsAuthError (never opens UI). */
export async function getToken(): Promise<string> {
  if (_token && Date.now() < _token.expires_at - 60_000) return _token.access_token;
  throw new NeedsAuthError();
}

const CANCEL_ERRORS = new Set(['popup_closed', 'popup_failed_to_open']);

/** Interactive sign-in - must be called from a user gesture (button click). */
export async function signIn(): Promise<string> {
  try {
    const token = await _requestToken();
    _forceConsent = false;
    return token;
  } catch (err) {
    // A real failure (not a closed/blocked popup) may mean the earlier grant
    // was revoked outside this app: ask for full consent next time.
    if (!CANCEL_ERRORS.has((err as Error).message)) _forceConsent = true;
    throw err;
  }
}

export function isSignedIn(): boolean {
  return _token !== null && Date.now() < _token.expires_at - 60_000;
}

/**
 * Returns true if the user has ever completed a successful OAuth grant in this
 * browser. Used to distinguish "authenticated but temporarily offline/token-
 * expired" from "never signed in at all".
 */
export function hasEverGranted(): boolean {
  try {
    return localStorage.getItem(GRANTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Email of the Google account last connected in this browser, if known. */
export function getRememberedAccount(): string | null {
  try {
    return localStorage.getItem(ACCOUNT_KEY);
  } catch {
    return null;
  }
}

/** Remember the connected account so future popups preselect it. */
export function rememberAccount(email: string): void {
  try {
    localStorage.setItem(ACCOUNT_KEY, email);
  } catch {
    /* quota */
  }
}

function _revoke(token: string | undefined): void {
  if (token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
}

/**
 * Drop the current token (e.g. it belongs to an unexpected account) without
 * forgetting that this browser was set up, so local data stays editable.
 */
export function forgetToken(): void {
  const t = _token?.access_token;
  _token = null;
  localStorage.removeItem(STORE_KEY);
  _forceConsent = true; // let the user pick an account next time
  _revoke(t);
}

export function signOut(): void {
  const t = _token?.access_token;
  _token = null;
  localStorage.removeItem(STORE_KEY);
  localStorage.removeItem(GRANTED_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
  _revoke(t);
  window.location.reload();
}
