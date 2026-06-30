import type { Chart } from 'chart.js';

/**
 * Binds isolate-on-click behavior to a legend's .leg-item children.
 * - Click an item: if it is the only currently-visible dataset, restore all
 *   (toggle back to default). Otherwise, isolate to just that dataset.
 * - skipIndex: dataset indices that are never clickable/isolatable (e.g. a
 *   "Total" line that must always stay visible) — pass [] if none.
 * - Always call this after any full chart rebuild, so legend DOM and
 *   chart dataset visibility cannot drift apart.
 */
export function bindIsolateLegend(
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

  function isolate(targetIdx: number): void {
    const eligible = items.map((_, i) => i).filter(i => !skip.has(i));
    const onlyTargetVisible = eligible.every(i => {
      const hidden = chart.getDatasetMeta(i).hidden;
      return i === targetIdx ? !hidden : !!hidden;
    });
    if (onlyTargetVisible) {
      // Already isolated to this one — clicking again restores all
      eligible.forEach(i => { chart.getDatasetMeta(i).hidden = false; });
    } else {
      eligible.forEach(i => { chart.getDatasetMeta(i).hidden = i !== targetIdx; });
    }
    chart.update();
    applyVisualState();
  }

  items.forEach((item, i) => {
    if (skip.has(i)) return;
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => isolate(i));
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
