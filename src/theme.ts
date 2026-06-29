/** Single source of truth for chart colours — mirrors the CSS :root tokens in styles.css. */
export const T = {
  bg: '#f8f8f6', surface: '#fff', surface3: '#f1efe8',
  ink: '#0b0b0b', ink2: '#52514e', ink3: '#6b6a65', ink4: '#898781',
  line: '#e1e0d9', line2: '#d3d1c7',
  brand: '#185FA5', brandBorder: '#378ADD', brandWeak: '#e6f1fb', brandChart: '#2a78d6',
  pos: '#0F6E56', neg: '#A32D2D', warn: '#BA7517', white: '#fff',
} as const;

/** Runtime-resolved theme context — returns current token set (supports future dark mode). */
export function resolvedT(): typeof T { return T; }

/** Standard Chart.js axis/grid styling so views don't re-type it. */
export const chartAxis = {
  grid: { color: T.line },
  ticks: { color: T.ink4 },
};
