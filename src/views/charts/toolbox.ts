import { fmtEur, fmtEur2, fmtMon } from '../../utils';
import type { ToolboxComponentOption } from 'echarts/components';
import { timeToMonth } from './format';
import { isHelperSeries } from './options';

type Fmt = (value: number) => string;

const ICON_FULLSCREEN = 'path://M2,7V2H7M13,2H18V7M18,13V18H13M7,18H2V13';
const ICON_FULLSCREEN_EXIT = 'path://M7,2V7H2M13,2V7H18M18,13H13V18M2,13H7V18';
const ICON_TABLE = 'path://M2,3H18V17H2ZM2,8H18M2,12.5H18M7,8V17';

/** Width (px) the toolbox occupies for a given icon count (itemSize 14 + itemGap 12, plus slack). */
export function toolboxWidth(count: number): number {
  return count > 0 ? count * 28 : 0;
}

interface ToolboxOpts {
  id: string;
  compact: boolean;
  zoom: boolean;
  valueFormatter: Fmt;
  /** Background for saved images. */
  surface: string;
}

/** Built-in toolbox: box zoom/back, restore, data table, save image, fullscreen. */
export function buildToolbox(o: ToolboxOpts): { option: ToolboxComponentOption; width: number } {
  const feature: Record<string, unknown> = {};
  if (o.zoom && !o.compact) {
    feature.dataZoom = {
      yAxisIndex: 'none',
      title: { zoom: 'Box zoom', back: 'Undo zoom' },
    };
  }
  if (o.zoom) feature.restore = { title: 'Reset view' };
  feature.myDataTable = {
    show: true,
    title: 'Data table',
    icon: ICON_TABLE,
    onclick: (_ecModel: unknown, api: { getDom: () => HTMLElement; getOption: () => unknown }) =>
      openDataTable(api.getDom(), api.getOption(), o.valueFormatter),
  };
  if (!o.compact) {
    feature.saveAsImage = {
      title: 'Save image',
      name: o.id,
      backgroundColor: o.surface,
      pixelRatio: 2,
    };
  }
  feature.myFullscreen = {
    show: true,
    title: 'Expand',
    icon: ICON_FULLSCREEN,
    onclick: (_ecModel: unknown, api: { getDom: () => HTMLElement }) =>
      toggleExpanded(api.getDom()),
  };
  const count =
    Object.keys(feature).length + (feature.dataZoom ? 1 : 0); /* dataZoom has zoom + back icons */
  return {
    width: toolboxWidth(count),
    option: {
      show: true,
      top: 4,
      right: 0,
      padding: 0,
      itemSize: 14,
      itemGap: 12,
      showTitle: true,
      feature: feature as ToolboxComponentOption['feature'],
      tooltip: { show: false },
    },
  };
}

/** Fullscreen API on the chart card wrapper, falling back to a fixed overlay (e.g. iPhone Safari). */
export function toggleExpanded(dom: HTMLElement): void {
  const target = (dom.closest('.chart-wrap') as HTMLElement | null) ?? dom;
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  const fsEl = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  if (fsEl) {
    void document.exitFullscreen?.();
    return;
  }
  if (target.classList.contains('chart-expanded')) {
    target.classList.remove('chart-expanded');
    document.body.classList.remove('chart-expanded-open');
    return;
  }
  const req = (
    target as HTMLElement & { webkitRequestFullscreen?: () => void }
  ).requestFullscreen?.bind(target);
  if (req) {
    req().catch(() => expandFallback(target));
  } else {
    expandFallback(target);
  }
}

function expandFallback(target: HTMLElement): void {
  target.classList.add('chart-expanded');
  document.body.classList.add('chart-expanded-open');
}

export function fullscreenIcons(expanded: boolean): { icon: string; title: string } {
  return expanded
    ? { icon: ICON_FULLSCREEN_EXIT, title: 'Exit full screen' }
    : { icon: ICON_FULLSCREEN, title: 'Expand' };
}

/**
 * Data table overlay inside the chart host: compact rows, a small close button, Escape to
 * close. Replaces ECharts' dataView (fixed title bar, textarea styling, footer button).
 */
