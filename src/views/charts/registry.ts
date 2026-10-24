import type { ECElementEvent } from 'echarts/core';
import type { DataZoomComponentOption } from 'echarts/components';
import type { ChartInstance, ChartOption } from './core';
import { buildChartTheme, readChartTokens, type ChartTokens } from './theme';
import { buildToolbox, closeDataTable, fullscreenIcons } from './toolbox';
import { fmtEur2, fmtMon } from '../../utils';
import { timeToMonth } from './format';
import { legendItems, renderLegend, syncLegend } from './legend';

/** Zoom window in axis values (timestamp for time axes, index for category axes). */
export interface ZoomWindow {
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
  /** Initial zoom window, also restored by "Reset view"; omit to show the whole axis. */
  window?: ZoomWindow;
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
  /** Click (or second tap on touch) anywhere in the plot to open the matching detail elsewhere. */
  drill?: ChartDrill;
  /** Visible x range (axis values) after the zoom window settles: initial render, zoom, reset. */
  onZoom?: (range: { startValue: number; endValue: number }) => void;
  toolbox?: boolean;
}

export interface ChartDrill {
  /** Axis whose value at the pointer identifies the target (default 'x'). */
  axis?: 'x' | 'y';
  /** Map an axis value (timestamp, category index or number) to a target key; null ignores it. */
  resolve: (value: number) => string | null;
  select: (key: string) => void;
}

