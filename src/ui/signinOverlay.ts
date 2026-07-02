/**
 * Lightweight wait-state overlay for interactive sign-in.
 * Reuses confirmDialog's .confirm-overlay/.confirm-card CSS (Phase 35) so the
 * two dialog types share one visual language. Unlike confirmDialog, this one
 * is dismissed either by the user (Cancel/Escape/backdrop) or programmatically
 * once the wrapped async operation settles, so it exposes show/hide, not a
 * single resolve-once promise.
 */

let _el: HTMLElement | null = null;
let _trigger: HTMLElement | null = null;
let _onCancel: (() => void) | null = null;

export function showSigninOverlay(onCancel: () => void): void {
  hideSigninOverlay(); // replace any existing instance first
  _onCancel = onCancel;
  _trigger = document.activeElement as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.id = 'signin-overlay';
  overlay.innerHTML = `
    <div class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="signin-overlay-title">
      <div class="spinner" style="margin: 0 auto 10px;"></div>
      <div class="confirm-title" id="signin-overlay-title" style="text-align:center;">Continue in the Google sign-in window</div>
      <div class="confirm-body" style="text-align:center;">Waiting for you to finish signing in.</div>
      <div class="confirm-actions" style="justify-content:center;">
        <button class="btn btn-sm btn-ghost js-signin-cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  _el = overlay;

  overlay.querySelector('.js-signin-cancel')!.addEventListener('click', _cancel);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) _cancel();
  });
  document.addEventListener('keydown', _onKeydown);
}

export function hideSigninOverlay(): void {
  document.removeEventListener('keydown', _onKeydown);
  _el?.remove();
  _el = null;
  if (_trigger && document.body.contains(_trigger)) _trigger.focus();
  _trigger = null;
  _onCancel = null;
}

function _cancel(): void {
  const cb = _onCancel;
  hideSigninOverlay();
  cb?.();
}

function _onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') _cancel();
}
