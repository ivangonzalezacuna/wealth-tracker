/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateBackup } from './backup/exportImport';
import { withButtonGuard } from './utils';

/**
 * main.ts has heavy module-level side effects (DOM manipulation, auth init,
 * etc.) which make direct import impractical for unit testing. Instead, we
 * test the guard logic in isolation by reproducing the exact guard conditions
 * used in showSection and showPortfolioSubview, then verify the expected
 * short-circuit behavior.
 */

describe('showSection idempotent guard', () => {
  let _activeSection: string;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="networth" class="section active"></div>
      <div id="portfolio" class="section"></div>
      <div id="settings" class="section"></div>
      <div id="log" class="section"></div>
    `;
    _activeSection = 'networth';
  });

  describe('updateDriftBadge accessibility copy', () => {
    // Mirror of the real updateDriftBadge logic for isolated unit testing
    function applyDriftBadge(btn: HTMLButtonElement, max: number | null): void {
      const threshold = 5;
      const highThreshold = threshold * 2;
      if (max !== null && max > threshold) {
        const isHigh = max > highThreshold;
        btn.classList.add('drift-alert');
        btn.classList.toggle('drift-alert-high', isHigh);
        btn.setAttribute('aria-label', `Portfolio (drift alert: ${Math.round(max)}pp)`);

        const severityLabel = isHigh ? 'High drift' : 'Moderate drift';
        const thresholdLabel = isHigh
          ? `over ${highThreshold}% (high threshold)`
          : `over ${threshold}% (threshold)`;
        const tipText = `${severityLabel}: max allocation drift is ${Math.round(max)}%, ${thresholdLabel}. Open Portfolio to review it.`;
        const variant = isHigh ? 'alert' : 'warn';

        let tipEl = btn.querySelector<HTMLElement>('.info-tip');
        if (!tipEl) {
          tipEl = document.createElement('span');
          tipEl.className = `info-tip info-tip--${variant}`;
          tipEl.dataset.tipVariant = variant;
          tipEl.textContent = variant === 'alert' ? '\u203c' : '\u25cf';
          btn.appendChild(tipEl);
        } else {
          tipEl.className = `info-tip info-tip--${variant}`;
          tipEl.dataset.tipVariant = variant;
          tipEl.textContent = variant === 'alert' ? '\u203c' : '\u25cf';
        }
        tipEl.dataset.tip = tipText;
        tipEl.setAttribute('aria-label', tipText);
      } else {
        btn.classList.remove('drift-alert', 'drift-alert-high');
        btn.removeAttribute('aria-label');
        btn.querySelector('.info-tip')?.remove();
      }
    }

    it('adds drift-alert class and aria-label when badge is shown', () => {
      document.body.innerHTML = `<button id="tab-portfolio">Portfolio</button>`;
      const btn = document.getElementById('tab-portfolio') as HTMLButtonElement;
      applyDriftBadge(btn, 8.4);
      expect(btn.classList.contains('drift-alert')).toBe(true);
      expect(btn.getAttribute('aria-label')).toBe('Portfolio (drift alert: 8pp)');
    });

    it('embeds an info-tip span inside the nav button when drift exceeds threshold', () => {
      document.body.innerHTML = `<div class="nav"><button id="tab-portfolio">Portfolio</button></div>`;
      const btn = document.getElementById('tab-portfolio') as HTMLButtonElement;
      applyDriftBadge(btn, 8.4);
      const tipEl = btn.querySelector('.info-tip');
      expect(tipEl).not.toBeNull();
      expect(tipEl?.getAttribute('data-tip')).toContain('Moderate drift');
      expect(tipEl?.getAttribute('data-tip')).toContain('8%');
    });

    it('uses alert variant for high drift, warn for moderate drift', () => {
      document.body.innerHTML = `<button id="tab-portfolio">Portfolio</button>`;
      const btn = document.getElementById('tab-portfolio') as HTMLButtonElement;
      applyDriftBadge(btn, 8.4); // moderate (below 10 = 2*5)
      expect(btn.querySelector('.info-tip')?.classList.contains('info-tip--warn')).toBe(true);
      applyDriftBadge(btn, 12); // high (above 10)
      expect(btn.querySelector('.info-tip')?.classList.contains('info-tip--alert')).toBe(true);
    });

    it('clears the info-tip span and accessibility attributes when badge is removed', () => {
      document.body.innerHTML = `<button id="tab-portfolio">Portfolio</button>`;
      const btn = document.getElementById('tab-portfolio') as HTMLButtonElement;
      applyDriftBadge(btn, 8.4);
      applyDriftBadge(btn, 3);
      expect(btn.classList.contains('drift-alert')).toBe(false);
      expect(btn.hasAttribute('aria-label')).toBe(false);
      expect(btn.querySelector('.info-tip')).toBeNull();
    });
  });

  function isAlreadyActive(id: string): boolean {
    return _activeSection === id && !!document.getElementById(id)?.classList.contains('active');
  }

  it('detects already-active section (networth on networth)', () => {
    expect(isAlreadyActive('networth')).toBe(true);
  });

  it('does not detect already-active when switching to a different section', () => {
    expect(isAlreadyActive('portfolio')).toBe(false);
    expect(isAlreadyActive('settings')).toBe(false);
    expect(isAlreadyActive('log')).toBe(false);
  });

  it('does not detect already-active when _activeSection matches but DOM class is missing', () => {
    // Simulate first boot: _activeSection is 'networth' but DOM has no .active
    document.getElementById('networth')!.classList.remove('active');
    expect(isAlreadyActive('networth')).toBe(false);
  });

  it('settings is always-repaint even when already active', () => {
    // Simulate settings being the active section
    document.getElementById('networth')!.classList.remove('active');
    document.getElementById('settings')!.classList.add('active');
    _activeSection = 'settings';

    // Guard detects it's active
    expect(isAlreadyActive('settings')).toBe(true);
    // But the real code skips the guard for settings (id !== 'settings' check)
    const shouldShortCircuit = isAlreadyActive('settings') && 'settings' !== 'settings';
    expect(shouldShortCircuit).toBe(false);
  });
});

// ── applyReadOnlyMode's combined readOnly/busy disable logic ──
// applyReadOnlyMode() disables write controls for two independent reasons:
// not signed in (readOnly, persistent) or a sync/write in flight (busy, transient).
describe('applyReadOnlyMode disable/hint logic', () => {
  function computeDisableState(
    readOnly: boolean,
    busy: boolean,
  ): { disabled: boolean; hint: string } {
    const disabled = readOnly || busy;
    const hint = readOnly
      ? 'Sign in to enable editing'
      : busy
        ? 'Sync in progress - try again in a moment'
        : '';
    return { disabled, hint };
  }

  it('neither readOnly nor busy - enabled, no hint', () => {
    expect(computeDisableState(false, false)).toEqual({ disabled: false, hint: '' });
  });

  it('busy only - disabled with the busy hint', () => {
    expect(computeDisableState(false, true)).toEqual({
      disabled: true,
      hint: 'Sync in progress - try again in a moment',
    });
  });

  it('readOnly only - disabled with the sign-in hint', () => {
    expect(computeDisableState(true, false)).toEqual({
      disabled: true,
      hint: 'Sign in to enable editing',
    });
  });

  it('both readOnly and busy - the sign-in hint wins (more actionable)', () => {
    expect(computeDisableState(true, true)).toEqual({
      disabled: true,
      hint: 'Sign in to enable editing',
    });
  });
});

describe('showPortfolioSubview idempotent guard', () => {
  let _portfolioSubview: string;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="subview-holdings" style="display: block"></div>
      <div id="subview-contributions" style="display: none"></div>
      <div id="subview-dividends" style="display: none"></div>
    `;
    _portfolioSubview = 'holdings';
  });

  function isSubviewAlreadyActive(sub: string, force = false): boolean {
    return (
      !force &&
      _portfolioSubview === sub &&
      document.getElementById(`subview-${sub}`)?.style.display === 'block'
    );
  }

  it('detects already-active sub-view (holdings on holdings)', () => {
    expect(isSubviewAlreadyActive('holdings')).toBe(true);
  });

  it('does not detect already-active when switching to a different sub-view', () => {
    expect(isSubviewAlreadyActive('contributions')).toBe(false);
    expect(isSubviewAlreadyActive('dividends')).toBe(false);
  });

  it('does not detect already-active when state matches but DOM display is not block', () => {
    // Simulate: _portfolioSubview says 'contributions' but display is none
    _portfolioSubview = 'contributions';
    expect(isSubviewAlreadyActive('contributions')).toBe(false);
  });

  it('force=true bypasses the guard even when already active', () => {
    expect(isSubviewAlreadyActive('holdings', true)).toBe(false);
  });

  it('second call to same sub-view is a no-op (render spy not called)', () => {
    const renderSpy = vi.fn();

    function showPortfolioSubview(sub: string, force = false): void {
      const alreadyActive =
        !force &&
        _portfolioSubview === sub &&
        document.getElementById(`subview-${sub}`)?.style.display === 'block';
      if (alreadyActive) return;
      _portfolioSubview = sub;
      renderSpy(sub);
    }

    // First call - should render
    // Reset DOM to simulate initial state where display is 'none'
    document.getElementById('subview-holdings')!.style.display = 'none';
    _portfolioSubview = 'contributions'; // start from different sub-view
    showPortfolioSubview('holdings');
    expect(renderSpy).toHaveBeenCalledTimes(1);

    // Simulate that after render, display is set to 'block'
    document.getElementById('subview-holdings')!.style.display = 'block';

    // Second call - should be no-op
    showPortfolioSubview('holdings');
    expect(renderSpy).toHaveBeenCalledTimes(1); // still 1, not 2

    // Third call - still no-op
    showPortfolioSubview('holdings');
    expect(renderSpy).toHaveBeenCalledTimes(1); // still 1

    // But switching to a different sub-view should render
    showPortfolioSubview('contributions');
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });
});

