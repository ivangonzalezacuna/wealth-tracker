/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('echarts/core', () => import('./echartsMock'));

import { chartFor, resetMockCharts } from './echartsMock';
import {
  _resetChartsForTests,
  loadCharts,
  disposeChart,
  getChart,
  refreshChartsTheme,
  renderChart,
} from './registry';
import type { ChartOption } from './core';
import { addMonths, fmtEurCompact, fmtPctAxis, monthToTime, timeToMonth } from './format';
import { closeDataTable, dataViewTable, openDataTable } from './toolbox';
import { drillHint, tooltipHint } from './options';
import { toRgba } from './theme';

type AnyRec = Record<string, any>;

const line = (): ChartOption => ({
  xAxis: { type: 'time' },
  yAxis: { type: 'value' },
  series: [{ type: 'line', name: 'A', data: [[monthToTime('2026-01'), 1]] }],
});

beforeEach(async () => {
  await loadCharts();
  document.body.innerHTML = '<div id="c-test" aria-label="Test chart"></div>';
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

afterEach(() => {
  _resetChartsForTests();
  resetMockCharts();
});

describe('chart formatters', () => {
  it('formats compact euros without duplicate thousands ticks', () => {
    expect(fmtEurCompact(0)).toBe('0\u00A0€');
    expect(fmtEurCompact(950)).toBe('950\u00A0€');
    expect(fmtEurCompact(1200)).toBe('1.2k\u00A0€');
    expect(fmtEurCompact(1400)).toBe('1.4k\u00A0€');
    expect(fmtEurCompact(120000)).toBe('120k\u00A0€');
    expect(fmtEurCompact(1_250_000)).toBe('1.3M\u00A0€');
    expect(fmtEurCompact(-3400)).toBe('\u22123.4k\u00A0€');
  });

  it('formats axis percentages', () => {
    expect(fmtPctAxis(-12)).toBe('\u221212%');
    expect(fmtPctAxis(4.54)).toBe('4.5%');
  });

  it('converts months to UTC timestamps and back', () => {
    const t = monthToTime('2026-03');
    expect(timeToMonth(t)).toBe('2026-03');
    expect(timeToMonth(addMonths(t, -14))).toBe('2025-01');
  });

  it('converts hex colours to rgba', () => {
    expect(toRgba('#2a78d6', 0.5)).toBe('rgba(42,120,214,0.5)');
    expect(toRgba('#fff', 1)).toBe('rgba(255,255,255,1)');
    expect(toRgba('red', 1)).toBe('red');
  });
});

describe('renderChart', () => {
  it('creates an instance with aria, toolbox and grid defaults', () => {
    renderChart('c-test', line);
    const opt = chartFor('c-test')!.option as AnyRec;
    expect(opt.aria.enabled).toBe(true);
    expect(opt.useUTC).toBe(true);
    expect(opt.aria.label.description).toBe(
      'Test chart. A: 1 points from Jan 2026 (1,00\u00A0€) to Jan 2026 (1,00\u00A0€).',
    );
    expect(Object.keys(opt.toolbox.feature)).toEqual(
      expect.arrayContaining(['myDataTable', 'myFullscreen']),
    );
    expect(opt.grid.top).toBeGreaterThan(0);
    expect(getChart('c-test')).toBeTruthy();
  });

  it('adds inside + slider dataZoom showing everything by default', () => {
    renderChart('c-test', line, { zoom: true, xAxisType: 'time' });
    const opt = chartFor('c-test')!.option as AnyRec;
    expect(opt.dataZoom.map((z: AnyRec) => z.type)).toEqual(['inside', 'slider']);
    expect(opt.dataZoom[0]).toMatchObject({ start: 0, end: 100, moveOnMouseMove: true });
    expect(opt.dataZoom[0].disabled).toBeUndefined();
    expect(opt.toolbox.feature.dataZoom).toBeDefined();
    expect(opt.toolbox.feature.restore).toBeDefined();
    expect(opt.graphic).toBeUndefined();
  });

  it('opens on the initial window and reports the visible range', () => {
    const start = monthToTime('2025-02');
    const onZoom = vi.fn();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    const flush = () => frames.splice(0).forEach((cb) => cb(0));
    try {
      renderChart('c-test', line, { zoom: true, window: { startValue: start }, onZoom });
      const chart = chartFor('c-test')!;
      const opt = chart.option as AnyRec;
      expect(opt.dataZoom[0]).toMatchObject({ startValue: start, end: 100 });
      expect(opt.dataZoom[1]).toMatchObject({ startValue: start, end: 100 });
      chart.option = { ...opt, dataZoom: [{ startValue: 5, endValue: 9 }] };
      flush();
      expect(onZoom).toHaveBeenCalledTimes(1);
      // Drags fire many events per frame; the callback runs once per frame.
      chart.option = { ...opt, dataZoom: [{ startValue: 6, endValue: 9 }] };
      chart.trigger('datazoom', {});
      chart.trigger('datazoom', {});
      flush();
      expect(onZoom).toHaveBeenCalledTimes(2);
      expect(onZoom).toHaveBeenLastCalledWith({ startValue: 6, endValue: 9 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a manual zoom across re-renders until Reset view', () => {
    renderChart('c-test', line, { zoom: true, window: { startValue: 1 } });
    const chart = chartFor('c-test')!;
    chart.option = { ...(chart.option as AnyRec), dataZoom: [{ start: 40, end: 60 }] };
    chart.trigger('datazoom', {});
    renderChart('c-test', line, { zoom: true, window: { startValue: 1 } });
    expect((chart.option as AnyRec).dataZoom[0]).toMatchObject({ start: 40, end: 60 });
    expect((chart.option as AnyRec).dataZoom[0].startValue).toBeUndefined();
    chart.trigger('restore', {});
    expect((chart.option as AnyRec).dataZoom[0]).toMatchObject({ startValue: 1, end: 100 });
  });

  it('uses a taller slider and touch-friendly panning on touch screens', () => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockReturnValue({ matches: true });
    document.body.innerHTML = '<div class="chart-wrap"><div id="c-test"></div></div>';
    renderChart('c-test', line, { zoom: true });
    const opt = chartFor('c-test')!.option as AnyRec;
    expect(opt.dataZoom[0]).toMatchObject({
      moveOnMouseMove: true,
      preventDefaultMouseMove: false,
    });
    expect(opt.dataZoom[1].height).toBe(24);
    const wrap = document.querySelector('.chart-wrap')!;
    expect(wrap.classList.contains('chart-zoomable')).toBe(true);
    expect(wrap.classList.contains('chart-touch')).toBe(true);
  });

  it('keeps legend selection across re-renders', () => {
    const build = (): ChartOption => ({ ...line(), legend: {} });
    renderChart('c-test', build);
    const chart = chartFor('c-test')!;
    (chart.option as AnyRec).legend.selected = { A: false };
    renderChart('c-test', build);
    expect((chart.option as AnyRec).legend.selected).toEqual({ A: false });
    const btn = document.querySelector<HTMLButtonElement>('.chart-legend-item')!;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders the header legend as wrapping HTML buttons', () => {
    const build = (): ChartOption => ({
      ...line(),
      legend: {},
      series: [
        { type: 'line', name: 'A', data: [] },
        { type: 'line', name: 'B', lineStyle: { type: 'dashed', color: '#123456' }, data: [] },
        { type: 'bar', name: 'C', data: [] },
      ],
    });
    renderChart('c-test', build);
    const chart = chartFor('c-test')!;
    expect((chart.option as AnyRec).legend.show).toBe(false);
    const items = [...document.querySelectorAll<HTMLButtonElement>('#c-test .chart-legend-item')];
    expect(items.map((b) => b.textContent)).toEqual(['A', 'B', 'C']);
    expect(items.map((b) => b.querySelector('.chart-legend-swatch')!.className)).toEqual([
      'chart-legend-swatch is-line',
      'chart-legend-swatch is-dashed',
      'chart-legend-swatch is-box',
    ]);
    expect(
      (items[1].querySelector('.chart-legend-swatch') as HTMLElement).style.getPropertyValue(
        '--swatch',
      ),
    ).toBe('#123456');

    items[1].click();
    expect(chart.actions.at(-1)).toEqual({ type: 'legendToggleSelect', name: 'B' });
    chart.trigger('legendselectchanged', { selected: { A: true, B: false, C: true } });
    expect(items[1].getAttribute('aria-pressed')).toBe('false');
    items[0].dispatchEvent(new FocusEvent('focus'));
    expect(chart.actions.at(-1)).toEqual({ type: 'highlight', seriesName: 'A' });

    // Re-render reuses the same legend element.
    renderChart('c-test', build);
    expect(document.querySelectorAll('#c-test .chart-legend')).toHaveLength(1);
  });

  it('keeps vertical (side) legends on the canvas', () => {
    renderChart('c-test', () => ({ ...line(), legend: { orient: 'vertical' } }));
    expect(document.querySelector('.chart-legend')).toBeNull();
    expect((chartFor('c-test')!.option as AnyRec).legend.show).toBeUndefined();
  });

  it('wires click handlers and disposes cleanly', () => {
    const onClick = vi.fn();
    renderChart('c-test', line, { onClick });
    const chart = chartFor('c-test')!;
    chart.trigger('click', { dataIndex: 0 });
    expect(onClick).toHaveBeenCalledWith({ dataIndex: 0 });
    disposeChart('c-test');
    expect(chart.isDisposed()).toBe(true);
    expect(getChart('c-test')).toBeNull();
  });

  it('re-themes in place without disposing', () => {
    renderChart('c-test', line);
    const chart = chartFor('c-test')!;
    const before = chart.theme;
    refreshChartsTheme();
    expect(chart.isDisposed()).toBe(false);
    expect(chart.theme).not.toBe(before);
  });

  it('returns null when the host is missing', () => {
    expect(renderChart('missing', line)).toBeNull();
  });
});

describe('chart groups', () => {
  const last = monthToTime('2026-06');
  const span =
    (from: string): (() => ChartOption) =>
    () => ({
      xAxis: { type: 'time' },
      yAxis: { type: 'value' },
      series: [
        {
          type: 'line',
          name: 'A',
          data: [
            [monthToTime(from), 1],
            [last, 2],
          ],
        },
      ],
    });

  beforeEach(() => {
    document.body.innerHTML = '<div id="c-a"></div><div id="c-b"></div><div id="c-solo"></div>';
    const opts = { zoom: true, xAxisType: 'time' as const };
    renderChart('c-a', span('2023-01'), { ...opts, group: 'g' });
    renderChart('c-b', span('2024-01'), { ...opts, group: 'g' });
    renderChart('c-solo', span('2023-01'), opts);
  });

  it('mirrors a manual zoom window by axis value', () => {
    const a = chartFor('c-a')!;
    const b = chartFor('c-b')!;
    const start = monthToTime('2025-01');
    a.option = { ...(a.option as AnyRec), dataZoom: [{ startValue: start, endValue: last }] };
    a.trigger('datazoom', {});
    expect(b.actions.at(-1)).toEqual({ type: 'dataZoom', startValue: start, endValue: last });
    // The peer's own datazoom event must not echo back to the source.
    expect(a.actions).toHaveLength(0);
  });

  it('clamps a mirrored window to the peer data extent', () => {
    const a = chartFor('c-a')!;
    const b = chartFor('c-b')!;
    const end = monthToTime('2025-06');
    a.option = {
      ...(a.option as AnyRec),
      dataZoom: [{ startValue: monthToTime('2023-03'), endValue: end }],
    };
    a.trigger('datazoom', {});
    expect(b.actions.at(-1)).toEqual({
      type: 'dataZoom',
      startValue: monthToTime('2024-01'),
      endValue: end,
    });
  });

  it('shows and hides the hover tooltip on peers at the same axis value', () => {
    const a = chartFor('c-a')!;
    const b = chartFor('c-b')!;
    a.trigger('updateaxispointer', { axesInfo: [{ axisDim: 'x', value: 1234 }] });
    expect(b.actions.at(-1)).toEqual({ type: 'showTip', x: 1234, y: 100 });
    a.trigger('globalout');
    expect(b.actions.at(-1)).toEqual({ type: 'hideTip' });
    expect(chartFor('c-solo')!.actions).toHaveLength(0);
  });
});

describe('chart drill-down', () => {
  const press = (chart: ReturnType<typeof chartFor>, x: number, y: number, upX = x) => {
    chart!.zr.trigger('mousedown', { offsetX: x, offsetY: y });
    chart!.zr.trigger('click', { offsetX: upX, offsetY: y });
  };
  const keys = (v: number) => (v >= 0 && v < 3 ? ['a', 'b', 'c'][Math.round(v)] : null);

  it('selects the key under a click on the x axis', () => {
    const select = vi.fn();
    renderChart('c-test', line, { drill: { resolve: keys, select } });
    const chart = chartFor('c-test')!;
    press(chart, 1.2, 40);
    expect(select).toHaveBeenCalledWith('b');
    expect(chart.actions.at(-1)).toEqual({ type: 'hideTip' });
  });

  it('resolves along the y axis for horizontal bars', () => {
    const select = vi.fn();
    renderChart('c-test', line, { drill: { axis: 'y', resolve: keys, select } });
    press(chartFor('c-test'), 40, 2);
    expect(select).toHaveBeenCalledWith('c');
  });

  it('ignores drags and points outside the data', () => {
    const select = vi.fn();
    renderChart('c-test', line, { drill: { resolve: keys, select } });
    const chart = chartFor('c-test')!;
    press(chart, 0, 10, 30);
    press(chart, 9, 10);
    expect(select).not.toHaveBeenCalled();
  });

  it('shows a pointer cursor only over drillable points', () => {
    renderChart('c-test', line, { drill: { resolve: keys, select: vi.fn() } });
    const chart = chartFor('c-test')!;
    chart.zr.trigger('mousemove', { offsetX: 9, offsetY: 0 });
    expect(chart.zr.cursor).not.toBe('pointer');
    chart.zr.trigger('mousemove', { offsetX: 1, offsetY: 0 });
    expect(chart.zr.cursor).toBe('pointer');
  });

  it('only navigates from the tooltip button on touch screens', () => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockReturnValue({ matches: true });
    const select = vi.fn();
    renderChart('c-test', () => ({ ...line(), tooltip: { trigger: 'axis' } }), {
      drill: { resolve: keys, select },
    });
    const chart = chartFor('c-test')!;
    expect((chart.option as AnyRec).tooltip.enterable).toBe(true);
    press(chart, 1, 0);
    press(chart, 1, 0);
    expect(select).not.toHaveBeenCalled();

    const host = document.getElementById('c-test')!;
    host.insertAdjacentHTML('beforeend', tooltipHint(drillHint({ touch: true }, 'open month')));
    host.querySelector<HTMLButtonElement>('[data-chart-drill]')!.click();
    expect(select).toHaveBeenCalledWith('b');

    // A tap outside the data clears the pending target.
    select.mockClear();
    press(chart, 9, 0);
    host.querySelector<HTMLButtonElement>('[data-chart-drill]')!.click();
    expect(select).not.toHaveBeenCalled();
  });

  it('stamps the drill target on the tooltip button so a scrub (no tap) still opens it', () => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockReturnValue({ matches: true });
    const select = vi.fn();
    renderChart(
      'c-test',
      () => ({
        ...line(),
        tooltip: {
          trigger: 'axis',
          formatter: () => tooltipHint(drillHint({ touch: true }, 'open month')),
        },
      }),
      { drill: { resolve: keys, select } },
    );
    const chart = chartFor('c-test')!;
    const html = (chart.option as AnyRec).tooltip.formatter([{ axisValue: 2, dataIndex: 0 }]);
    expect(html).toContain('data-chart-drill="c"');
    const host = document.getElementById('c-test')!;
    host.insertAdjacentHTML('beforeend', html);
    host.querySelector<HTMLButtonElement>('[data-chart-drill]')!.click();
    expect(select).toHaveBeenCalledWith('c');
  });

  it('uses the data index on category axes for the stamped target', () => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockReturnValue({ matches: true });
    renderChart(
      'c-test',
      () => ({
        xAxis: { type: 'category', data: ['a', 'b', 'c'] },
        yAxis: { type: 'value' },
        series: [{ type: 'bar', data: [1, 2, 3] }],
        tooltip: { trigger: 'axis', formatter: () => tooltipHint({ button: 'Go' }) },
      }),
      { drill: { resolve: keys, select: vi.fn() } },
    );
    const fmt = (chartFor('c-test')!.option as AnyRec).tooltip.formatter;
    expect(fmt([{ axisValue: 'b', dataIndex: 1 }])).toContain('data-chart-drill="b"');
  });

  it('opens on a touch release over the button and ignores the click that follows', () => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockReturnValue({ matches: true });
    const select = vi.fn();
    renderChart('c-test', line, { drill: { resolve: keys, select } });
    const host = document.getElementById('c-test')!;
    host.insertAdjacentHTML(
      'beforeend',
      tooltipHint({ button: 'Go' }).replace('data-chart-drill', 'data-chart-drill="a"'),
    );
    const btn = host.querySelector<HTMLButtonElement>('[data-chart-drill]')!;
    const pointer = (type: string, x: number) =>
      btn.dispatchEvent(
        Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 0 }), {
          pointerType: 'touch',
        }),
      );
    // A wobble past the slop does nothing.
    pointer('pointerdown', 0);
    pointer('pointerup', 40);
    expect(select).not.toHaveBeenCalled();
    pointer('pointerdown', 0);
    pointer('pointerup', 10);
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith('a');
    btn.click();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('builds a text hint on desktop and an escaped button on touch', () => {
    expect(drillHint({ touch: false }, 'open month')).toBe('Click to open month');
    expect(drillHint({ touch: true }, 'open month')).toEqual({ button: 'Open month' });
    expect(tooltipHint('Click to open')).toContain('Click to open');
    const html = tooltipHint({ button: '<b>Go</b>' });
    expect(html).toContain('data-chart-drill');
    expect(html).not.toContain('<b>');
  });

  it('leaves the expanded overlay before navigating', () => {
    document.body.innerHTML =
      '<div class="chart-card chart-expanded"><div id="c-test"></div></div>';
    document.body.classList.add('chart-expanded-open');
    renderChart('c-test', line, { drill: { resolve: keys, select: vi.fn() } });
    press(chartFor('c-test'), 0, 0);
    expect(document.querySelector('.chart-expanded')).toBeNull();
    expect(document.body.classList.contains('chart-expanded-open')).toBe(false);
  });

  it('does nothing without a drill option', () => {
    renderChart('c-test', line);
    const chart = chartFor('c-test')!;
    press(chart, 0, 0);
    expect(chart.actions).toHaveLength(0);
  });
});

