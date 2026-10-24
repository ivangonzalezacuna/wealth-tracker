import type { ChartOption } from './core';
import { chartPalette, type ChartTokens } from './theme';

export interface LegendItem {
  name: string;
  color: string;
  /** Swatch shape: a line (solid / dashed) for line series, a box for bars and areas. */
  kind: 'line' | 'dashed' | 'box';
}

interface SeriesLike {
  name?: string;
  type?: string;
  color?: unknown;
  itemStyle?: { color?: unknown };
  lineStyle?: { color?: unknown; type?: unknown };
}

const colorOf = (c: unknown): string | null => (typeof c === 'string' && c ? c : null);

/** Legend entries (order of `legend.data`, else series order) with each series' colour. */
export function legendItems(option: ChartOption, t: ChartTokens): LegendItem[] {
  const palette = chartPalette(t);
  const raw = option.series;
  const series = (Array.isArray(raw) ? raw : raw ? [raw] : []) as SeriesLike[];
  const byName = new Map<string, LegendItem>();
  series.forEach((s, i) => {
    if (!s.name || byName.has(s.name)) return;
    const line = s.type === 'line';
    const dash = s.lineStyle?.type;
    byName.set(s.name, {
      name: s.name,
      color:
        colorOf(s.lineStyle?.color) ??
        colorOf(s.itemStyle?.color) ??
        colorOf(s.color) ??
        palette[i % palette.length],
      kind: line ? (dash != null && dash !== 'solid' ? 'dashed' : 'line') : 'box',
    });
  });
  const data = (option.legend as { data?: Array<string | { name?: string }> } | undefined)?.data;
  const names = data
    ? data.map((d) => (typeof d === 'string' ? d : (d.name ?? '')))
    : [...byName.keys()];
  return names.map((n) => byName.get(n)).filter((x): x is LegendItem => x != null);
}

interface LegendLayout {
  items: LegendItem[];
  /** Offset from the host's top edge (px). */
  top: number;
  /** Space kept free on the right (toolbox), px. */
  right: number;
  onToggle: (name: string) => void;
  onHover: (name: string, on: boolean) => void;
}

/**
 * HTML legend over the chart header: real buttons that wrap onto extra rows instead of
 * paging, and are reachable by keyboard. Selection state is mirrored by `syncLegend`.
 */
export function renderLegend(
  host: HTMLElement,
  prev: HTMLElement | null,
  o: LegendLayout,
): HTMLElement {
  const el = prev?.parentElement === host ? prev : document.createElement('div');
  el.className = 'chart-legend';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Chart series');
  el.style.top = `${o.top}px`;
  el.style.right = `${o.right}px`;
  el.replaceChildren(
    ...o.items.map((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chart-legend-item';
      btn.dataset.name = item.name;
      btn.title = item.name;
      btn.setAttribute('aria-pressed', 'true');
      const sw = document.createElement('span');
      sw.className = `chart-legend-swatch is-${item.kind}`;
      sw.style.setProperty('--swatch', item.color);
      const label = document.createElement('span');
      label.className = 'chart-legend-label';
      label.textContent = item.name;
      btn.append(sw, label);
      btn.addEventListener('click', () => o.onToggle(item.name));
      btn.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse') o.onHover(item.name, true);
      });
      btn.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse') o.onHover(item.name, false);
      });
      btn.addEventListener('focus', () => o.onHover(item.name, true));
      btn.addEventListener('blur', () => o.onHover(item.name, false));
      return btn;
    }),
  );
  if (el.parentElement !== host) host.appendChild(el);
  return el;
}

/** Reflect ECharts' legend selection (missing names count as shown). */
export function syncLegend(el: HTMLElement, selected: Record<string, boolean>): void {
  for (const btn of el.querySelectorAll<HTMLButtonElement>('.chart-legend-item')) {
    btn.setAttribute('aria-pressed', String(selected[btn.dataset.name ?? ''] !== false));
  }
}
