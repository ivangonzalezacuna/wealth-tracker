/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bindLegendToggle, resetLegendVisibility, renderLegendHtml } from './chartLegend';

function createMockChart(datasetCount: number) {
  const metas = Array.from({ length: datasetCount }, () => ({ hidden: false }));
  return {
    data: { datasets: Array.from({ length: datasetCount }, () => ({})) },
    getDatasetMeta: (i: number) => metas[i],
    update: vi.fn(),
    _metas: metas,
  };
}

function createLegendEl(count: number): HTMLElement {
  const el = document.createElement('div');
  for (let i = 0; i < count; i++) {
    const item = document.createElement('span');
    item.className = 'leg-item';
    item.textContent = `Item ${i}`;
    el.appendChild(item);
  }
  return el;
}

describe('bindLegendToggle', () => {
  let legendEl: HTMLElement;
  let chart: ReturnType<typeof createMockChart>;

  beforeEach(() => {
    legendEl = createLegendEl(4);
    chart = createMockChart(4);
  });

  it('from all-visible: clicking item A isolates to A (hides others)', () => {
    bindLegendToggle(legendEl, chart as any);
    const items = legendEl.querySelectorAll('.leg-item') as NodeListOf<HTMLElement>;
    items[1].click();

    expect(chart._metas[0].hidden).toBe(true);
    expect(chart._metas[1].hidden).toBe(false);
    expect(chart._metas[2].hidden).toBe(true);
    expect(chart._metas[3].hidden).toBe(true);
    expect(chart.update).toHaveBeenCalled();
    expect(items[1].style.opacity).toBe('1');
    expect(items[0].style.opacity).toBe('0.35');
  });

  it('from isolated state: clicking a hidden item adds it back', () => {
    bindLegendToggle(legendEl, chart as any);
    const items = legendEl.querySelectorAll('.leg-item') as NodeListOf<HTMLElement>;

    items[1].click(); // isolate to 1
    items[2].click(); // add back 2

    expect(chart._metas[0].hidden).toBe(true);
    expect(chart._metas[1].hidden).toBe(false);
    expect(chart._metas[2].hidden).toBe(false);
    expect(chart._metas[3].hidden).toBe(true);
    expect(items[1].style.opacity).toBe('1');
    expect(items[2].style.opacity).toBe('1');
    expect(items[0].style.opacity).toBe('0.35');
  });

  it('from partial state: clicking a visible item hides it', () => {
    bindLegendToggle(legendEl, chart as any);
    const items = legendEl.querySelectorAll('.leg-item') as NodeListOf<HTMLElement>;

    items[1].click(); // isolate to 1
    items[2].click(); // add back 2 → now 1 and 2 visible

    items[1].click(); // hide 1 → only 2 visible

    expect(chart._metas[0].hidden).toBe(true);
    expect(chart._metas[1].hidden).toBe(true);
    expect(chart._metas[2].hidden).toBe(false);
    expect(chart._metas[3].hidden).toBe(true);
  });

  it('clicking last visible item restores all', () => {
    bindLegendToggle(legendEl, chart as any);
    const items = legendEl.querySelectorAll('.leg-item') as NodeListOf<HTMLElement>;

    items[1].click(); // isolate to 1
    items[1].click(); // click the sole visible → restore all

    expect(chart._metas[0].hidden).toBe(false);
    expect(chart._metas[1].hidden).toBe(false);
    expect(chart._metas[2].hidden).toBe(false);
    expect(chart._metas[3].hidden).toBe(false);
    expect(items[0].style.opacity).toBe('1');
    expect(items[1].style.opacity).toBe('1');
  });

  it('skipIndex items are never toggled and stay opacity 1', () => {
    bindLegendToggle(legendEl, chart as any, { skipIndex: [0] });
    const items = legendEl.querySelectorAll('.leg-item') as NodeListOf<HTMLElement>;

    items[1].click(); // isolate to 1

    // Index 0 is skipped - never hidden
    expect(chart._metas[0].hidden).toBe(false);
    expect(items[0].style.opacity).toBe('1');
    expect(items[0].style.cursor).not.toBe('pointer');

    // Others (eligible) are hidden
    expect(chart._metas[1].hidden).toBe(false);
    expect(chart._metas[2].hidden).toBe(true);
    expect(chart._metas[3].hidden).toBe(true);
  });

  it('skipIndex items are not clickable', () => {
    bindLegendToggle(legendEl, chart as any, { skipIndex: [0] });
    const items = legendEl.querySelectorAll('.leg-item') as NodeListOf<HTMLElement>;

    items[0].click(); // should do nothing
    expect(chart._metas[0].hidden).toBe(false);
    expect(chart._metas[1].hidden).toBe(false);
    expect(chart._metas[2].hidden).toBe(false);
    expect(chart._metas[3].hidden).toBe(false);
  });

  it('sets cursor:pointer on eligible items only', () => {
    bindLegendToggle(legendEl, chart as any, { skipIndex: [0] });
    const items = legendEl.querySelectorAll('.leg-item') as NodeListOf<HTMLElement>;
    expect(items[0].style.cursor).not.toBe('pointer');
    expect(items[1].style.cursor).toBe('pointer');
    expect(items[2].style.cursor).toBe('pointer');
  });

  it('applies initial visual state on bind', () => {
    // Pre-hide dataset 2
    chart._metas[2].hidden = true;
    bindLegendToggle(legendEl, chart as any);
    const items = legendEl.querySelectorAll('.leg-item') as NodeListOf<HTMLElement>;
    expect(items[2].style.opacity).toBe('0.35');
    expect(items[0].style.opacity).toBe('1');
  });

  it('isolate respects skipIndex', () => {
    bindLegendToggle(legendEl, chart as any, { skipIndex: [0] });
    const items = legendEl.querySelectorAll('.leg-item') as NodeListOf<HTMLElement>;

    items[1].click(); // isolate among eligible (1,2,3) → only 1 visible

    expect(chart._metas[0].hidden).toBe(false); // skip - always visible
    expect(chart._metas[1].hidden).toBe(false);
    expect(chart._metas[2].hidden).toBe(true);
    expect(chart._metas[3].hidden).toBe(true);

    // Click hidden item to add it back
    items[3].click();
    expect(chart._metas[1].hidden).toBe(false);
    expect(chart._metas[3].hidden).toBe(false);
    expect(chart._metas[2].hidden).toBe(true);
  });
});