describe('data table overlay', () => {
  it('opens from the toolbox and closes with the button or Escape', () => {
    document.body.innerHTML =
      '<div id="c-test" aria-label="Growth"></div><button id="other"></button>';
    renderChart('c-test', line);
    const chart = chartFor('c-test')!;
    const host = document.getElementById('c-test')!;
    const feature = (chart.option as AnyRec).toolbox.feature.myDataTable;
    expect(feature.title).toBe('Data table');
    feature.onclick(null, { getDom: () => host, getOption: () => chart.getOption() });

    const panel = host.querySelector<HTMLElement>('.chart-dataview')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-label')).toBe('Growth data');
    expect(panel.querySelector('h4')).toBeNull();
    expect(document.activeElement).toBe(panel.querySelector('.chart-dataview-close'));
    expect(panel.querySelector('tbody tr')!.textContent).toBe('Jan 20261\u00A0€');

    panel.querySelector<HTMLButtonElement>('.chart-dataview-close')!.click();
    expect(host.querySelector('.chart-dataview')).toBeNull();

    openDataTable(host, chart.getOption(), String);
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    host
      .querySelector('.chart-dataview')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', outer);
    expect(host.querySelector('.chart-dataview')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
  });

  it('is closed when the chart re-renders', () => {
    renderChart('c-test', line);
    const host = document.getElementById('c-test')!;
    openDataTable(host, chartFor('c-test')!.getOption(), String);
    renderChart('c-test', line);
    expect(host.querySelector('.chart-dataview')).toBeNull();
    closeDataTable(host);
  });
});

describe('dataViewTable', () => {
  it('renders time series as a formatted table using textContent', () => {
    const el = dataViewTable(
      {
        xAxis: [{ type: 'time' }],
        series: [
          {
            type: 'line',
            name: '<b>Total</b>',
            data: [
              [monthToTime('2026-02'), 2200],
              [monthToTime('2026-01'), 1000],
            ],
          },
        ],
      },
      (v) => `${v} €`,
    );
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => r.textContent);
    expect(rows).toEqual(['Jan 20261000 €', 'Feb 20262200 €']);
    expect(el.querySelector('th:nth-child(2)')!.textContent).toBe('<b>Total</b>');
    expect(el.querySelector('b')).toBeNull();
  });

  it('renders pie data as name/value rows', () => {
    const el = dataViewTable(
      { series: [{ type: 'pie', data: [{ name: 'ETF', value: 5 }] }] },
      (v) => String(v),
    );
    expect(el.querySelector('tbody tr')!.textContent).toBe('ETF5');
  });

  it('uses category axis labels', () => {
    const el = dataViewTable(
      {
        xAxis: [{ type: 'category', data: ['Jan', 'Feb'] }],
        series: [{ type: 'bar', name: 'X', data: [1, { value: 2 }] }],
      },
      (v) => String(v),
    );
    expect([...el.querySelectorAll('tbody td:first-child')].map((c) => c.textContent)).toEqual([
      'Jan',
      'Feb',
    ]);
  });
});
