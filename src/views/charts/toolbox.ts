import { fmtEur2, fmtMon } from '../../utils';
import type { ToolboxComponentOption } from 'echarts/components';
import { timeToMonth } from './format';

type Fmt = (value: number) => string;

const ICON_FULLSCREEN = 'path://M2,7V2H7M13,2H18V7M18,13V18H13M7,18H2V13';
const ICON_FULLSCREEN_EXIT = 'path://M7,2V7H2M13,2V7H18M18,13H13V18M2,13H7V18';

/** Width (px) the toolbox occupies for a given icon count (itemSize 14 + itemGap 12, plus slack). */
export function toolboxWidth(count: number): number {
  return count > 0 ? count * 28 : 0;
}

interface ToolboxOpts {
  id: string;
  compact: boolean;
  zoom: boolean;
  valueFormatter: Fmt;
  surface: string;
  ink: string;
  ink2: string;
  line: string;
  brand: string;
}

/** Built-in toolbox: box zoom/back, restore, data view (formatted table), save image, fullscreen. */
export function buildToolbox(o: ToolboxOpts): { option: ToolboxComponentOption; width: number } {
  const feature: Record<string, unknown> = {};
  if (o.zoom && !o.compact) {
    feature.dataZoom = {
      yAxisIndex: 'none',
      title: { zoom: 'Box zoom', back: 'Undo zoom' },
    };
  }
  if (o.zoom) feature.restore = { title: 'Reset view' };
  feature.dataView = {
    readOnly: true,
    title: 'Data table',
    lang: ['Data table', 'Close', 'Refresh'],
    backgroundColor: o.surface,
    textColor: o.ink,
    textareaColor: o.surface,
    textareaBorderColor: o.line,
    buttonColor: o.brand,
    buttonTextColor: '#fff',
    optionToContent: (opt: unknown) => dataViewTable(opt, o.valueFormatter),
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

interface UnitOption {
  xAxis?: Array<{ type?: string; data?: unknown[] }>;
  yAxis?: Array<{ type?: string; data?: unknown[] }>;
  series?: Array<{ type?: string; name?: string; data?: unknown[] }>;
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
  wrap.className = 'chart-dataview';
  const table = document.createElement('table');
  table.className = 'chart-dataview-table';
  wrap.appendChild(table);
  const series = (opt.series ?? []).filter((s) => Array.isArray(s.data));
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
  const fmt = (v: unknown) =>
    v == null || v === '' || Number.isNaN(Number(v)) ? '–' : valueFormatter(Number(v));

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
