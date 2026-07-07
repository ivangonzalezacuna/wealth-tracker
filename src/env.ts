/**
 * Environment indicator - visual safeguard against accidentally using
 * production data during development.
 *
 * In DEVELOPMENT mode:
 *  - A persistent banner is shown at the top of the page.
 *  - The document title is prefixed with [DEV].
 *  - A console.info line logs the active environment on boot.
 *
 * In PRODUCTION mode: no banner, no title prefix, silent boot log only.
 */

const ENV_LABEL: string =
  import.meta.env.VITE_ENV_LABEL || import.meta.env.VITE_APP_ENV || 'PRODUCTION';

export function isDev(): boolean {
  return ENV_LABEL === 'DEVELOPMENT';
}

export function getEnvLabel(): string {
  return ENV_LABEL;
}

/** Log the active environment to the console on boot. */
export function logEnvironment(): void {
  console.info('[wealth-tracker] env=%s', ENV_LABEL);
}

/** Inject a visual banner when running in development mode. */
export function injectEnvBanner(): void {
  if (!isDev()) return;

  // Prefix document title
  if (!document.title.startsWith('[DEV]')) {
    document.title = `[DEV] ${document.title}`;
  }

  // Inject banner element (idempotent)
  if (document.getElementById('env-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'env-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-label', 'Development environment indicator');
  banner.textContent = 'DEVELOPMENT — test data only';
  document.body.prepend(banner);
}