interface Entry {
  id: string;
  host: HTMLElement;
  chart: ChartInstance;
  build: (ctx: ChartCtx) => ChartOption;
  opts: RenderChartOpts;
  /** The user moved the zoom window away from `opts.window` (kept across rebuilds). */
  zoomed: boolean;
  /** HTML legend above the plot (header legends only). */
  legend: HTMLElement | null;
  legendH: number;
  ctx: ChartCtx;
  ro: ResizeObserver | null;
  /** Touch drill-down: the key under the last tap, opened by the tooltip's action button. */
  drillTap: { key: string; at: number } | null;
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
/** Toolbox row height above the plot. */
const HEADER_H = 22;
const HEADER_GAP = 10;
/** Gap between the toolbox row and a legend on its own row (narrow hosts). */
const LEGEND_ROW_GAP = 4;
/** Fallback legend height before layout (one row of legend buttons). */
const LEGEND_ROW_H = 22;

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

function windowFor(entry: Entry): Record<string, number | string> {
  const w = entry.opts.window;
  if (!w || (w.startValue == null && w.endValue == null)) return { start: 0, end: 100 };
  const out: Record<string, number | string> = {};
  if (w.startValue != null) out.startValue = w.startValue;
  else out.start = 0;
  if (w.endValue != null) out.endValue = w.endValue;
  else out.end = 100;
  return out;
}

function sliderLabel(entry: Entry) {
  return (value: number, valueStr: string): string => {
    if (entry.opts.xAxisType === 'time') return fmtMon(timeToMonth(value));
    return valueStr;
  };
}

function zoomComponents(entry: Entry): DataZoomComponentOption[] {
  const { touch, expanded } = entry.ctx;
  const win = windowFor(entry);
  const out: DataZoomComponentOption[] = [
    {
      id: 'inside',
      type: 'inside',
      xAxisIndex: 0,
      filterMode: 'filter',
      // Mouse: drag pans, ctrl+wheel / trackpad pinch zooms (plain wheel keeps scrolling the
      // page). Touch: pinch zooms and a sideways drag pans; `touch-action: pan-y` on the host
      // leaves vertical swipes to the page.
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
      height: touch ? 24 : 18,
      bottom: 0,
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
  if (entry.zoomed && Array.isArray(next.dataZoom)) {
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

const escAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Drill axis value behind a tooltip: the category index, else the axis (time) value. */
function drillValueOf(params: unknown, category: boolean, yAxis: boolean): number | null {
  const p = (Array.isArray(params) ? params[0] : params) as
    { dataIndex?: number; axisValue?: unknown; value?: unknown } | undefined;
  if (!p) return null;
  if (category) return typeof p.dataIndex === 'number' ? p.dataIndex : null;
  const axisValue = Number(p.axisValue);
  if (p.axisValue != null && Number.isFinite(axisValue)) return axisValue;
  const v = Array.isArray(p.value) ? Number(p.value[yAxis ? 1 : 0]) : NaN;
  return Number.isFinite(v) ? v : null;
}

function compose(entry: Entry): ChartOption {
  const { ctx, opts } = entry;
  const t = ctx.tokens;
  const option = entry.build(ctx);
  const valueFormatter = opts.valueFormatter ?? fmtEur2;
  const useToolbox = opts.toolbox !== false;
  const toolbox = useToolbox
    ? buildToolbox({
        id: entry.id,
        compact: ctx.compact && !ctx.expanded,
        zoom: Boolean(opts.zoom),
        valueFormatter,
        surface: t.surface,
      })
    : null;
  if (toolbox && ctx.expanded) {
    const fs = (toolbox.option.feature as Record<string, Record<string, unknown>>).myFullscreen;
    Object.assign(fs, fullscreenIcons(true));
  }
  const toolboxW = toolbox?.width ?? 0;
  const legendIn = option.legend as { show?: boolean; orient?: string } | undefined;
  const hasLegend = legendIn != null && !Array.isArray(legendIn) && legendIn.show !== false;
  // Vertical (side) legends, e.g. pies, are laid out by the view and stay on the canvas.
  const headerLegend = hasLegend && legendIn.orient !== 'vertical';

  const out: ChartOption = {
    animation: !mq('(prefers-reduced-motion: reduce)'),
    animationDuration: 450,
    // Month data points are UTC month starts (monthToTime); local ticks would drift off them.
    useUTC: true,
    aria: {
      enabled: true,
      label: { general: { withoutTitle: `${entry.host.dataset.chartLabel ?? ''}.` } },
    },
    ...option,
  };

  // Header: toolbox on the right; a header legend is HTML (wraps instead of paging) beside it,
  // or on its own row(s) on narrow hosts. The plot starts below whichever is taller.
  let top = toolbox ? HEADER_H + HEADER_GAP : 8;
  if (headerLegend) {
    const ownRow = ctx.compact || !toolbox;
    const legendTop = ownRow && toolbox ? HEADER_H + LEGEND_ROW_GAP : 0;
    entry.legend = renderLegend(entry.host, entry.legend, {
      items: legendItems(out, t),
      top: legendTop,
      right: ownRow ? 0 : toolboxW + 12,
      onToggle: (name) => entry.chart.dispatchAction({ type: 'legendToggleSelect', name }),
      onHover: (name, on) =>
        entry.chart.dispatchAction({ type: on ? 'highlight' : 'downplay', seriesName: name }),
    });
    entry.legendH = entry.legend.offsetHeight || LEGEND_ROW_H;
    top = Math.max(top, legendTop + entry.legendH + HEADER_GAP);
    // Selection state stays in ECharts' (hidden) legend component.
    out.legend = { ...(legendIn as Record<string, unknown>), show: false };
  } else {
    entry.legend?.remove();
    entry.legend = null;
    entry.legendH = 0;
    if (hasLegend) {
      out.legend = {
        type: 'scroll',
        itemWidth: 12,
        itemHeight: 8,
        icon: 'roundRect',
        ...(legendIn as Record<string, unknown>),
      } as ChartOption['legend'];
    }
  }
  // Extra header height grows the card instead of shrinking the plot.
  const wrap = entry.host.closest<HTMLElement>('.chart-wrap');
  wrap?.style.setProperty('--chart-head-extra', `${Math.max(0, top - (HEADER_H + HEADER_GAP))}px`);

  const sliderOn = Boolean(opts.zoom) && opts.slider !== false;
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
      bottom: sliderOn ? (ctx.touch ? 40 : 34) : 4,
      ...(out.grid ?? {}),
    };
  }
  // Touch drill-down: the tooltip holds the "Open …" button, so it must take taps. The
  // button carries its own target so it works however the tooltip was shown (tap or scrub).
  if (opts.drill && ctx.touch && out.tooltip && !Array.isArray(out.tooltip)) {
    const tip = out.tooltip as Record<string, unknown>;
    out.tooltip = { ...tip, enterable: true };
    if (typeof tip.formatter === 'function') {
      const drill = opts.drill;
      const axisOpt = (drill.axis === 'y' ? out.yAxis : out.xAxis) as { type?: string } | undefined;
      const category = !Array.isArray(axisOpt) && axisOpt?.type === 'category';
      const fmt = tip.formatter as (params: unknown, ...rest: unknown[]) => unknown;
      (out.tooltip as Record<string, unknown>).formatter = (
        params: unknown,
        ...rest: unknown[]
      ) => {
        const html = fmt(params, ...rest);
        if (typeof html !== 'string' || !html.includes('data-chart-drill')) return html;
        const v = drillValueOf(params, category, drill.axis === 'y');
        const key = v == null ? null : drill.resolve(v);
        return key == null
          ? html
          : html.replace('data-chart-drill', `data-chart-drill="${escAttr(key)}"`);
      };
    }
  }
  if (toolbox) out.toolbox = toolbox.option;
  if (opts.zoom) out.dataZoom = zoomComponents(entry);
  return out;
}

function render(entry: Entry, keepState: boolean): void {
  entry.ctx = makeCtx(entry.host);
  closeDataTable(entry.host);
  const option = compose(entry);
  if (keepState) preserveState(entry, option);
  if (entry.legend) {
    const sel = (option.legend as { selected?: Record<string, boolean> } | undefined)?.selected;
    syncLegend(entry.legend, sel ?? {});
  }
  const wrap = entry.host.closest('.chart-wrap');
  if (wrap) {
    // Wrapper padding reserves room for the slider / header around the fixed plot height.
    const slider = Boolean(entry.opts.zoom) && entry.opts.slider !== false;
    wrap.classList.toggle('chart-zoomable', slider);
    wrap.classList.toggle('chart-touch', slider && entry.ctx.touch);
    wrap.classList.toggle('chart-tools', !slider && entry.opts.toolbox !== false);
  }
  entry.chart.setOption(option, { notMerge: true });
}

// ── Group sync ───────────────────────────────────────────
// Charts sharing `opts.group` follow each other's zoom window and hover position by axis
// value. ECharts' own `connect` syncs zoom by percentage, which misaligns time axes that
// cover different date ranges (e.g. rolling CAGR starts 3 years after net worth).
let syncing = false;

function groupPeers(entry: Entry): Entry[] {
  if (!entry.opts.group) return [];
  return [...registry.values()].filter(
    (p) =>
      p !== entry &&
      p.opts.group === entry.opts.group &&
      p.host.isConnected &&
      !p.chart.isDisposed(),
  );
}

function withSync(fn: () => void): void {
  if (syncing) return;
  syncing = true;
  try {
    fn();
  } finally {
    syncing = false;
  }
}

function zoomWindow(entry: Entry): { startValue: number; endValue: number } | null {
  const dz = (
    entry.chart.getOption() as { dataZoom?: Array<{ startValue?: unknown; endValue?: unknown }> }
  ).dataZoom?.[0];
  const s = Number(dz?.startValue);
  const e = Number(dz?.endValue);
  return Number.isFinite(s) && Number.isFinite(e) ? { startValue: s, endValue: e } : null;
}

/** Min/max x value across the chart's series (time axes use `[x, y]` points). */
function xExtent(entry: Entry): [number, number] | null {
  const series = (entry.chart.getOption() as { series?: Array<{ data?: unknown[] }> }).series;
  let min = Infinity;
  let max = -Infinity;
  for (const s of series ?? []) {
    for (const d of s.data ?? []) {
      const point = Array.isArray(d) ? d : (d as { value?: unknown } | null)?.value;
      const x = Array.isArray(point) ? Number(point[0]) : NaN;
      if (!Number.isFinite(x)) continue;
      if (x < min) min = x;
      if (x > max) max = x;
    }
  }
  return min <= max ? [min, max] : null;
}

// ECharts keeps the span and shifts a window that starts before the data, so clamp each
// end to the peer's own extent to keep the visible dates aligned.
function clampWindow(
  peer: Entry,
  w: { startValue?: number; endValue?: number },
): { startValue?: number; endValue?: number } {
  const ext = xExtent(peer);
  if (!ext) return w;
  const out = { ...w };
  if (out.startValue != null) out.startValue = Math.min(Math.max(out.startValue, ext[0]), ext[1]);
  if (out.endValue != null) out.endValue = Math.max(Math.min(out.endValue, ext[1]), ext[0]);
  return out;
}

function syncZoom(entry: Entry): void {
  const peers = groupPeers(entry).filter((p) => p.opts.zoom);
  if (!peers.length) return;
  const win = zoomWindow(entry);
  if (!win) return;
  withSync(() => {
    for (const peer of peers) {
      peer.zoomed = entry.zoomed;
      peer.chart.dispatchAction({ type: 'dataZoom', ...clampWindow(peer, win) });
      notifyZoom(peer);
    }
  });
}

const zoomFrames = new WeakMap<Entry, number>();

/** Report the visible x range to `opts.onZoom`, at most once per frame (drags fire per move). */
function notifyZoom(entry: Entry): void {
  if (!entry.opts.onZoom) return;
  const run = () => {
    zoomFrames.delete(entry);
    if (entry.chart.isDisposed()) return;
    const w = zoomWindow(entry);
    if (w) entry.opts.onZoom?.(w);
  };
  if (typeof requestAnimationFrame !== 'function') return run();
  if (zoomFrames.has(entry)) return;
  zoomFrames.set(entry, 0);
  requestAnimationFrame(run);
}

function syncPointer(entry: Entry, value: number | null): void {
  const peers = groupPeers(entry);
  if (!peers.length) return;
  withSync(() => {
    for (const peer of peers) {
      if (value == null) {
        peer.chart.dispatchAction({ type: 'hideTip' });
        continue;
      }
      const x = Number(peer.chart.convertToPixel({ xAxisIndex: 0 }, value));
      if (!Number.isFinite(x)) continue;
      peer.chart.dispatchAction({ type: 'showTip', x, y: peer.chart.getHeight() / 2 });
    }
  });
}

function bindEvents(entry: Entry): void {
  const { chart } = entry;
  chart.off('datazoom');
  chart.off('restore');
  chart.off('click');
  chart.off('updateaxispointer');
  chart.off('globalout');
  chart.off('legendselectchanged');
  chart.on('datazoom', () => {
    if (syncing) return;
    entry.zoomed = true;
    notifyZoom(entry);
    if (entry.opts.group) syncZoom(entry);
  });
  chart.on('restore', () => {
    entry.zoomed = false;
    render(entry, false);
    notifyZoom(entry);
    if (entry.opts.group) syncZoom(entry);
  });
  chart.on('legendselectchanged', (e: unknown) => {
    const sel = (e as { selected?: Record<string, boolean> }).selected;
    if (entry.legend && sel) syncLegend(entry.legend, sel);
  });
  if (entry.opts.onClick) chart.on('click', entry.opts.onClick as (p: unknown) => void);
  if (entry.opts.group) {
    let last: number | null = null;
    chart.on('updateaxispointer', (e: unknown) => {
      if (syncing) return;
      const info = (e as { axesInfo?: Array<{ axisDim?: string; value?: unknown }> }).axesInfo;
      const x = info?.find((a) => a.axisDim === 'x');
      const value = x ? Number(x.value) : null;
      const next = value != null && Number.isFinite(value) ? value : null;
      if (next === last) return;
      last = next;
      syncPointer(entry, next);
    });
    chart.on('globalout', () => {
      if (syncing || last == null) return;
      last = null;
      syncPointer(entry, null);
    });
  }
}

const DRILL_TAP_MS = 30_000;
const DRILL_MOVE_PX = 6;
const DRILL_BTN_SLOP_PX = 24;

/**
 * After navigating on pointerup, cancel this touch's `touchend` so the browser does not
 * deliver the follow-up click to whatever now sits under the finger (the Log view).
 */
function suppressGhostClick(): void {
  const stop = (e: Event) => e.preventDefault();
  const opts = { capture: true, passive: false } as const;
  document.addEventListener('touchend', stop, opts);
  setTimeout(() => document.removeEventListener('touchend', stop, opts), 400);
}

/** Close fullscreen / the expanded overlay before navigating away from a chart. */
export function leaveExpanded(host: HTMLElement): void {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  const fsEl = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  if (fsEl?.contains(host)) void document.exitFullscreen?.();
  const overlay = host.closest('.chart-expanded');
  if (overlay) {
    overlay.classList.remove('chart-expanded');
    document.body.classList.remove('chart-expanded-open');
  }
}

function drillKeyAt(entry: Entry, drill: ChartDrill, x: number, y: number): string | null {
  const chart = entry.chart;
  if (!chart.containPixel({ gridIndex: 0 }, [x, y])) return null;
  const v = chart.convertFromPixel({ gridIndex: 0 }, [x, y]) as unknown;
  const value = Array.isArray(v) ? Number(v[drill.axis === 'y' ? 1 : 0]) : NaN;
  return Number.isFinite(value) ? drill.resolve(value) : null;
}

function openDrill(entry: Entry, drill: ChartDrill, key: string): void {
  entry.drillTap = null;
  entry.chart.dispatchAction({ type: 'hideTip' });
  leaveExpanded(entry.host);
  drill.select(key);
}

// Bound once per instance. Handlers are kept by reference: `zr.off(event)` without one would
// also drop ECharts' own listeners.
function bindDrill(entry: Entry): void {
  const zr = entry.chart.getZr();
  let down: [number, number] | null = null;
  zr.on('mousedown', (e: { offsetX: number; offsetY: number }) => {
    down = [e.offsetX, e.offsetY];
  });
  zr.on('mousemove', (e: { offsetX: number; offsetY: number }) => {
    const drill = entry.opts.drill;
    if (drill && !entry.ctx.touch && drillKeyAt(entry, drill, e.offsetX, e.offsetY) != null)
      zr.setCursorStyle('pointer');
  });
  zr.on('click', (e: { offsetX: number; offsetY: number }) => {
    const drill = entry.opts.drill;
    const start = down;
    down = null;
    if (!drill) return;
    // A drag (pan / slider / box zoom) also ends in a click; only a still press drills.
    if (start && Math.hypot(e.offsetX - start[0], e.offsetY - start[1]) > DRILL_MOVE_PX) return;
    const key = drillKeyAt(entry, drill, e.offsetX, e.offsetY);
    // Touch: a tap only shows the tooltip; its "Open …" button (below) navigates.
    entry.drillTap = key == null ? null : { key, at: Date.now() };
    if (key != null && !entry.ctx.touch) openDrill(entry, drill, key);
  });
  // The tooltip lives inside the host element, so its action button bubbles here.
  const pressDrill = (target: EventTarget | null): boolean => {
    const btn = (target as Element | null)?.closest?.<HTMLElement>('[data-chart-drill]');
    const drill = entry.opts.drill;
    if (!btn || !drill) return false;
    const own = btn.dataset.chartDrill;
    const tap = entry.drillTap;
    const key = own || (tap && Date.now() - tap.at <= DRILL_TAP_MS ? tap.key : null);
    if (key) openDrill(entry, drill, key);
    return true;
  };
  // Phones drop the click when a finger wobbles past the browser's tap slop, so a still
  // enough touch press on the button opens it on release; the click that may follow is ignored.
  let btnDown: { x: number; y: number } | null = null;
  let openedAt = 0;
  entry.host.addEventListener('pointerdown', (e) => {
    const onBtn = (e.target as Element | null)?.closest?.('[data-chart-drill]');
    btnDown = onBtn && e.pointerType !== 'mouse' ? { x: e.clientX, y: e.clientY } : null;
  });
  entry.host.addEventListener('pointerup', (e) => {
    const start = btnDown;
    btnDown = null;
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRILL_BTN_SLOP_PX) return;
    if (pressDrill(e.target)) {
      openedAt = Date.now();
      suppressGhostClick();
    }
  });
  entry.host.addEventListener('pointercancel', () => (btnDown = null));
  entry.host.addEventListener('click', (e) => {
    if (!(e.target as Element | null)?.closest?.('[data-chart-drill]')) return;
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - openedAt < 800) return;
    pressDrill(e.target);
  });
}

function observe(entry: Entry): void {
  if (typeof ResizeObserver === 'undefined') return;
  entry.ro = new ResizeObserver(() => {
    if (!registry.has(entry.id) || entry.chart.isDisposed()) return;
    const prev = entry.ctx;
    const next = makeCtx(entry.host);
    entry.chart.resize();
    // A legend that re-wraps to a different number of rows moves the plot's top edge.
    const legendH = entry.legend ? entry.legend.offsetHeight : 0;
    if (
      next.compact !== prev.compact ||
      next.expanded !== prev.expanded ||
      (entry.legend != null && legendH > 0 && legendH !== entry.legendH)
    ) {
      render(entry, true);
    } else {
      entry.ctx = next;
    }
  });
  entry.ro.observe(entry.host);
}

/**
 * Create (or update) the ECharts instance hosted by element `id`.
 * `build` returns the chart-specific option; the registry adds theme, layout header
 * (legend / toolbox), dataZoom, aria and animation defaults.
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
      zoomed: false,
      legend: null,
      legendH: 0,
      ctx,
      ro: null,
      drillTap: null,
    };
    registry.set(id, entry);
    observe(entry);
    bindEvents(entry);
    bindDrill(entry);
    render(entry, false);
    notifyZoom(entry);
    return chart;
  }
  entry.build = build;
  entry.opts = opts;
  bindEvents(entry);
  render(entry, true);
  notifyZoom(entry);
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
  entry.legend?.remove();
  closeDataTable(entry.host);
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
