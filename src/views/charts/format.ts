const COMPACT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
});

/** Compact euro axis label: `950 €`, `1.2k €`, `120k €`, `1.3M €`; U+2212 for negatives. */
export function fmtEurCompact(value: number): string {
  const n = Number(value);
  if (!isFinite(n)) return '–';
  if (n === 0) return '0\u00A0€';
  const body = COMPACT.format(Math.abs(n)).replace('K', 'k');
  return `${n < 0 ? '\u2212' : ''}${body}\u00A0€`;
}

/** Axis percent label without decimals for whole values: `-12%`, `4.5%`. */
export function fmtPctAxis(value: number): string {
  const n = Number(value);
  if (!isFinite(n)) return '–';
  const r = Math.round(n * 10) / 10;
  const body = Math.abs(r) % 1 === 0 ? Math.abs(r).toFixed(0) : Math.abs(r).toFixed(1);
  return `${r < 0 ? '\u2212' : ''}${body}%`;
}

/** `YYYY-MM` (or `YYYY-MM-DD`) → UTC timestamp of the first day of that month. */
export function monthToTime(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, 1);
}

/** UTC timestamp → `YYYY-MM`. */
export function timeToMonth(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Shift a month timestamp by N months (negative = back in time). */
export function addMonths(t: number, months: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
}

/** The `YYYY-MM` entry of `months` closest to timestamp `t` (null when empty). */
export function nearestMonth(t: number, months: readonly string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const m of months) {
    const dist = Math.abs(monthToTime(m) - t);
    if (dist < bestDist) {
      best = m;
      bestDist = dist;
    }
  }
  return best;
}

const MONTH_MS = 30.436875 * 86_400_000;

/**
 * Forecast horizon shown by a zoom window: whole years from `from` (last actual month) to the
 * window end, clamped to 1 year … `maxMonths`.
 */
export function horizonMonths(from: number, to: number, maxMonths: number): number {
  const years = Math.round((to - from) / MONTH_MS / 12);
  return Math.min(Math.max(1, years), Math.floor(maxMonths / 12)) * 12;
}

/** `60` → `5 years`, `12` → `1 year`. */
export function horizonLabel(months: number): string {
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? '' : 's'}`;
}
