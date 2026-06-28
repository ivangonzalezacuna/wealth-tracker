/**
 * Google OAuth2 — implicit / token flow via full-page redirect.
 * Works on mobile (no popup). Token lives in memory only (never persisted).
 */

const CLIENT_ID    = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES       = 'https://www.googleapis.com/auth/spreadsheets';
const REDIRECT_URI = window.location.origin;

let _token = null;   // { access_token, expires_at }

// ── Bootstrap: grab token from URL hash on redirect back ─────
(function _parseHashToken() {
  const hash = window.location.hash;
  if (!hash) return;

  const params      = new URLSearchParams(hash.substring(1));
  const accessToken = params.get('access_token');
  const expiresIn   = params.get('expires_in');

  if (accessToken && expiresIn) {
    _token = {
      access_token: accessToken,
      expires_at:   Date.now() + Number(expiresIn) * 1000,
    };
    // Clear the hash so tokens don't linger in the URL / browser history
    window.history.replaceState({}, '', window.location.pathname);
  }
})();

// ── Public API ────────────────────────────────────────────

/** Returns a valid access token, redirecting to Google sign-in if needed. */
export async function getToken() {
  if (_token && Date.now() < _token.expires_at - 60_000) return _token.access_token;
  _redirectToGoogle();
  // The redirect will navigate away; this promise never resolves in the
  // current page load, but callers already handle the interrupted flow.
  return new Promise(() => {});
}

/** Sign out — clears token and reloads so auth UI resets. */
export function signOut() {
  const revokeToken = _token?.access_token;
  _token = null;
  if (revokeToken) {
    // Best-effort revoke via Google's endpoint
    fetch(`https://oauth2.googleapis.com/revoke?token=${revokeToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => {});
  }
  window.location.reload();
}

/** Returns true if we currently have a valid token. */
export function isSignedIn() {
  return _token !== null && Date.now() < _token.expires_at - 60_000;
}

// ── Internal ──────────────────────────────────────────────

function _redirectToGoogle() {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'token',
    scope:         SCOPES,
    prompt:        'consent',
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}
