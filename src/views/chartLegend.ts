import type { Chart } from 'chart.js';

/**
 * Binds independent toggle-on-click behavior to a legend's .leg-item children.
 * - Click an item: toggles that dataset's visibility independently.
 *   Multiple datasets can be visible or hidden at the same time.
 * - If all eligible items end up hidden, restore all to visible.
 * - skipIndex: dataset indices that are never clickable/togglable (e.g. a
 *   "Total" line that must always stay visible) — pass [] if none.
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
      if (skip.has(i)) { item.style.opacity = '1'; return; }
      const meta = chart.getDatasetMeta(i);
      item.style.opacity = meta.hidden ? '0.35' : '1';
    });
  }

  function toggle(targetIdx: number): void {
    const meta = chart.getDatasetMeta(targetIdx);
    meta.hidden = !meta.hidden;

    // If all eligible items are now hidden, restore all to visible
    const eligible = items.map((_, i) => i).filter(i => !skip.has(i));
    const allHidden = eligible.every(i => !!chart.getDatasetMeta(i).hidden);
    if (allHidden) {
      eligible.forEach(i => { chart.getDatasetMeta(i).hidden = false; });
    }

    chart.update();
    applyVisualState();
  }

  items.forEach((item, i) => {
    if (skip.has(i)) return;
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => toggle(i));
  });

  applyVisualState();
}

/** Force every dataset visible and refresh legend opacity. Call this on every
 *  full chart rebuild (range/year/page change) so legend state can never
 *  silently survive a rebuild it doesn't apply to. */
export function resetLegendVisibility(legendEl: HTMLElement, chart: Chart): void {
  chart.data.datasets.forEach((_, i) => { chart.getDatasetMeta(i).hidden = false; });
  chart.update();
  legendEl.querySelectorAll('.leg-item').forEach(item => {
    (item as HTMLElement).style.opacity = '1';
  });
}