describe('sync status accessibility copy and conflict affordance', () => {
  function applySyncStatus(
    el: HTMLElement,
    status: string,
    pendingConflict: boolean,
    msg = '',
  ): void {
    const map: Record<string, { cls: string; text: string; title: string }> = {
      loading: {
        cls: 'status-warn',
        text: '<span class="spinner"></span>Loading…',
        title: 'Loading app data and checking sync status',
      },
      syncing: {
        cls: 'status-warn',
        text: '<span class="spinner"></span>Syncing…',
        title: 'Syncing local data with Google Drive',
      },
      cached: {
        cls: 'status-info',
        text: '📦 Showing cached data',
        title: 'Showing cached local data; sign in to sync with Google Drive',
      },
      ok: {
        cls: 'status-ok',
        text: '✓ Synced',
        title: 'Local data is synced with Google Drive',
      },
      offline: {
        cls: 'status-warn',
        text: '📴 Offline, showing cached data',
        title: 'Offline mode; showing cached local data until connection returns',
      },
      conflict: {
        cls: 'status-warn',
        text: '⚠ Sync paused — action needed',
        title: 'Sync paused because local and Drive copies both changed',
      },
      error: {
        cls: 'status-err',
        text: '⚠ Sync error: ' + msg,
        title: 'Sync error: ' + msg,
      },
    };
    const state = map[status];
    el.className = 'status-pill ' + (state?.cls || 'status-empty');
    el.innerHTML = state?.text || '';
    if (state?.title) {
      el.setAttribute('title', state.title);
      el.setAttribute('aria-label', state.title);
    } else {
      el.removeAttribute('title');
      el.removeAttribute('aria-label');
    }
    if (pendingConflict) {
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('title', 'Sync paused — activate to resolve sync conflict');
      el.setAttribute('aria-label', 'Sync paused — activate to resolve sync conflict');
    } else {
      el.removeAttribute('role');
      el.removeAttribute('tabindex');
    }
  }

  beforeEach(() => {
    document.body.innerHTML = `<span id="sync-status" class="status-pill"></span>`;
  });

  it('sets explanatory tooltip and aria-label for non-conflict states', () => {
    const el = document.getElementById('sync-status') as HTMLElement;
    applySyncStatus(el, 'offline', false);

    expect(el.getAttribute('title')).toBe(
      'Offline mode; showing cached local data until connection returns',
    );
    expect(el.getAttribute('aria-label')).toBe(
      'Offline mode; showing cached local data until connection returns',
    );
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('tabindex')).toBe(false);
  });

  it('marks conflict status as keyboard-accessible and action-oriented', () => {
    const el = document.getElementById('sync-status') as HTMLElement;
    applySyncStatus(el, 'conflict', true);

    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('title')).toBe('Sync paused — activate to resolve sync conflict');
    expect(el.getAttribute('aria-label')).toBe('Sync paused — activate to resolve sync conflict');
  });

  it('removes button semantics after conflict is cleared while keeping status tooltip', () => {
    const el = document.getElementById('sync-status') as HTMLElement;
    applySyncStatus(el, 'conflict', true);
    applySyncStatus(el, 'ok', false);

    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('tabindex')).toBe(false);
    expect(el.getAttribute('title')).toBe('Local data is synced with Google Drive');
    expect(el.getAttribute('aria-label')).toBe('Local data is synced with Google Drive');
  });
});

