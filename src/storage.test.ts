/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkStorageQuota } from './storage';

// jsdom does not implement navigator.storage, so we stub it ourselves.

beforeEach(() => {
  // Clean up any injected banner between tests
  document.getElementById('storage-warn-banner')?.remove();
  sessionStorage.removeItem('wt_storage_warn_dismissed');
});

afterEach(() => {
  vi.restoreAllMocks();
  document.getElementById('storage-warn-banner')?.remove();
  sessionStorage.removeItem('wt_storage_warn_dismissed');
});

function mockEstimate(usage: number, quota: number): void {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      estimate: vi.fn().mockResolvedValue({ usage, quota }),
    },
  });
}

describe('checkStorageQuota', () => {
  it('injects the warning banner when usage is above threshold', async () => {
    mockEstimate(90 * 1024 * 1024, 100 * 1024 * 1024); // 90% used
    await checkStorageQuota();
    expect(document.getElementById('storage-warn-banner')).not.toBeNull();
  });

  it('injects the warning banner when quota is below minimum', async () => {
    mockEstimate(5 * 1024 * 1024, 20 * 1024 * 1024); // quota < 50 MB
    await checkStorageQuota();
    expect(document.getElementById('storage-warn-banner')).not.toBeNull();
  });

  it('does not inject a banner when usage is safely below threshold', async () => {
    mockEstimate(10 * 1024 * 1024, 500 * 1024 * 1024); // 2% used
    await checkStorageQuota();
    expect(document.getElementById('storage-warn-banner')).toBeNull();
  });

  it('does not inject a banner when storage API is unavailable', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    await checkStorageQuota();
    expect(document.getElementById('storage-warn-banner')).toBeNull();
  });

  it('does not inject a duplicate banner when called twice', async () => {
    mockEstimate(90 * 1024 * 1024, 100 * 1024 * 1024);
    await checkStorageQuota();
    await checkStorageQuota();
    expect(document.querySelectorAll('#storage-warn-banner').length).toBe(1);
  });

  it('removes the banner and marks dismissed when the dismiss button is clicked', async () => {
    mockEstimate(90 * 1024 * 1024, 100 * 1024 * 1024);
    await checkStorageQuota();
    const btn = document.getElementById('storage-warn-dismiss') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn.click();
    expect(document.getElementById('storage-warn-banner')).toBeNull();
    expect(sessionStorage.getItem('wt_storage_warn_dismissed')).toBe('1');
  });

  it('does not inject a banner when already dismissed this session', async () => {
    sessionStorage.setItem('wt_storage_warn_dismissed', '1');
    mockEstimate(90 * 1024 * 1024, 100 * 1024 * 1024);
    await checkStorageQuota();
    expect(document.getElementById('storage-warn-banner')).toBeNull();
  });
});
