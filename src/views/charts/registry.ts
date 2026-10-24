import type { ECElementEvent } from 'echarts/core';
import type { DataZoomComponentOption, GraphicComponentOption } from 'echarts/components';
import { echarts, type ChartInstance, type ChartOption } from './core';
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
  ctx: ChartCtx;
  ro: ResizeObserver | null;
}

const registry = new Map<string, Entry>();
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
  };
}

function presetWidth(label: string): number {
  return Math.max(30, label.length * 7 + 16);
}

function presetGraphic(entry: Entry): GraphicComponentOption {
  const t = entry.ctx.tokens;
  const presets = entry.opts.presets ?? [];
  let x = 0;
  const children = presets.map((p) => {
    const w = presetWidth(p.label);
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
    x += w + 4;
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

function presetsWidth(presets: RangePreset[]): number {
  return (
    presets.reduce((s, p) => s + presetWidth(p.label), 0) + Math.max(0, presets.length - 1) * 4
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
  const presetsW = presets.length ? presetsWidth(presets) : 0;
  const hasControls = toolboxW + presetsW > 0;
  const hasLegend = option.legend != null && (option.legend as { show?: boolean }).show !== false;
  // Header row: [presets][legend ...][toolbox]; narrow hosts move the legend to its own row.
  const legendOwnRow = hasLegend && hasControls && ctx.compact;
  const top =
    hasControls || hasLegend ? PRESET_H + HEADER_GAP + (legendOwnRow ? LEGEND_ROW : 0) : 8;

  const sliderOn = Boolean(opts.zoom) && opts.slider !== false;
  const out: ChartOption = {
    animation: !mq('(prefers-reduced-motion: reduce)'),
    animationDuration: 450,
    aria: {
      enabled: true,
      label: { general: { withoutTitle: `${entry.host.dataset.chartLabel ?? ''}. ` } },
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
  if (hasLegend && !Array.isArray(out.legend)) {
    out.legend = {
      type: 'scroll',
      left: legendOwnRow ? 0 : presetsW ? presetsW + 16 : 0,
      top: legendOwnRow ? PRESET_H + 8 : 3,
      right: legendOwnRow ? 0 : toolboxW + 16,
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
    }
  });
  chart.on('restore', () => {
    entry.activePreset = entry.opts.defaultPreset ?? null;
    render(entry, false);
  });
  if (entry.opts.onClick) chart.on('click', entry.opts.onClick as (p: unknown) => void);
  if (entry.opts.group) {
    chart.group = entry.opts.group;
    echarts.connect(entry.opts.group);
  }
}

function observe(entry: Entry): void {
  if (typeof ResizeObserver === 'undefined') return;
  entry.ro = new ResizeObserver(() => {
    if (!registry.has(entry.id) || entry.chart.isDisposed()) return;
    const prev = entry.ctx;
    const next = makeCtx(entry.host);
    entry.chart.resize();
    if (next.compact !== prev.compact || next.expanded !== prev.expanded) render(entry, true);
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
  if (!entry) {
    const ctx = makeCtx(host);
    const chart = echarts.init(host, buildChartTheme(ctx.tokens), { renderer: 'canvas' });
    entry = {
      id,
      host,
      chart,
      build,
      opts,
      activePreset: opts.defaultPreset ?? null,
      applyingPreset: false,
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