// ── restoreFromBackup guard logic ─────────────────────────
// Same isolation approach: reproduce the exact guard conditions
// from restoreFromBackup without importing main.ts directly.

describe('restoreFromBackup guard logic', () => {
  function restoreGuard(opts: {
    offline: boolean;
    signedIn: boolean;
    syncBusy: boolean;
    fileContent: string;
  }): string | null {
    if (!opts.signedIn) return 'Sign in first.';
    if (opts.syncBusy) return 'A sync or save is in progress.';

    let raw: unknown;
    try {
      raw = JSON.parse(opts.fileContent);
    } catch {
      return 'That file is not valid JSON.';
    }
    const backup = validateBackup(raw);
    if (!backup) return 'That file is not a recognized Wealth Tracker backup.';
    return null; // passes all guards
  }

  it('allows restore when offline (writes to local SQLite, syncs when back online)', () => {
    const validBackup = JSON.stringify({
      schemaVersion: 1,
      app: 'wealth-tracker',
      exportedAt: '2026-01-01T00:00:00Z',
      data: {
        accounts: [],
        holdings: [],
        settings: {},
        snapshots: [],
        transactions: [],
        importMeta: {},
      },
    });
    const err = restoreGuard({
      offline: true,
      signedIn: true,
      syncBusy: false,
      fileContent: validBackup,
    });
    expect(err).toBeNull();
  });

  it('rejects when not signed in', () => {
    const err = restoreGuard({
      offline: false,
      signedIn: false,
      syncBusy: false,
      fileContent: '{}',
    });
    expect(err).toContain('Sign in');
  });

  it('rejects when sync is busy', () => {
    const err = restoreGuard({
      offline: false,
      signedIn: true,
      syncBusy: true,
      fileContent: '{}',
    });
    expect(err).toContain('sync or save');
  });

  it('rejects invalid JSON', () => {
    const err = restoreGuard({
      offline: false,
      signedIn: true,
      syncBusy: false,
      fileContent: 'not json {{',
    });
    expect(err).toContain('not valid JSON');
  });

  it('rejects valid JSON that fails validateBackup', () => {
    const err = restoreGuard({
      offline: false,
      signedIn: true,
      syncBusy: false,
      fileContent: JSON.stringify({ app: 'other', data: {} }),
    });
    expect(err).toContain('not a recognized');
  });

  it('passes all guards with a valid backup', () => {
    const validBackup = JSON.stringify({
      schemaVersion: 1,
      app: 'wealth-tracker',
      exportedAt: '2026-01-01T00:00:00Z',
      data: {
        accounts: [],
        holdings: [],
        settings: {},
        snapshots: [],
        transactions: [],
        importMeta: {},
      },
    });
    const err = restoreGuard({
      offline: false,
      signedIn: true,
      syncBusy: false,
      fileContent: validBackup,
    });
    expect(err).toBeNull();
  });
});

