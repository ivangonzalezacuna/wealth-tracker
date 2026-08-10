/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  T,
  resolvedT,
  onThemeChange,
  setUserTheme,
  getUserThemePref,
  _resetThemeListenersForTests,
} from './theme';

/** Minimal MediaQueryList mock supporting the modern addEventListener API. */
function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners: Array<() => void> = [];
  const mql = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, fn: () => void) => listeners.push(fn),
    removeEventListener: vi.fn(),
  };
  return {
    mql,
    setMatches(v: boolean) {
      matches = v;
      listeners.forEach((fn) => fn());
    },
  };
}

describe('resolvedT', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns light palette when prefers-color-scheme does not match', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(resolvedT()).toEqual(T);
  });

  it('returns dark palette when prefers-color-scheme matches', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const result = resolvedT();
    expect(result.bg).not.toBe(T.bg);
    expect(result.ink).not.toBe(T.ink);
  });
});

describe('onThemeChange', () => {
  beforeEach(() => {
    _resetThemeListenersForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetThemeListenersForTests();
  });

  it('notifies subscribers when the OS/browser color scheme changes', () => {
    const { mql, setMatches } = mockMatchMedia(false);
    vi.stubGlobal('matchMedia', () => mql);

    const fn = vi.fn();
    onThemeChange(fn);
    expect(fn).not.toHaveBeenCalled();

    setMatches(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('supports multiple independent subscribers', () => {
    const { mql, setMatches } = mockMatchMedia(false);
    vi.stubGlobal('matchMedia', () => mql);

    const a = vi.fn();
    const b = vi.fn();
    onThemeChange(a);
    onThemeChange(b);

    setMatches(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops further notifications for that listener', () => {
    const { mql, setMatches } = mockMatchMedia(false);
    vi.stubGlobal('matchMedia', () => mql);

    const fn = vi.fn();
    const unsubscribe = onThemeChange(fn);
    unsubscribe();

    setMatches(true);
    expect(fn).not.toHaveBeenCalled();
  });

  it('does nothing (no throw) when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(() => onThemeChange(vi.fn())).not.toThrow();
  });
});

describe('setUserTheme / getUserThemePref', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    _resetThemeListenersForTests();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetThemeListenersForTests();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('returns "system" when no preference is stored', () => {
    expect(getUserThemePref()).toBe('system');
  });

  it('persists the preference to localStorage and applies data-theme', () => {
    setUserTheme('dark');
    expect(getUserThemePref()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('sets data-theme="light" when light is chosen', () => {
    setUserTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('notifies theme-change listeners when preference is set', () => {
    const fn = vi.fn();
    onThemeChange(fn);
    setUserTheme('dark');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resolvedT returns dark palette when user pref is "dark" regardless of OS', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }));
    setUserTheme('dark');
    const result = resolvedT();
    expect(result.bg).not.toBe(T.bg);
  });

  it('resolvedT returns light palette when user pref is "light" even if OS is dark', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn() }));
    setUserTheme('light');
    const result = resolvedT();
    expect(result.bg).toBe(T.bg);
  });
});
