/** Single source of truth for chart colours - mirrors the CSS :root tokens in styles.css. */
export const T = {
  bg: '#f5f4f0',
  surface: '#fff',
  surface3: '#f0ede6',
  ink: '#0b0b0b',
  ink2: '#52514e',
  ink3: '#6b6a65',
  ink4: '#898781',
  line: '#e0ddd6',
  line2: '#ccc9c0',
  brand: '#185FA5',
  brandBorder: '#378ADD',
  brandWeak: '#e6f1fb',
  brandChart: '#2a78d6',
  pos: '#0F6E56',
  neg: '#A32D2D',
  warn: '#BA7517',
  white: '#fff',
} as const;

/** Runtime dark-mode resolution for Chart.js context at render-time. */
export function resolvedT(): Record<keyof typeof T, string> {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (!dark) return T;
  return {
    ...T,
    bg: '#141210',
    surface: '#1d1b18',
    surface3: '#2a2825',
    line: '#302e2b',
    line2: '#3d3b37',
    ink: '#f2f0ec',
    ink2: '#b8b5ae',
    ink3: '#8a8780',
    ink4: '#5c5a55',
    brand: '#4e9de0',
    brandBorder: '#3a7fc7',
    brandWeak: '#1a2e42',
    brandChart: '#4e9de0',
    pos: '#2db88a',
    neg: '#e06060',
    warn: '#d4a020',
    white: '#fff',
  };
}

// ── Live OS/browser theme-change notification ────────────────────
// resolvedT() is only read at render time, so CSS (media-query driven)
// re-themes instantly on an OS dark/light switch while Chart.js canvases
// - which bake colors into the canvas at creation time - would otherwise
// stay stale until the next unrelated re-render. This lets callers (main.ts)
// subscribe once and trigger a re-render whenever the OS scheme flips.
type ThemeChangeListener = () => void;
const _themeListeners = new Set<ThemeChangeListener>();
let _mq: MediaQueryList | null = null;

function _ensureMediaQueryListener(): void {
  if (_mq || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  _mq = window.matchMedia('(prefers-color-scheme: dark)');
  const notify = () => {
    for (const fn of _themeListeners) fn();
  };
  // addEventListener is the modern API; Safari <14 only has the deprecated
  // addListener, so fall back for older engines still in the wild.
  if (typeof _mq.addEventListener === 'function') {
    _mq.addEventListener('change', notify);
  } else if (
    typeof (_mq as unknown as { addListener?: (fn: () => void) => void }).addListener === 'function'
  ) {
    (_mq as unknown as { addListener: (fn: () => void) => void }).addListener(notify);
  }
}

/** Subscribe to OS/browser dark-mode changes. Returns an unsubscribe function. */
export function onThemeChange(fn: ThemeChangeListener): () => void {
  _ensureMediaQueryListener();
  _themeListeners.add(fn);
  return () => _themeListeners.delete(fn);
}

/** Exported only for tests - clears listener state between test cases. */
export function _resetThemeListenersForTests(): void {
  _themeListeners.clear();
  _mq = null;
}
