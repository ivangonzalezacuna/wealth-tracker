/** Single source of truth for chart colours — mirrors the CSS :root tokens in styles.css. */
export const T = {
  bg: '#f5f4f0', surface: '#fff', surface3: '#f0ede6',
  ink: '#0b0b0b', ink2: '#52514e', ink3: '#6b6a65', ink4: '#898781',
  line: '#e0ddd6', line2: '#ccc9c0',
  brand: '#185FA5', brandBorder: '#378ADD', brandWeak: '#e6f1fb', brandChart: '#2a78d6',
  pos: '#0F6E56', neg: '#A32D2D', warn: '#BA7517', white: '#fff',
} as const;

/** Standard Chart.js axis/grid styling so views don't re-type it. */
export const chartAxis = {
  grid: { color: T.line },
  ticks: { color: T.ink4 },
};

/** Runtime dark-mode resolution for Chart.js context at render-time. */
export function resolvedT(): Record<keyof typeof T, string> {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (!dark) return T;
  return {
    ...T,
    bg: '#141210', surface: '#1d1b18', surface3: '#2a2825', line: '#302e2b', line2: '#3d3b37',
    ink: '#f2f0ec', ink2: '#b8b5ae', ink3: '#8a8780', ink4: '#5c5a55',
    brand: '#4e9de0', brandBorder: '#3a7fc7', brandWeak: '#1a2e42', brandChart: '#4e9de0',
    pos: '#2db88a', neg: '#e06060', warn: '#d4a020', white: '#fff',
  };
}
