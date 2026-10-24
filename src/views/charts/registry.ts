import type { ECElementEvent } from 'echarts/core';
import type { DataZoomComponentOption, GraphicComponentOption } from 'echarts/components';
import type { ChartInstance, ChartOption } from './core';
import { buildChartTheme, readChartTokens, type ChartTokens } from './theme';
import { buildToolbox, fullscreenIcons } from './toolbox';
import { fmtEur2, fmtMon } from '../../utils';
import { timeToMonth } from './format';

export interface RangePreset {
  key: string;
  label: string;
  /** Window start (axis value: timestamp for time axes, index/category for category axes). Omit for "all". */
  startValue?: number | string;
  endValue?: number | string;
}

export interface ChartCtx {
  tokens: ChartTokens;
  /** Narrow host (< 480px): fewer toolbox items, legend on its own row. */
  compact: boolean;
  /** Chart is in fullscreen / expanded overlay mode. */
  expanded: boolean;
  /** Coarse pointer (touch): in-page gestures stay with the page. */
  touch: boolean;
  /** Host width in px (0 when not laid out yet). */
  width: number;
}

export interface RenderChartOpts {
  /** Range presets rendered as in-chart buttons; drive the dataZoom window. */
  presets?: RangePreset[];
  defaultPreset?: string;
  /** Add inside + slider dataZoom on the first x axis (zoom / pan / range slider). */
  zoom?: boolean;
  /** Hide the slider even when zoom is enabled. */
  slider?: boolean;
  /** Formatter for the data view table values. */
  valueFormatter?: (value: number) => string;
  /** Axis type of xAxis[0] — used to format slider labels. */
  xAxisType?: 'time' | 'category' | 'value';
  /** Connect hover/zoom with other charts in the same group. */
  group?: string;
  onClick?: (params: ECElementEvent) => void;
  /** Called when the active range preset changes (null after a manual zoom). */
  onPresetChange?: (key: string | null) => void;
  toolbox?: boolean;
}

interface Entry {
  id: string;
  host: HTMLElement;
  chart: ChartInstance;
  build: (ctx: ChartCtx) => ChartOption;
  opts: RenderChartOpts;
  activePreset: string | null;
  applyingPreset: boolean;
  /** Tighter preset buttons when the full-size row would collide with the toolbox. */
  densePresets: boolean;
  /** Horizontal space reserved beside a header legend (presets + toolbox); null when no header legend. */
  legendInset: number | null;
  toolboxW: number;
  ctx: ChartCtx;
  ro: ResizeObserver | null;
}

const registry = new Map<string, Entry>();
type EChartsNs = (typeof import('./core'))['echarts'];
let ec: EChartsNs | null = null;
let loading: Promise<void> | null = null;
/** Charts requested before the ECharts chunk finished loading (latest request per host id wins). */
const pending = new Map<string, { build: (ctx: ChartCtx) => ChartOption; opts: RenderChartOpts }>();

