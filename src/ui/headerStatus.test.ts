// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { relativeTime, renderSyncChip, shortSyncError, syncChipView } from './headerStatus';

const NOW = Date.UTC(2026, 4, 15, 12, 0);
const view = (over: Partial<Parameters<typeof syncChipView>[0]>) =>
  syncChipView({ status: 'ok', busy: false, lastOkAt: null, now: NOW, ...over });

describe('relativeTime', () => {
  it('reads naturally across ranges', () => {
    expect(relativeTime(NOW - 20_000, NOW)).toBe('just now');
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5 min ago');
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3 h ago');
    expect(relativeTime(NOW - 30 * 3_600_000, NOW)).toBe('yesterday');
    expect(relativeTime(NOW - 5 * 86_400_000, NOW)).not.toMatch(/ago/);
  });

  it('uses English dates from 48 hours onward, including in sync labels', () => {
    const at = new Date(2026, 4, 10, 12).getTime();
    expect(relativeTime(at, at + 48 * 3_600_000 - 1)).toBe('yesterday');
    expect(relativeTime(at, at + 48 * 3_600_000)).toBe('10 May');
    expect(view({ lastOkAt: at })!.label).toBe('Synced \u00b7 10 May');
  });
});

describe('shortSyncError', () => {
  it('drops the raw Drive JSON body but keeps its message', () => {
    const raw =
      'Drive list error: 401 {\n  "error": {\n    "code": 401,\n    "message": "Request had invalid authentication credentials."\n  }\n}';
    expect(shortSyncError(raw)).toBe(
      'Drive list error: 401 (Request had invalid authentication credentials.)',
    );
  });
  it('explains network failures and caps the length', () => {
    expect(shortSyncError('TypeError: Failed to fetch')).toBe('Google Drive could not be reached');
    expect(shortSyncError('x'.repeat(200)).length).toBeLessThanOrEqual(90);
    expect(shortSyncError('')).toBe('Unknown error');
  });
});

describe('syncChipView', () => {
  it('synced: shows how long ago and offers a sync', () => {
    const v = view({ lastOkAt: NOW - 5 * 60_000 })!;
    expect(v.label).toBe('Synced \u00b7 5 min ago');
    expect(v.action).toBe('sync');
    expect(v.title).toMatch(/Select to sync now/);
  });
  it('a save or sync in progress turns synced/failed into Syncing', () => {
    expect(view({ busy: true })!.label).toBe('Syncing\u2026');
    expect(view({ status: 'error', busy: true })!.action).toBeNull();
  });
  it('failed: short label, short reason in the tooltip, retry action', () => {
    const v = view({
      status: 'error',
      msg: 'Drive list error: 500 {"error":{"message":"Backend Error"}}',
    })!;
    expect(v.label).toBe('Sync failed');
    expect(v.title).toBe('Sync failed: Drive list error: 500 (Backend Error). Select to retry.');
    expect(v.action).toBe('sync');
  });
  it('offline and read-only cannot be acted on', () => {
    expect(view({ status: 'offline' })).toMatchObject({ label: 'Offline', action: null });
    expect(view({ status: 'offline', busy: true })).toMatchObject({ label: 'Offline' });
    expect(view({ status: 'cached' })).toMatchObject({ label: 'Read-only', action: null });
  });
  it('offline and failed states mention changes that are not in Drive yet', () => {
    expect(view({ status: 'offline', pending: true })).toMatchObject({
      label: 'Offline \u00b7 not synced',
      action: null,
    });
    expect(view({ status: 'offline', pending: true })!.title).toContain('not in Google Drive yet');
    const failed = view({ status: 'error', msg: 'Drive API 500', pending: true })!;
    expect(failed.label).toBe('Sync failed');
    expect(failed.title).toContain('saved on this device but not in Google Drive yet');
  });
  it('not connected states offer to connect and sync', () => {
    expect(view({ status: 'local' })).toMatchObject({
      label: 'Not connected',
      tone: 'info',
      action: 'sync',
    });
    expect(view({ status: 'pending' })).toMatchObject({
      label: 'Not synced',
      tone: 'warn',
      action: 'sync',
    });
  });
  it('conflict resolves; empty status hides the chip', () => {
    expect(view({ status: 'conflict' })).toMatchObject({ label: 'Sync paused', action: 'resolve' });
    expect(view({ status: '' })).toBeNull();
  });
});

describe('renderSyncChip', () => {
  it('renders an icon, label and accessible name; disables when there is no action', () => {
    document.body.innerHTML = '<button id="c" hidden></button>';
    const el = document.getElementById('c')!;
    renderSyncChip(el, view({ lastOkAt: NOW })!);
    expect(el.hidden).toBe(false);
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.textContent).toBe('Synced \u00b7 just now');
    expect(el.dataset.action).toBe('sync');
    expect(el.getAttribute('aria-label')).toBe(el.title);
    expect(el.hasAttribute('aria-disabled')).toBe(false);

    renderSyncChip(el, view({ status: 'offline' })!);
    expect(el.dataset.action).toBeUndefined();
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.className).toContain('status-warn');

    renderSyncChip(el, null);
    expect(el.hidden).toBe(true);
  });
});