describe('resetLegendVisibility', () => {
  it('clears all hidden flags and resets opacity regardless of prior state', () => {
    const chart = createMockChart(3);
    const legendEl = createLegendEl(3);

    // Simulate prior state
    chart._metas[0].hidden = true;
    chart._metas[2].hidden = true;
    const items = legendEl.querySelectorAll('.leg-item') as NodeListOf<HTMLElement>;
    items[0].style.opacity = '0.35';
    items[2].style.opacity = '0.35';

    resetLegendVisibility(legendEl, chart as any);

    expect(chart._metas[0].hidden).toBe(false);
    expect(chart._metas[1].hidden).toBe(false);
    expect(chart._metas[2].hidden).toBe(false);
    expect(chart.update).toHaveBeenCalled();
    expect(items[0].style.opacity).toBe('1');
    expect(items[1].style.opacity).toBe('1');
    expect(items[2].style.opacity).toBe('1');
  });
});

describe('renderLegendHtml', () => {
  it('returns empty string for empty array', () => {
    expect(renderLegendHtml([])).toBe('');
  });

  it('renders one .leg-item for a single entry', () => {
    const html = renderLegendHtml([{ label: 'Total', color: '#185FA5' }]);
    expect(html).toContain('class="leg-item"');
    expect(html).toContain('class="leg-sq"');
    expect(html).toContain('background:#185FA5');
    expect(html).toContain('Total');
  });

  it('renders multiple items joined with no separator', () => {
    const html = renderLegendHtml([
      { label: 'A', color: '#111' },
      { label: 'B', color: '#222' },
    ]);
    // Two leg-item spans, no text between them
    expect(html.match(/class="leg-item"/g)?.length).toBe(2);
    expect(html).not.toContain('</span> <span');
  });

  it('HTML-escapes the label', () => {
    const html = renderLegendHtml([{ label: '<script>alert(1)</script>', color: '#000' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('passes color through safeColor', () => {
    // Invalid color falls back to #888
    const html = renderLegendHtml([{ label: 'X', color: 'javascript:evil()' }]);
    expect(html).toContain('background:#888');
  });
});
