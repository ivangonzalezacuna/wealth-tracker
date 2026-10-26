/** Header sync chip: one compact control that shows the sync state and,
 *  when it makes sense, acts on it (sync now, retry, resolve a conflict). */

export type SyncStatus =
  | ''
  | 'loading'
  | 'syncing'
  | 'cached'
  | 'local'
  | 'pending'
  | 'ok'
  | 'offline'
  | 'conflict'
  | 'error';

export type SyncChipAction = 'sync' | 'resolve' | null;

export interface SyncChipView {
  tone: 'ok' | 'info' | 'warn' | 'err';
  icon: 'spinner' | 'check' | 'cloud-off' | 'offline' | 'alert';
  label: string;
  title: string;
  action: SyncChipAction;
  busy: boolean;
}

export interface SyncChipInput {
  status: SyncStatus;
  msg?: string;
  /** True while any sync or save holds the shared lock. */
  busy: boolean;
  lastOkAt: number | null;
  now: number;
}

const svg = (body: string) =>
  `<svg class="sync-chip-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${body}</svg>`;

const ICONS: Record<Exclude<SyncChipView['icon'], 'spinner'>, string> = {
  check: svg(
    '<path d="M3.2 8.4l3 3 6.6-6.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  'cloud-off': svg(
    '<path d="M4.6 12.4h6.9a2.6 2.6 0 0 0 .5-5.1A4 4 0 0 0 5 6.1a3.2 3.2 0 0 0-.4 6.3Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2.5 2.5l11 11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  ),
  offline: svg(
    '<path d="M1.8 6.2a9 9 0 0 1 12.4 0M4 8.6a5.8 5.8 0 0 1 8 0M6.2 11a2.6 2.6 0 0 1 3.6 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2.5 2.5l11 11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  ),
  alert: svg(
    '<path d="M8 2.2l6.2 11H1.8Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 6.4v3.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.5" r=".8" fill="currentColor"/>',
  ),
};

/** "just now", "5 min ago", "3 h ago", "yesterday", or a short date. */
export function relativeTime(at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return 'yesterday';
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Turn a raw sync error (which may embed a Drive JSON response) into one short line. */
export function shortSyncError(msg: string | undefined): string {
  let text = (msg ?? '').split(/\r?\n/)[0];
  const brace = text.indexOf('{');
  if (brace >= 0) {
    const tail = (msg ?? '').slice((msg ?? '').indexOf('{'));
    const apiMessage = /"message"\s*:\s*"([^"]+)"/.exec(tail)?.[1];
    text = text.slice(0, brace).trim();
    if (apiMessage) text = `${text} (${apiMessage})`;
  }
  text = text.trim();
  if (/failed to fetch|networkerror|network request failed/i.test(text)) {
    text = 'Google Drive could not be reached';
  }
  if (!text) return 'Unknown error';
  return text.length > 90 ? `${text.slice(0, 89).trimEnd()}\u2026` : text;
}

export function syncChipView(input: SyncChipInput): SyncChipView | null {
  const { status, busy, lastOkAt, now } = input;
  const syncing = (label: string, title: string): SyncChipView => ({
    tone: 'warn',
    icon: 'spinner',
    label,
    title,
    action: null,
    busy: true,
  });
  if (status === 'loading')
    return syncing('Loading\u2026', 'Loading app data and checking sync status');
  if (status === 'syncing' || (busy && (status === 'ok' || status === 'error')))
    return syncing('Syncing\u2026', 'Syncing local data with Google Drive');
  switch (status) {
    case 'ok': {
      const ago = lastOkAt == null ? '' : relativeTime(lastOkAt, now);
      return {
        tone: 'ok',
        icon: 'check',
        label: ago ? `Synced \u00b7 ${ago}` : 'Synced',
        title: `Synced with Google Drive${ago ? ` ${ago}` : ''}. Select to sync now.`,
        action: 'sync',
        busy: false,
      };
    }
    case 'error': {
      const reason = shortSyncError(input.msg);
      return {
        tone: 'err',
        icon: 'alert',
        label: 'Sync failed',
        title: `Sync failed: ${reason}. Select to retry.`,
        action: 'sync',
        busy: false,
      };
    }
    case 'offline':
      return {
        tone: 'warn',
        icon: 'offline',
        label: 'Offline',
        title: 'Offline: showing data saved on this device. Changes sync when you are back online.',
        action: null,
        busy: false,
      };
    case 'cached':
      return {
        tone: 'info',
        icon: 'cloud-off',
        label: 'Read-only',
        title: 'Showing data saved on this device. Sign in to sync and edit.',
        action: null,
        busy: false,
      };
    case 'local':
      return {
        tone: 'info',
        icon: 'cloud-off',
        label: 'Not connected',
        title: 'Editing on this device. Select to connect to Google Drive and sync.',
        action: 'sync',
        busy: false,
      };
    case 'pending':
      return {
        tone: 'warn',
        icon: 'cloud-off',
        label: 'Not synced',
        title: 'Changes saved on this device are not in Google Drive yet. Select to sync.',
        action: 'sync',
        busy: false,
      };
    case 'conflict':
      return {
        tone: 'warn',
        icon: 'alert',
        label: 'Sync paused',
        title: 'Sync paused: this device and Google Drive both changed. Select to resolve.',
        action: 'resolve',
        busy: false,
      };
    default:
      return null;
  }
}

export function renderSyncChip(el: HTMLElement, view: SyncChipView | null): void {
  if (!view) {
    el.hidden = true;
    el.removeAttribute('data-action');
    return;
  }
  el.hidden = false;
  el.className = `status-pill sync-chip status-${view.tone}`;
  const icon =
    view.icon === 'spinner' ? '<span class="spinner" aria-hidden="true"></span>' : ICONS[view.icon];
  el.innerHTML = `${icon}<span class="sync-chip-label"></span>`;
  el.querySelector('.sync-chip-label')!.textContent = view.label;
  el.title = view.title;
  el.setAttribute('aria-label', view.title);
  el.setAttribute('aria-busy', String(view.busy));
  if (view.action) {
    el.dataset.action = view.action;
    el.removeAttribute('aria-disabled');
  } else {
    el.removeAttribute('data-action');
    el.setAttribute('aria-disabled', 'true');
  }
}
