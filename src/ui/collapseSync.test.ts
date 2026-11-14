import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettings, setSetting } from '../store/config';
import { getCollapseSnapshot, isCollapseStateLoaded, replaceCollapseState } from './collapseState';
import { backupCollapseToSettings, restoreCollapseFromSettings } from './collapseSync';

vi.mock('../store/config', () => ({
  getSettings: vi.fn(),
  setSetting: vi.fn(),
}));
vi.mock('./collapseState', () => ({
  getCollapseSnapshot: vi.fn(),
  isCollapseStateLoaded: vi.fn(),
  replaceCollapseState: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isCollapseStateLoaded).mockReturnValue(true);
  vi.mocked(getCollapseSnapshot).mockReturnValue({});
  vi.mocked(getSettings).mockReturnValue({});
  vi.mocked(setSetting).mockResolvedValue(undefined);
});

describe('synced collapse preferences', () => {
  it('restores saved preferences only after local state has loaded and is empty', () => {
    const saved = { 'card:accounts': true };
    vi.mocked(getSettings).mockReturnValue({ ui_collapse_state: JSON.stringify(saved) });
    vi.mocked(isCollapseStateLoaded).mockReturnValue(false);
    expect(restoreCollapseFromSettings()).toBe(false);
    expect(replaceCollapseState).not.toHaveBeenCalled();

    vi.mocked(isCollapseStateLoaded).mockReturnValue(true);
    expect(restoreCollapseFromSettings()).toBe(true);
    expect(replaceCollapseState).toHaveBeenCalledExactlyOnceWith(saved);
  });

  it('keeps existing local preferences instead of overwriting them from sync', () => {
    vi.mocked(getCollapseSnapshot).mockReturnValue({ 'card:holdings': true });
    vi.mocked(getSettings).mockReturnValue({
      ui_collapse_state: '{"card:accounts":true}',
    });
    expect(restoreCollapseFromSettings()).toBe(false);
    expect(replaceCollapseState).not.toHaveBeenCalled();
  });

  it.each([undefined, '{', 'null', 'true'])(
    'does not replace preferences for missing or unreadable settings (%s)',
    (raw) => {
      vi.mocked(getSettings).mockReturnValue({ ui_collapse_state: raw });
      expect(restoreCollapseFromSettings()).toBe(false);
      expect(replaceCollapseState).not.toHaveBeenCalled();
    },
  );

  it('backs up changed preferences once and skips unchanged settings', async () => {
    const saved = { 'card:accounts': true };
    const json = JSON.stringify(saved);
    vi.mocked(getCollapseSnapshot).mockReturnValue(saved);
    await backupCollapseToSettings();
    expect(setSetting).toHaveBeenCalledExactlyOnceWith('ui_collapse_state', json);

    vi.mocked(getSettings).mockReturnValue({ ui_collapse_state: json });
    await backupCollapseToSettings();
    expect(setSetting).toHaveBeenCalledTimes(1);
  });
});
