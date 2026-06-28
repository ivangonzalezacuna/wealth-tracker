/**
 * Google OAuth2 — implicit / token flow.
 * No client secret needed. Token lives in memory only (never persisted).
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES    = 'https://www.googleapis.com/auth/spreadsheets';

let _token     = null;   // { access_token, expires_at }
let _resolvers = [];     // queued promises waiting for token

// ── Public API ────────────────────────────────────────────

/** Returns a valid access token, triggering sign-in popup if needed. */
export async function getToken() {
  if (_token && Date.now() < _token.expires_at - 60_000) return _token.access_token;
  return _requestToken();
}

/** Sign out — clears token and reloads so auth UI resets. */
export function signOut() {
  _token = null;
  if (window.google?.accounts?.oauth2) {
    // Revoke via Google Identity Services if loaded
    window.google.accounts.oauth2.revoke(_token?.access_token || '', () => {});
  }
  window.location.reload();
}

/** Returns true if we currently have a valid token. */
export function isSignedIn() {
  return _token !== null && Date.now() < _token.expires_at - 60_000;
}

// ── Internal ──────────────────────────────────────────────

function _requestToken() {
  return new Promise((resolve, reject) => {
    _resolvers.push({ resolve, reject });
    if (_resolvers.length > 1) return; // already waiting

    _loadGIS().then(() => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope:     SCOPES,
        callback:  (resp) => {
          if (resp.error) {
            const err = new Error(resp.error_description || resp.error);
            _resolvers.forEach(r => r.reject(err));
            _resolvers = [];
            return;
          }
          _token = {
            access_token: resp.access_token,
            expires_at:   Date.now() + resp.expires_in * 1000,
          };
          _resolvers.forEach(r => r.resolve(_token.access_token));
          _resolvers = [];
        },
      });
      client.requestAccessToken({ prompt: _token ? '' : 'none' });
    }).catch(err => {
      _resolvers.forEach(r => r.reject(err));
      _resolvers = [];
    });
  });
}

function _loadGIS() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload  = resolve;
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
}
