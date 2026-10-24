import { esc, fmtMon } from '../../utils';
import { addMonths, timeToMonth } from './format';
import type { RangePreset } from './registry';

type AxisParam = {
  marker?: unknown;
  seriesName?: string;
  value?: unknown;
  data?: unknown;
  axisValue?: unknown;
  axisValueLabel?: string;
  axisType?: string;
};

/** 1Y / 3Y / All presets ending at the last month timestamp (time axes). */
export function monthPresets(last: number): RangePreset[] {
  return [
    { key: '12', label: '1Y', startValue: addMonths(last, -11), endValue: last },
    { key: '36', label: '3Y', startValue: addMonths(last, -35), endValue: last },
    { key: 'all', label: 'All' },
  ];
}

/** Monthly time x-axis: month/year tick labels, `Jan 2026` crosshair label. */
export function monthTimeAxis(extra: Record<string, unknown> = {}) {
  return {
    type: 'time' as const,
    boundaryGap: ['0%', '0%'] as [string, string],
    // Data is monthly: never let ECharts fall back to day ticks (which repeat month names).
    minInterval: 28 * 86_400_000,
    axisLabel: { formatter: { year: '{yyyy}', month: '{MMM}', day: '{MMM}' } },
    axisPointer: { label: { formatter: (p: { value: unknown }) => monthLabel(p.value) } },
    ...extra,
  };
}

function monthLabel(v: unknown): string {
  return typeof v === 'number' ? fmtMon(timeToMonth(v)) : String(v ?? '');
}

function rawValue(p: AxisParam): number {
  const v = p.value;
  if (Array.isArray(v)) return Number(v[v.length - 1]);
  return Number(v);
}

/**
 * Axis tooltip formatter with escaped series names, per-series value formatting and an optional
 * footer row (e.g. stack total). Mirrors the default ECharts tooltip layout.
 */
export function axisTooltip(opts: {
  value: (v: number, seriesName: string) => string;
  footer?: (values: number[]) => { label: string; value: string } | null;
  /** Free-text note for the hovered axis value (escaped). */
  note?: (axisValue: unknown) => string | null | undefined;
  /** Skip rows whose value is 0 (e.g. stacked series with no data that month). */
  hideZero?: boolean;
}) {
  return (raw: unknown): string => {
    const params = (Array.isArray(raw) ? raw : [raw]) as AxisParam[];
    if (!params.length) return '';
    const first = params[0];
    const title =
      first.axisType === 'xAxis.time' || typeof first.axisValue === 'number'
        ? monthLabel(first.axisValue)
        : esc(String(first.axisValueLabel ?? first.axisValue ?? ''));
    const rows = params
      .filter(
        (p) =>
          p.value != null && !Number.isNaN(rawValue(p)) && !(opts.hideZero && rawValue(p) === 0),
      )
      .map(
        (p) =>
          `<div class="ec-tt-row">${typeof p.marker === 'string' ? p.marker : ''}<span class="ec-tt-name">${esc(
            p.seriesName ?? '',
          )}</span><span class="ec-tt-val">${esc(opts.value(rawValue(p), p.seriesName ?? ''))}</span></div>`,
      )
      .join('');
    const values = params.map(rawValue).filter((n) => !Number.isNaN(n));
    const f = opts.footer?.(values);
    const foot = f
      ? `<div class="ec-tt-row ec-tt-foot"><span class="ec-tt-name">${esc(f.label)}</span><span class="ec-tt-val">${esc(f.value)}</span></div>`
      : '';
    const noteText = opts.note?.(first.axisValue);
    const note = noteText ? `<div class="ec-tt-note">${esc(noteText)}</div>` : '';
    return `<div class="ec-tt"><div class="ec-tt-title">${title}</div>${rows}${foot}${note}</div>`;
  };
}
