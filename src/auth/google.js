/**
 * Google OAuth via Google Identity Services (GIS) token client.
 * Silent background refresh — no full-page redirect, no repeated consent.
 * Token kept in memory + localStorage (instant boot); ~1h lifetime, refreshed
 * silently through the user's existing Google session.
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES    = 'https://www.googleapis.com/auth/spreadsheets';
const STORE_KEY = 'gtoken';

let _token = null;          // { access_token, expires_at }
let _tokenClient = null;
let _gisReady = null;
let _refreshTimer = null;

// ── restore cached token (survives reloads & app restarts) ──
try {
  const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if (s?.expires_at && Date.now() < s.expires_at - 60_000) _token = s;
  else localStorage.removeItem(STORE_KEY);
} catch {}

function _save(tok) {
  _token = tok;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(tok)); } catch {}
  _scheduleRefresh(tok);
}

// proactively refresh ~5 min before expiry so long-open sessions never fail
function _scheduleRefresh(tok) {
  clearTimeout(_refreshTimer);
  const ms = tok.expires_at - Date.now() - 5 * 60_000;
  if (ms > 0) _refreshTimer = setTimeout(() => _requestToken(false).catch(() => {}), ms);
}

// ── load GIS script once, then init the token client ───────
function _loadGis() {
  if (_gisReady) return _gisReady;
  _gisReady = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  }).then(() => {
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: () => {},   // set per-request below
    });
  });
  return _gisReady;
}

// interactive=false → silent (no UI) via existing session
function _requestToken(interactive) {
  return new Promise((resolve, reject) => {
    _loadGis().then(() => {
      _tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        _save({
          access_token: resp.access_token,
          expires_at: Date.now() + Number(resp.expires_in) * 1000,
        });
        resolve(_token.access_token);
      };
      try {
        _tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
      } catch (e) { reject(e); }
    }).catch(reject);
  });
}

/** Returns a valid token, refreshing silently when possible. */
export async function getToken() {
  if (_token && Date.now() < _token.expires_at - 60_000) return _token.access_token;
  return _requestToken(false);
}

/** Interactive sign-in — must be called from a user gesture (button click). */
export async function signIn() {
  return _requestToken(true);
}

/** Silent boot sign-in. Resolves true if a token is available without UI. */
export async function trySilentSignIn() {
  if (isSignedIn()) return true;
  try { await _requestToken(false); return isSignedIn(); }
  catch { return false; }
}

export function isSignedIn() {
  return _token !== null && Date.now() < _token.expires_at - 60_000;
}

export function signOut() {
  const t = _token?.access_token;
  _token = null;
  clearTimeout(_refreshTimer);
  localStorage.removeItem(STORE_KEY);
  if (t && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(t, () => {});
  }
  window.location.reload();
}
