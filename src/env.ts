/**
 * DEVELOPMENT adds a banner and title prefix; it does not disable Drive sync.
 * The active environment is logged in both modes.
 */

const ENV_LABEL: string = import.meta.env.VITE_APP_ENV || 'PRODUCTION';

export function isDev(): boolean {
  return ENV_LABEL === 'DEVELOPMENT';
}

/** Log the active environment to the console on boot. */
export function logEnvironment(): void {
  console.info('[wealth-tracker] env=%s', ENV_LABEL);
}

/** Inject a visual banner when running in development mode. */
export function injectEnvBanner(): void {
  if (!isDev()) return;

  if (!document.title.startsWith('[DEV]')) {
    document.title = `[DEV] ${document.title}`;
  }

  if (document.getElementById('env-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'env-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-label', 'Development environment indicator');
  banner.textContent = 'DEVELOPMENT — test data only';
  document.body.prepend(banner);
}
