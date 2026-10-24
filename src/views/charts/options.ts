import { esc, fmtMon } from '../../utils';
import { timeToMonth } from './format';

/**
 * Series whose id starts with `_` are drawing helpers (e.g. the stacked layers of a shaded band):
 * they stay out of the legend, tooltip and data table.
 */
export function isHelperSeries(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith('_');
}

type AxisParam = {
  marker?: unknown;
  seriesId?: string;
  seriesName?: string;
  value?: unknown;
  data?: unknown;
  axisValue?: unknown;
  axisValueLabel?: string;
  axisType?: string;
};

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
  /** Drill-down affordance shown under the rows (see `drillHint`). */
  hint?: TooltipHint;
}) {
  return (raw: unknown): string => {
    const params = ((Array.isArray(raw) ? raw : [raw]) as AxisParam[]).filter(
      (p) => !isHelperSeries(p.seriesId),
    );
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
    return `<div class="ec-tt"><div class="ec-tt-title">${title}</div>${rows}${foot}${note}${tooltipHint(opts.hint)}</div>`;
  };
}

/** Plain footer text, or (touch) a button that opens the drill-down target. */
export type TooltipHint = string | { button: string };

/** Tooltip footer for drill-down charts. */
export function tooltipHint(hint: TooltipHint | undefined): string {
  if (!hint) return '';
  if (typeof hint === 'string') return `<div class="ec-tt-hint">${esc(hint)}</div>`;
  return `<div class="ec-tt-hint"><button type="button" class="ec-tt-action" data-chart-drill>${esc(
    hint.button,
  )}<span aria-hidden="true"> ›</span></button></div>`;
}

/**
 * Pointer devices: "Click to …" (a click in the plot opens it). Touch: a tap only shows the
 * tooltip, whose button opens the target, so scrolling past a chart never navigates away.
 */
export function drillHint(ctx: { touch: boolean }, action: string): TooltipHint {
  return ctx.touch
    ? { button: action.charAt(0).toUpperCase() + action.slice(1) }
    : `Click to ${action}`;
}