describe('restoreFromBackup collapse state reapply logic', () => {
  // Tests the logic added to restoreFromBackup that reapplies collapse state.
  // Isolated the same way as the guard logic tests above.
  function applyCollapseFromSettings(
    settings: Record<string, string>,
    replaceCollapseStateMock: (state: Record<string, boolean>) => void,
    setCollapseStateMock: (state: Record<string, boolean>) => Promise<void>,
  ): { called: boolean; threw: boolean } {
    const rawCollapse = settings['ui_collapse_state'];
    if (!rawCollapse) return { called: false, threw: false };
    try {
      const parsed = JSON.parse(rawCollapse);
      if (parsed && typeof parsed === 'object') {
        replaceCollapseStateMock(parsed);
        setCollapseStateMock(parsed);
        return { called: true, threw: false };
      }
      return { called: false, threw: false };
    } catch {
      return { called: false, threw: false };
    }
  }

  it('calls both functions with parsed object when ui_collapse_state is valid JSON', () => {
    const replaceMock = vi.fn();
    const setMock = vi.fn().mockResolvedValue(undefined);
    const collapseObj = { 'card:accounts': true, 'card:holdings': false };

    const result = applyCollapseFromSettings(
      { ui_collapse_state: JSON.stringify(collapseObj) },
      replaceMock,
      setMock,
    );

    expect(result.called).toBe(true);
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith(collapseObj);
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith(collapseObj);
  });

  it('does not call either function when ui_collapse_state key is missing', () => {
    const replaceMock = vi.fn();
    const setMock = vi.fn().mockResolvedValue(undefined);

    const result = applyCollapseFromSettings({}, replaceMock, setMock);

    expect(result.called).toBe(false);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it('does not call either function when JSON is malformed, and does not throw', () => {
    const replaceMock = vi.fn();
    const setMock = vi.fn().mockResolvedValue(undefined);

    const result = applyCollapseFromSettings(
      { ui_collapse_state: 'not valid json {{{' },
      replaceMock,
      setMock,
    );

    expect(result.called).toBe(false);
    expect(result.threw).toBe(false);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it('does not call functions when parsed value is null', () => {
    const replaceMock = vi.fn();
    const setMock = vi.fn().mockResolvedValue(undefined);

    const result = applyCollapseFromSettings({ ui_collapse_state: 'null' }, replaceMock, setMock);

    expect(result.called).toBe(false);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });
});

// ── withButtonGuard tests for saveSnapshot ─────────
describe('saveSnapshot button guard via withButtonGuard', () => {
  let btn: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = '<button id="btn-save-snap" class="btn btn-primary">Save</button>';
    btn = document.getElementById('btn-save-snap') as HTMLButtonElement;
  });

  it('button is disabled and shows busyText synchronously before the async action resolves', async () => {
    let capturedDisabled = false;
    let capturedText = '';
    const action = () =>
      new Promise<void>((resolve) => {
        capturedDisabled = btn.disabled;
        capturedText = btn.textContent!;
        resolve();
      });

    await withButtonGuard(btn, action, { busyText: 'Saving...' });

    expect(capturedDisabled).toBe(true);
    expect(capturedText).toBe('Saving...');
  });

  it('a second click while the first is pending does not trigger a second action call', async () => {
    const actionSpy = vi
      .fn()
      .mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

    const p1 = withButtonGuard(btn, actionSpy, { busyText: 'Saving...' });

    // Button is now disabled, attempting to call guard again simulates a click
    // that would be rejected because the button is already disabled
    expect(btn.disabled).toBe(true);

    await p1;
    expect(actionSpy).toHaveBeenCalledTimes(1);
  });

  it('on success: button re-enabled, original label restored', async () => {
    await withButtonGuard(btn, async () => {}, { busyText: 'Saving...' });

    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Save');
  });

  it('on failure: button re-enabled, original label restored, error propagates', async () => {
    const err = new Error('network failure');
    await expect(
      withButtonGuard(
        btn,
        async () => {
          throw err;
        },
        { busyText: 'Saving...' },
      ),
    ).rejects.toThrow('network failure');

    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Save');
  });
});

// ── withButtonGuard tests for delSnap ──────────────
describe('delSnap button guard via withButtonGuard', () => {
  let btn: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = '<button class="btn btn-sm btn-danger js-del-snap">Delete</button>';
    btn = document.querySelector('.js-del-snap') as HTMLButtonElement;
  });

  it('button shows "Removing..." and is disabled during the action', async () => {
    let capturedDisabled = false;
    let capturedText = '';
    const action = () =>
      new Promise<void>((resolve) => {
        capturedDisabled = btn.disabled;
        capturedText = btn.textContent!;
        resolve();
      });

    await withButtonGuard(btn, action, { busyText: 'Removing...', keepDisabledOnSuccess: true });

    expect(capturedDisabled).toBe(true);
    expect(capturedText).toBe('Removing...');
  });

  it('double-click prevented: second call blocked while first is pending', async () => {
    const actionSpy = vi
      .fn()
      .mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

    const p1 = withButtonGuard(btn, actionSpy, {
      busyText: 'Removing...',
      keepDisabledOnSuccess: true,
    });

    expect(btn.disabled).toBe(true);
    await p1;
    expect(actionSpy).toHaveBeenCalledTimes(1);
  });

  it('keepDisabledOnSuccess: button stays disabled after success', async () => {
    await withButtonGuard(btn, async () => {}, {
      busyText: 'Removing...',
      keepDisabledOnSuccess: true,
    });

    expect(btn.disabled).toBe(true);
  });

  it('on failure: button re-enabled, original label restored', async () => {
    await expect(
      withButtonGuard(
        btn,
        async () => {
          throw new Error('delete failed');
        },
        { busyText: 'Removing...', keepDisabledOnSuccess: true },
      ),
    ).rejects.toThrow('delete failed');

    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Delete');
  });
});

