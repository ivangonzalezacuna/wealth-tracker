/**
 * Storage quota monitoring.
 *
 * Checks available browser storage on startup and shows a persistent
 * dismissible warning banner when usage is critically high, so the user
 * can export a backup before data is at risk.
 */

/** Usage fraction above which we show the high-risk warning. */
const STORAGE_WARN_RATIO = 0.85;
/** Minimum quota (in bytes) below which we show the low-capacity warning. */
const STORAGE_WARN_MIN_QUOTA = 50 * 1024 * 1024; // 50 MB

const STORAGE_BANNER_DISMISS_KEY = 'wt_storage_warn_dismissed';
const STORAGE_BANNER_ID = 'storage-warn-banner';

/** Run the storage estimate check and inject the banner if needed. */
export async function checkStorageQuota(): Promise<void> {
  if (!navigator.storage || !navigator.storage.estimate) return;
  let estimate: StorageEstimate;
  try {
    estimate = await navigator.storage.estimate();
  } catch {
    return;
  }
  const { usage = 0, quota = 0 } = estimate;
  if (quota <= 0) return;

  const ratio = usage / quota;
  const isHighRisk = ratio >= STORAGE_WARN_RATIO || quota < STORAGE_WARN_MIN_QUOTA;
  if (!isHighRisk) return;

  // Suppress if the user already dismissed this session
  if (sessionStorage.getItem(STORAGE_BANNER_DISMISS_KEY) === '1') return;

  _injectBanner(usage, quota, ratio);
}

function _injectBanner(usage: number, quota: number, ratio: number): void {
  if (document.getElementById(STORAGE_BANNER_ID)) return;

  const usedMB = (usage / 1024 / 1024).toFixed(1);
  const totalMB = (quota / 1024 / 1024).toFixed(0);
  const pct = Math.round(ratio * 100);

  const banner = document.createElement('div');
  banner.id = STORAGE_BANNER_ID;
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `
    <span>Storage is ${pct}% full (${usedMB} MB of ${totalMB} MB). Export a backup to avoid data loss.</span>
    <button id="storage-warn-dismiss" aria-label="Dismiss storage warning">&#x2715;</button>
  `;
  document.body.prepend(banner);

  document.getElementById('storage-warn-dismiss')?.addEventListener('click', () => {
    banner.remove();
    try {
      sessionStorage.setItem(STORAGE_BANNER_DISMISS_KEY, '1');
    } catch {
      // Quota-exceeded in sessionStorage - not critical
    }
  });
}
