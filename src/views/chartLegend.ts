import type { Chart } from 'chart.js';

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
  opts: { skipIndex?: number[] } = {},
): void {
  const skip = new Set(opts.skipIndex ?? []);
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