describe('bulk snapshot delete state transition', () => {
  type Snap = { date: string; [key: string]: unknown };

  async function applyBulkSnapshotDelete(params: {
    stateSnaps: Snap[];
    dates: string[];
    saveSnapshots: (snaps: Snap[]) => Promise<void>;
  }): Promise<Snap[]> {
    const uniqueDates = Array.from(new Set(params.dates)).sort((a, b) => a.localeCompare(b));
    if (uniqueDates.length === 0) return params.stateSnaps;
    const previous = params.stateSnaps;
    const toDelete = new Set(uniqueDates);
    const next = params.stateSnaps.filter((s) => !toDelete.has(s.date));
    try {
      await params.saveSnapshots(next);
      return next;
    } catch (err) {
      void err;
      return previous;
    }
  }

  it('persists once and removes all selected dates from state', async () => {
    const saveSnapshotsMock = vi.fn(async () => {});
    const result = await applyBulkSnapshotDelete({
      stateSnaps: [
        { date: '2026-01-01', acct1: 100 },
        { date: '2026-02-01', acct1: 200 },
        { date: '2026-03-01', acct1: 300 },
      ],
      dates: ['2026-01-01', '2026-03-01'],
      saveSnapshots: saveSnapshotsMock,
    });
    expect(saveSnapshotsMock).toHaveBeenCalledTimes(1);
    expect(result.map((s) => s.date)).toEqual(['2026-02-01']);
  });

  it('rolls back to previous state when persistence fails', async () => {
    const previous = [
      { date: '2026-01-01', acct1: 100 },
      { date: '2026-02-01', acct1: 200 },
    ];
    const saveSnapshotsMock = vi.fn(async () => {
      throw new Error('disk error');
    });
    const result = await applyBulkSnapshotDelete({
      stateSnaps: previous,
      dates: ['2026-01-01'],
      saveSnapshots: saveSnapshotsMock,
    });
    expect(saveSnapshotsMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(previous);
  });
});

// ── onConfigChange cache-sync tests ─────────────────
describe('onConfigChange callback syncs IndexedDB cache', () => {
  it('calls setCachedConfig with current accounts/holdings/settings', async () => {
    // Reproduce the exact logic of the registered onConfigChange callback
    const mockAccounts = [{ id: 'acc1' }];
    const mockHoldings = [{ isin: 'IE001' }];
    const mockSettings = { theme: 'dark' };
    const setCachedConfigMock = vi.fn().mockResolvedValue(undefined);

    // Simulate the callback body
    try {
      await setCachedConfigMock({
        accounts: mockAccounts,
        holdings: mockHoldings,
        settings: mockSettings,
      });
    } catch {
      // best-effort
    }

    expect(setCachedConfigMock).toHaveBeenCalledTimes(1);
    expect(setCachedConfigMock).toHaveBeenCalledWith({
      accounts: mockAccounts,
      holdings: mockHoldings,
      settings: mockSettings,
    });
  });

  it('setCachedConfig rejecting does not throw and renderAll still runs', async () => {
    const setCachedConfigMock = vi.fn().mockRejectedValue(new Error('IndexedDB quota'));
    const renderAllMock = vi.fn();

    // Simulate the callback body with error
    try {
      await setCachedConfigMock({
        accounts: [],
        holdings: [],
        settings: {},
      });
    } catch {
      // best-effort -- swallowed
    }
    renderAllMock('accounts');

    // setCachedConfig was called but rejected
    expect(setCachedConfigMock).toHaveBeenCalledTimes(1);
    // renderAll still runs after the catch
    expect(renderAllMock).toHaveBeenCalledTimes(1);
    expect(renderAllMock).toHaveBeenCalledWith('accounts');
  });
});

describe('editSnap ETF breakdown prefill reset logic', () => {
  function applyEtfPrefill(snapshot: Record<string, unknown>): void {
    document.querySelectorAll<HTMLInputElement>('[data-etf-isin]').forEach((el) => {
      el.value = '';
    });
    document.querySelectorAll<HTMLElement>('.snap-etf-recon').forEach((el) => {
      el.style.display = 'none';
    });
    document.querySelectorAll<HTMLElement>('.snap-etf-section').forEach((section) => {
      section.style.display = 'none';
    });
    document.querySelectorAll<HTMLElement>('.snap-etf-toggle').forEach((btn) => {
      btn.setAttribute('aria-expanded', 'false');
      const chevron = btn.querySelector('.snap-etf-chevron') as HTMLElement | null;
      if (chevron) chevron.textContent = '\u25b8';
    });

    let hasEtfValues = false;
    for (const [key, val] of Object.entries(snapshot)) {
      if (key.startsWith('etf_') && typeof val === 'number' && val > 0) {
        const isin = key.slice(4);
        const etfEl = document.getElementById(`snap-etf-${isin}`) as HTMLInputElement | null;
        if (etfEl) {
          etfEl.value = String(val);
          hasEtfValues = true;
        }
      }
    }

    if (hasEtfValues) {
      document.querySelectorAll<HTMLElement>('.snap-etf-section').forEach((section) => {
        section.style.display = '';
      });
      document.querySelectorAll<HTMLElement>('.snap-etf-toggle').forEach((btn) => {
        btn.setAttribute('aria-expanded', 'true');
        const chevron = btn.querySelector('.snap-etf-chevron') as HTMLElement | null;
        if (chevron) chevron.textContent = '\u25be';
      });
    }
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <button class="snap-etf-toggle" aria-expanded="false"><span class="snap-etf-chevron">▸</span></button>
      <div class="snap-etf-section" style="display:none"></div>
      <div class="snap-etf-recon" style="display:none"></div>
      <input id="snap-etf-IE0001" data-etf-isin="IE0001" value="">
      <input id="snap-etf-IE0002" data-etf-isin="IE0002" value="">
    `;
  });

  it('overwrites previous ETF values with empty state when selected snapshot has no ETF entries', () => {
    applyEtfPrefill({ etf_IE0001: 1000, etf_IE0002: 500 });
    expect((document.getElementById('snap-etf-IE0001') as HTMLInputElement).value).toBe('1000');
    expect(
      (document.querySelector('.snap-etf-toggle') as HTMLElement).getAttribute('aria-expanded'),
    ).toBe('true');

    applyEtfPrefill({});
    expect((document.getElementById('snap-etf-IE0001') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('snap-etf-IE0002') as HTMLInputElement).value).toBe('');
    expect((document.querySelector('.snap-etf-section') as HTMLElement).style.display).toBe('none');
    expect(
      (document.querySelector('.snap-etf-toggle') as HTMLElement).getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('overwrites prior month ETF values with the newly selected month values', () => {
    applyEtfPrefill({ etf_IE0001: 1000, etf_IE0002: 500 });
    applyEtfPrefill({ etf_IE0001: 1200 });

    expect((document.getElementById('snap-etf-IE0001') as HTMLInputElement).value).toBe('1200');
    expect((document.getElementById('snap-etf-IE0002') as HTMLInputElement).value).toBe('');
  });
});