/** Load the ECharts chunk once (code-split from the app bundle). */
export function loadCharts(): Promise<void> {
  if (!loading) {
    loading = import('./core').then((m) => {
      ec = m.echarts;
      for (const [id, req] of [...pending]) {
        pending.delete(id);
        renderChart(id, req.build, req.opts);
      }
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}
const PRESET_H = 22;
const HEADER_GAP = 10;
const LEGEND_ROW = 26;

function mq(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

function isExpanded(host: HTMLElement): boolean {
  const fs = typeof document !== 'undefined' ? document.fullscreenElement : null;
  return Boolean((fs && fs.contains(host)) || host.closest('.chart-expanded'));
}

function makeCtx(host: HTMLElement): ChartCtx {
  const width = host.clientWidth || host.getBoundingClientRect().width || 0;
  return {
    tokens: readChartTokens(),
    compact: width > 0 && width < 480,
    expanded: isExpanded(host),
    touch: mq('(pointer: coarse)'),
    width,
  };
}

function presetWidth(label: string, dense = false): number {
  return dense ? Math.max(24, label.length * 6.5 + 8) : Math.max(30, label.length * 7 + 16);
}

function presetGap(dense: boolean): number {
  return dense ? 2 : 4;
}

function presetGraphic(entry: Entry): GraphicComponentOption {
  const t = entry.ctx.tokens;
  const presets = entry.opts.presets ?? [];
  const dense = entry.densePresets;
  let x = 0;
  const children = presets.map((p) => {
    const w = presetWidth(p.label, dense);
    const active = entry.activePreset === p.key;
    const el = {
      type: 'group' as const,
      id: `preset-${p.key}`,
      x,
      y: 0,
      onclick: () => applyPreset(entry, p.key),
      children: [
        {
          type: 'rect' as const,
          shape: { x: 0, y: 0, width: w, height: PRESET_H, r: 6 },
          style: {
            fill: active ? t.brandWeak : t.surface,
            stroke: active ? t.brandBorder : t.line2,
            lineWidth: 1,
          },
          cursor: 'pointer',
        },
        {
          type: 'text' as const,
          style: {
            text: p.label,
            x: w / 2,
            y: PRESET_H / 2,
            align: 'center' as const,
            verticalAlign: 'middle' as const,
            fill: active ? t.brandText : t.ink2,
            font: `${active ? 600 : 500} 11px ${t.fontFamily}`,
          },
          cursor: 'pointer',
        },
      ],
    };
    x += w + presetGap(dense);
    return el;
  });
  return {
    type: 'group',
    id: 'range-presets',
    left: 0,
    top: 0,
    children,
  } as GraphicComponentOption;
}

function presetsWidth(presets: RangePreset[], dense = false): number {
  return (
    presets.reduce((s, p) => s + presetWidth(p.label, dense), 0) +
    Math.max(0, presets.length - 1) * presetGap(dense)
  );
}

function windowFor(entry: Entry, key: string | null): Record<string, number | string> | null {
  if (key == null) return null;
  const p = entry.opts.presets?.find((x) => x.key === key);
  if (!p) return null;
  if (p.startValue == null && p.endValue == null) return { start: 0, end: 100 };
  const w: Record<string, number | string> = {};
  if (p.startValue != null) w.startValue = p.startValue;
  else w.start = 0;
  if (p.endValue != null) w.endValue = p.endValue;
  else w.end = 100;
  return w;
}

function applyPreset(entry: Entry, key: string): void {
  const win = windowFor(entry, key);
  if (!win) return;
  entry.activePreset = key;
  entry.applyingPreset = true;
  try {
    entry.chart.dispatchAction({ type: 'dataZoom', ...win });
  } finally {
    entry.applyingPreset = false;
  }
  syncPresetGraphic(entry);
  entry.opts.onPresetChange?.(key);
}

function syncPresetGraphic(entry: Entry): void {
  if (!entry.opts.presets?.length) return;
  entry.chart.setOption({ graphic: [presetGraphic(entry)] });
}

function sliderLabel(entry: Entry) {
  return (value: number, valueStr: string): string => {
    if (entry.opts.xAxisType === 'time') return fmtMon(timeToMonth(value));
    return valueStr;
  };
}

function zoomComponents(entry: Entry, bottom: number): DataZoomComponentOption[] {
  const { touch, expanded } = entry.ctx;
  const gestures = !touch || expanded;
  const win = windowFor(entry, entry.activePreset) ?? {};
  const out: DataZoomComponentOption[] = [
    {
      id: 'inside',
      type: 'inside',
      xAxisIndex: 0,
      filterMode: 'filter',
      disabled: !gestures,
      zoomOnMouseWheel: expanded ? true : 'ctrl',
      moveOnMouseWheel: false,
      moveOnMouseMove: true,
      preventDefaultMouseMove: !touch,
      ...win,
    },
  ];
  if (entry.opts.slider !== false) {
    out.push({
      id: 'slider',
      type: 'slider',
      xAxisIndex: 0,
      filterMode: 'filter',
      height: 18,
      bottom,
      brushSelect: false,
      labelFormatter: sliderLabel(entry) as unknown as string,
      ...win,
    });
  }
  return out;
}

/** Re-apply the user's manual zoom and legend selection after a rebuild (data or theme change). */
function preserveState(entry: Entry, next: ChartOption): void {
  const prev = entry.chart.getOption() as {
    dataZoom?: Array<{ id?: string; start?: number; end?: number }>;
    legend?: Array<{ selected?: Record<string, boolean> }>;
  } | null;
  if (!prev) return;
  if (entry.activePreset == null && Array.isArray(next.dataZoom)) {
    const dz = prev.dataZoom?.[0];
    if (dz && dz.start != null && dz.end != null) {
      for (const z of next.dataZoom as DataZoomComponentOption[]) {
        delete z.startValue;
        delete z.endValue;
        z.start = dz.start;
        z.end = dz.end;
      }
    }
  }
  const selected = prev.legend?.[0]?.selected;
  const legend = next.legend as { selected?: Record<string, boolean> } | undefined;
  if (selected && legend && !Array.isArray(legend)) {
    legend.selected = { ...selected, ...(legend.selected ?? {}) };
  }
}

function timeAriaDescription(
  label: string,
  series: ChartOption['series'],
  fmt: (value: number) => string,
): string {
  const list = (Array.isArray(series) ? series : series ? [series] : []) as Array<{
    name?: string;
    data?: unknown[];
  }>;
  const parts = list
    .map((s) => {
      const pts = (s.data ?? [])
        .map((d) => (Array.isArray(d) ? d : (d as { value?: unknown })?.value))
        .filter((p): p is [number, number] => Array.isArray(p) && typeof p[1] === 'number');
      if (!pts.length) return '';
      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      return `${s.name ?? 'Series'}: ${pts.length} points from ${fmtMon(timeToMonth(first[0]))} (${fmt(first[1])}) to ${fmtMon(timeToMonth(last[0]))} (${fmt(last[1])}).`;
    })
    .filter(Boolean);
  return [label ? `${label}.` : '', ...parts].filter(Boolean).join(' ');
}

function compose(entry: Entry): ChartOption {
  const { ctx, opts } = entry;
  const t = ctx.tokens;
  const option = entry.build(ctx);
  const presets = opts.presets ?? [];
  const valueFormatter = opts.valueFormatter ?? fmtEur2;
  const useToolbox = opts.toolbox !== false;
  const toolbox = useToolbox
    ? buildToolbox({
        id: entry.id,
        compact: ctx.compact && !ctx.expanded,
        zoom: Boolean(opts.zoom),
        valueFormatter,
        surface: t.surface,
        ink: t.ink,
        ink2: t.ink2,
        line: t.line,
        brand: t.brand,
      })
    : null;
  if (toolbox && ctx.expanded) {
    const fs = (toolbox.option.feature as Record<string, Record<string, unknown>>).myFullscreen;
    Object.assign(fs, fullscreenIcons(true));
  }
  const toolboxW = toolbox?.width ?? 0;
  entry.toolboxW = toolboxW;
  entry.densePresets =
    presets.length > 0 && ctx.width > 0 && presetsWidth(presets) + toolboxW + 12 > ctx.width;
  const presetsW = presets.length ? presetsWidth(presets, entry.densePresets) : 0;
  const hasControls = toolboxW + presetsW > 0;
  const legendIn = option.legend as { show?: boolean; orient?: string } | undefined;
  const hasLegend = legendIn != null && !Array.isArray(legendIn) && legendIn.show !== false;
  // Vertical (side) legends, e.g. pies, are laid out by the view and stay out of the header row.
  const headerLegend = hasLegend && legendIn.orient !== 'vertical';
  // Header row: [presets][legend ...][toolbox]; narrow hosts move the legend to its own row.
  const legendOwnRow = hasLegend && hasControls && ctx.compact;
  const top =
    hasControls || hasLegend ? PRESET_H + HEADER_GAP + (legendOwnRow ? LEGEND_ROW : 0) : 8;

  entry.legendInset = null;
  const sliderOn = Boolean(opts.zoom) && opts.slider !== false;
  const out: ChartOption = {
    animation: !mq('(prefers-reduced-motion: reduce)'),
    animationDuration: 450,
    aria: {
      enabled: true,
      label: { general: { withoutTitle: `${entry.host.dataset.chartLabel ?? ''}.` } },
    },
    ...option,
  };
  const timeAxis =
    out.xAxis && !Array.isArray(out.xAxis) && (out.xAxis as { type?: string }).type === 'time'
      ? (out.xAxis as Record<string, unknown>)
      : null;
  if (timeAxis) {
    // Keep month/year ticks readable on narrow hosts and avoid clipping the last label.
    out.xAxis = {
      splitNumber: ctx.compact && !ctx.expanded ? 4 : 8,
      ...timeAxis,
      axisLabel: { hideOverlap: true, ...((timeAxis.axisLabel as object) ?? {}) },
    } as ChartOption['xAxis'];
    // ECharts' generated description reads raw timestamps on time axes; summarise instead.
    out.aria = {
      enabled: true,
      label: {
        description: timeAriaDescription(
          entry.host.dataset.chartLabel ?? '',
          out.series,
          opts.valueFormatter ?? fmtEur2,
        ),
      },
    };
  }
  if (!Array.isArray(out.grid)) {
    out.grid = {
      left: 4,
      right: timeAxis ? 16 : 8,
      top,
      bottom: sliderOn ? 34 : 4,
      ...(out.grid ?? {}),
    };
  }
  if (hasLegend && !headerLegend) {
    out.legend = {
      type: 'scroll',
      itemWidth: 12,
      itemHeight: 8,
      icon: 'roundRect',
      ...(legendIn as Record<string, unknown>),
    } as ChartOption['legend'];
  } else if (headerLegend) {
    const legendLeft = legendOwnRow ? 0 : presetsW ? presetsW + 16 : 0;
    const legendRight = legendOwnRow ? 0 : toolboxW + 16;
    entry.legendInset = legendLeft + legendRight;
    out.legend = {
      type: 'scroll',
      left: legendLeft,
      top: legendOwnRow ? PRESET_H + 8 : 3,
      // ECharts' box layout keeps only two of left/right/width, so pin an explicit width.
      ...(ctx.width > 0
        ? { width: Math.max(80, ctx.width - legendLeft - legendRight) }
        : { right: legendRight }),
      itemWidth: 12,
      itemHeight: 8,
      itemGap: 12,
      icon: 'roundRect',
      ...(out.legend ?? {}),
    };
  }
  if (toolbox) out.toolbox = toolbox.option;
  if (presets.length) {
    const g = presetGraphic(entry);
    out.graphic = Array.isArray(out.graphic)
      ? [...out.graphic, g]
      : out.graphic
        ? [out.graphic, g]
        : [g];
  }
  if (opts.zoom) out.dataZoom = zoomComponents(entry, 0);
  return out;
}

function render(entry: Entry, keepState: boolean): void {
  entry.ctx = makeCtx(entry.host);
  const option = compose(entry);
  if (keepState) preserveState(entry, option);
  const wrap = entry.host.closest('.chart-wrap');
  if (wrap) {
    // Wrapper padding reserves room for the slider / header around the fixed plot height.
    const slider = Boolean(entry.opts.zoom) && entry.opts.slider !== false;
    wrap.classList.toggle('chart-zoomable', slider);
    wrap.classList.toggle('chart-tools', !slider && entry.opts.toolbox !== false);
  }
  entry.chart.setOption(option, { notMerge: true });
}

function bindEvents(entry: Entry): void {
  const { chart } = entry;
  chart.off('datazoom');
  chart.off('restore');
  chart.off('click');
  chart.on('datazoom', () => {
    if (entry.applyingPreset || !entry.opts.presets?.length) return;
    if (entry.activePreset !== null) {
      entry.activePreset = null;
      syncPresetGraphic(entry);
      entry.opts.onPresetChange?.(null);
    }
  });
  chart.on('restore', () => {
    entry.activePreset = entry.opts.defaultPreset ?? null;
    render(entry, false);
    entry.opts.onPresetChange?.(entry.activePreset);
  });
  if (entry.opts.onClick) chart.on('click', entry.opts.onClick as (p: unknown) => void);
  if (entry.opts.group) {
    chart.group = entry.opts.group;
    ec?.connect(entry.opts.group);
  }
}

function observe(entry: Entry): void {
  if (typeof ResizeObserver === 'undefined') return;
  entry.ro = new ResizeObserver(() => {
    if (!registry.has(entry.id) || entry.chart.isDisposed()) return;
    const prev = entry.ctx;
    const next = makeCtx(entry.host);
    entry.chart.resize();
    const presets = entry.opts.presets ?? [];
    const dense =
      presets.length > 0 &&
      next.width > 0 &&
      presetsWidth(presets) + entry.toolboxW + 12 > next.width;
    if (
      next.compact !== prev.compact ||
      next.expanded !== prev.expanded ||
      dense !== entry.densePresets
    ) {
      render(entry, true);
    } else if (entry.legendInset != null && next.width > 0 && next.width !== prev.width) {
      entry.ctx = next;
      entry.chart.setOption({ legend: { width: Math.max(80, next.width - entry.legendInset) } });
    }
  });
  entry.ro.observe(entry.host);
}

/**
 * Create (or update) the ECharts instance hosted by element `id`.
 * `build` returns the chart-specific option; the registry adds theme, layout header
 * (legend / range presets / toolbox), dataZoom, aria and animation defaults.
 */
export function renderChart(
  id: string,
  build: (ctx: ChartCtx) => ChartOption,
  opts: RenderChartOpts = {},
): ChartInstance | null {
  const host = document.getElementById(id);
  if (!host) {
    disposeChart(id);
    return null;
  }
  let entry = registry.get(id);
  if (entry && (entry.host !== host || entry.chart.isDisposed())) {
    disposeChart(id);
    entry = undefined;
  }
  if (!host.dataset.chartLabel) host.dataset.chartLabel = host.getAttribute('aria-label') ?? '';
  if (!ec) {
    pending.set(id, { build, opts });
    void loadCharts();
    return null;
  }
  if (!entry) {
    const ctx = makeCtx(host);
    const chart = ec.init(host, buildChartTheme(ctx.tokens), { renderer: 'canvas' });
    entry = {
      id,
      host,
      chart,
      build,
      opts,
      activePreset: opts.defaultPreset ?? null,
      applyingPreset: false,
      densePresets: false,
      legendInset: null,
      toolboxW: 0,
      ctx,
      ro: null,
    };
    registry.set(id, entry);
    observe(entry);
    bindEvents(entry);
    render(entry, false);
    return chart;
  }
  const presetKeys = new Set((opts.presets ?? []).map((p) => p.key));
  if (entry.activePreset && !presetKeys.has(entry.activePreset))
    entry.activePreset = opts.defaultPreset ?? null;
  entry.build = build;
  entry.opts = opts;
  bindEvents(entry);
  render(entry, true);
  return entry.chart;
}

export function getChart(id: string): ChartInstance | null {
  return registry.get(id)?.chart ?? null;
}

export function disposeChart(id: string): void {
  pending.delete(id);
  const entry = registry.get(id);
  if (!entry) return;
  entry.ro?.disconnect();
  if (!entry.chart.isDisposed()) entry.chart.dispose();
  registry.delete(id);
}

/** Re-theme all live charts in place (keeps zoom, legend selection and group links). */
export function refreshChartsTheme(): void {
  for (const [id, entry] of registry) {
    if (!entry.host.isConnected || entry.chart.isDisposed()) {
      disposeChart(id);
      continue;
    }
    entry.chart.setTheme(buildChartTheme(readChartTokens()));
    render(entry, true);
  }
}

let _globalListeners = false;
function ensureGlobalListeners(): void {
  if (_globalListeners || typeof document === 'undefined') return;
  _globalListeners = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const el = document.querySelector('.chart-expanded');
    if (!el) return;
    el.classList.remove('chart-expanded');
    document.body.classList.remove('chart-expanded-open');
  });
}
ensureGlobalListeners();

/** Test helper. */
export function _resetChartsForTests(): void {
  for (const id of [...registry.keys()]) disposeChart(id);
}