export function openDataTable(host: HTMLElement, option: unknown, valueFormatter: Fmt): void {
  closeDataTable(host);
  const panel = document.createElement('div');
  panel.className = 'chart-dataview';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `${host.dataset.chartLabel || 'Chart'} data`);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'chart-dataview-close';
  close.setAttribute('aria-label', 'Close data table');
  close.title = 'Close';
  close.textContent = '\u00d7';
  close.addEventListener('click', () => closeDataTable(host));
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Keep the expanded overlay open: Escape only dismisses the table.
    e.stopPropagation();
    closeDataTable(host);
  });
  panel.append(close, dataViewTable(option, valueFormatter));
  host.appendChild(panel);
  close.focus({ preventScroll: true });
}

export function closeDataTable(host: HTMLElement): void {
  host.querySelector(':scope > .chart-dataview')?.remove();
}

interface UnitOption {
  xAxis?: Array<{ type?: string; data?: unknown[] }>;
  yAxis?: Array<{ type?: string; data?: unknown[] }>;
  series?: Array<{ type?: string; id?: string; name?: string; data?: unknown[] }>;
}

function cellValue(d: unknown): unknown {
  if (d && typeof d === 'object' && !Array.isArray(d) && 'value' in d)
    return (d as { value: unknown }).value;
  return d;
}

/** Data view content: a real `<table>` built with textContent (no HTML injection from user labels). */
export function dataViewTable(raw: unknown, valueFormatter: Fmt = fmtEur2): HTMLElement {
  const opt = raw as UnitOption;
  const wrap = document.createElement('div');
  wrap.className = 'chart-dataview-scroll';
  const table = document.createElement('table');
  table.className = 'chart-dataview-table';
  wrap.appendChild(table);
  const series = (opt.series ?? []).filter((s) => Array.isArray(s.data) && !isHelperSeries(s.id));
  const thead = table.createTHead().insertRow();
  const tbody = table.createTBody();
  const addCells = (row: HTMLTableRowElement, cells: string[], numericFrom = 1) => {
    cells.forEach((c, i) => {
      const cell = document.createElement(row.parentElement?.tagName === 'THEAD' ? 'th' : 'td');
      cell.textContent = c;
      if (i >= numericFrom) cell.className = 'num';
      row.appendChild(cell);
    });
  };
  // Whole-euro data reads easier without ",00" on every cell.
  const values = series.flatMap((s) => (s.data ?? []).map(cellValue)).flat();
  const whole =
    valueFormatter === fmtEur2 &&
    values.every((v) => v == null || typeof v !== 'number' || Number.isInteger(v));
  const fmtValue = whole ? fmtEur : valueFormatter;
  const fmt = (v: unknown) =>
    v == null || v === '' || Number.isNaN(Number(v)) ? '–' : fmtValue(Number(v));

  if (series.length > 0 && series.every((s) => s.type === 'pie')) {
    addCells(thead, ['Name', 'Value']);
    for (const s of series) {
      for (const d of s.data ?? []) {
        const item = d as { name?: string; value?: number };
        addCells(tbody.insertRow(), [String(item.name ?? ''), fmt(item.value)]);
      }
    }
    return wrap;
  }

  const xAxis = opt.xAxis?.[0];
  const yAxis = opt.yAxis?.[0];
  const horizontal = yAxis?.type === 'category' && xAxis?.type !== 'category';
  const catAxis = horizontal ? yAxis : xAxis;
  const isTime = catAxis?.type === 'time';
  addCells(thead, [isTime ? 'Month' : '', ...series.map((s) => String(s.name ?? ''))]);

  const keys: Array<string | number> = [];
  const byKey = new Map<string | number, unknown[]>();
  series.forEach((s, si) => {
    (s.data ?? []).forEach((d, i) => {
      let key: string | number;
      let val: unknown;
      const v = cellValue(d);
      if (isTime && Array.isArray(v)) {
        key = Number(v[0]);
        val = v[1];
      } else {
        key = catAxis?.data ? String(cellValue(catAxis.data[i]) ?? i) : i;
        val = Array.isArray(v) ? v[horizontal ? 0 : 1] : v;
      }
      if (!byKey.has(key)) {
        byKey.set(key, new Array(series.length).fill(null));
        keys.push(key);
      }
      byKey.get(key)![si] = val;
    });
  });
  if (isTime) keys.sort((a, b) => Number(a) - Number(b));
  for (const k of keys) {
    const label = isTime ? fmtMon(timeToMonth(Number(k))) : String(k);
    addCells(tbody.insertRow(), [label, ...byKey.get(k)!.map(fmt)]);
  }
  return wrap;
}
