import type { Chart } from 'chart.js';
import { esc, safeColor } from '../utils';

/** Shared tooltip swatch options (10x10 box, no white outline). */
export const TOOLTIP_BOX = {
  multiKeyBackground: 'transparent' as const,
  boxWidth: 10,
  boxHeight: 10,
  boxPadding: 4,
};

/** Returns a labelColor callback that matches swatches to dataset colors. */
export function tooltipSwatch(surfaceColor: string) {
  return (ctx: any) => {
    const ds = ctx.dataset;
    const isDashed = Array.isArray(ds.borderDash) && ds.borderDash.length > 0;
    if (isDashed) {
      const color = (ds.borderColor as string) || '';
      return { borderColor: color, backgroundColor: surfaceColor, borderWidth: 2, borderRadius: 2 };
    }
    const color = (
      Array.isArray(ds.backgroundColor)
        ? ds.backgroundColor[ctx.dataIndex]
        : ds.borderColor || ds.backgroundColor
    ) as string;
    return { borderColor: color, backgroundColor: color, borderWidth: 0 };
  };
}

/** One legend item's display data. */
export interface LegendItem {
  label: string;
  color: string;
  /** When true, the swatch renders with a solid border and transparent fill. */
  dashed?: boolean;
  /** Optional second color for a diagonal split swatch. */
  color2?: string;
}

/**
 * Builds the standard `.leg-item`/`.leg-sq` legend markup for a list of
 * items, in order. Shared by every chart legend in the app so the markup
 * shape can never drift between charts.
 */
export function renderLegendHtml(items: LegendItem[]): string {
  return items
    .map((it) => {
      let style: string;
      if (it.dashed) {
        style = `background:transparent;border:2px solid ${safeColor(it.color)}`;
      } else if (it.color2) {
        style = `background:linear-gradient(135deg,${safeColor(it.color)} 50%,${safeColor(it.color2)} 50%)`;
      } else {
        style = `background:${safeColor(it.color)}`;
      }
      return `<span class="leg-item"><span class="leg-sq" style="${style}"></span>${esc(it.label)}</span>`;
    })
    .join('');
}

/**
 * Binds legend click behavior to a legend's .leg-item children.
 *
 * Behavior:
 * - From "all visible" state: clicking an item ISOLATES to it (hides all
 *   others, shows only the clicked one).
 * - From "partial" state (some items hidden): clicking a HIDDEN item adds
 *   it back (makes it visible again).
 * - Clicking a VISIBLE item in partial state hides it (unless it's the last
 *   visible one, in which case restore all).
 * - skipIndex: dataset indices that are never clickable/togglable (e.g. a
 *   "Total" line that must always stay visible) - pass [] if none.
 * - Always call this after any full chart rebuild, so legend DOM and
 *   chart dataset visibility cannot drift apart.
 */
export function bindLegendToggle(
  legendEl: HTMLElement,
  chart: Chart,
  opts: { skipIndex?: number[]; rescaleX?: boolean } = {},
): void {
  const skip = new Set(opts.skipIndex ?? []);
  const rescaleX = opts.rescaleX ?? false;
  const items = Array.from(legendEl.querySelectorAll('.leg-item')) as HTMLElement[];

  function applyVisualState(): void {
    items.forEach((item, i) => {
      if (skip.has(i)) {
        item.style.opacity = '1';
        return;
      }
      const meta = chart.getDatasetMeta(i);
      item.style.opacity = meta.hidden ? '0.35' : '1';
    });
  }

  function isAllVisible(): boolean {
    const eligible = items.map((_, i) => i).filter((i) => !skip.has(i));
    return eligible.every((i) => !chart.getDatasetMeta(i).hidden);
  }

  function handleClick(targetIdx: number): void {
    const eligible = items.map((_, i) => i).filter((i) => !skip.has(i));
    const targetMeta = chart.getDatasetMeta(targetIdx);

    if (isAllVisible()) {
      // All visible → isolate to clicked item
      eligible.forEach((i) => {
        chart.getDatasetMeta(i).hidden = i !== targetIdx;
      });
    } else if (targetMeta.hidden) {
      // Item is hidden → show it (add it back)
      targetMeta.hidden = false;
    } else {
      // Item is visible → hide it, unless it's the last visible one
      const visibleCount = eligible.filter((i) => !chart.getDatasetMeta(i).hidden).length;
      if (visibleCount <= 1) {
        // Last visible item clicked → restore all
        eligible.forEach((i) => {
          chart.getDatasetMeta(i).hidden = false;
        });
      } else {
        targetMeta.hidden = true;
      }
    }

    if (rescaleX) {
      _applyXRescale(chart);
    }
    chart.update();
    applyVisualState();
  }

  items.forEach((item, i) => {
    if (skip.has(i)) return;
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => handleClick(i));
  });

  applyVisualState();
}

/** Force every dataset visible and refresh legend opacity. Call this on every
 *  full chart rebuild (range/year/page change) so legend state can never
 *  silently survive a rebuild it doesn't apply to. */
export function resetLegendVisibility(legendEl: HTMLElement, chart: Chart): void {
  chart.data.datasets.forEach((_, i) => {
    chart.getDatasetMeta(i).hidden = false;
  });
  chart.update();
  legendEl.querySelectorAll('.leg-item').forEach((item) => {
    (item as HTMLElement).style.opacity = '1';
  });
}

/**
 * Rescales the x-axis min/max to the data range of visible datasets,
 * so that an isolated dataset fills the full chart width.
 */
function _applyXRescale(chart: Chart): void {
  const labels = chart.data.labels as string[];
  if (!labels || labels.length === 0) return;

  let first = labels.length;
  let last = -1;

  chart.data.datasets.forEach((ds, i) => {
    if (chart.getDatasetMeta(i).hidden) return;
    const data = ds.data as (number | null | undefined)[];
    for (let j = 0; j < data.length; j++) {
      if (data[j] != null) {
        if (j < first) first = j;
        if (j > last) last = j;
      }
    }
  });

  const xScale = chart.options.scales?.x;
  if (!xScale) return;

  if (last < 0) {
    // No visible data, show full range
    xScale.min = undefined;
    xScale.max = undefined;
  } else {
    xScale.min = labels[first];
    xScale.max = labels[last];
  }
}
