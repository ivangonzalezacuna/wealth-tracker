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
import { dataViewTable } from './toolbox';
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
    expect(opt.aria.label.description).toBe(
      'Test chart. A: 1 points from Jan 2026 (1,00\u00A0€) to Jan 2026 (1,00\u00A0€).',
    );
    expect(Object.keys(opt.toolbox.feature)).toEqual(
      expect.arrayContaining(['dataView', 'myFullscreen']),
    );
    expect(opt.grid.top).toBeGreaterThan(0);
    expect(getChart('c-test')).toBeTruthy();
  });

  it('adds inside + slider dataZoom and preset buttons that drive the window', () => {
    const start = monthToTime('2025-02');
    renderChart('c-test', line, {
      zoom: true,
      xAxisType: 'time',
      presets: [
        { key: '12', label: '1Y', startValue: start },
        { key: 'all', label: 'All' },
      ],
      defaultPreset: 'all',
    });
    const chart = chartFor('c-test')!;
    const opt = chart.option as AnyRec;
    expect(opt.dataZoom.map((z: AnyRec) => z.type)).toEqual(['inside', 'slider']);
    expect(opt.dataZoom[0]).toMatchObject({ start: 0, end: 100 });
    expect(opt.toolbox.feature.dataZoom).toBeDefined();
    expect(opt.toolbox.feature.restore).toBeDefined();

    const presets = (opt.graphic as AnyRec[]).find((g) => g.id === 'range-presets')!;
    expect(presets.children.map((c: AnyRec) => c.id)).toEqual(['preset-12', 'preset-all']);
    presets.children[0].onclick();
    expect(chart.actions.at(-1)).toMatchObject({ type: 'dataZoom', startValue: start, end: 100 });
    const updated = (chart.option as AnyRec).graphic[0].children[0];
    expect(updated.children[1].style.font).toContain('600');
  });

  it('clears the active preset when the user zooms manually', () => {
    renderChart('c-test', line, {
      zoom: true,
      presets: [{ key: 'all', label: 'All' }],
      defaultPreset: 'all',
    });
    const chart = chartFor('c-test')!;
    chart.trigger('datazoom', {});
    const btn = (chart.option as AnyRec).graphic[0].children[0];
    expect(btn.children[1].style.font).toContain('500');
  });

  it('keeps legend selection across re-renders', () => {
    const build = (): ChartOption => ({ ...line(), legend: {} });
    renderChart('c-test', build);
    const chart = chartFor('c-test')!;
    (chart.option as AnyRec).legend = {
      ...(chart.option as AnyRec).legend,
      selected: { A: false },
    };
    renderChart('c-test', build);
    expect((chart.option as AnyRec).legend.selected).toEqual({ A: false });
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
  const presetsFor = (last: number) => [
    { key: '12', label: '1Y', startValue: addMonths(last, -11), endValue: last },
    { key: 'all', label: 'All' },
  ];
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
    const opts = { zoom: true, xAxisType: 'time' as const, defaultPreset: 'all' };
    renderChart('c-a', span('2023-01'), { ...opts, presets: presetsFor(last), group: 'g' });
    renderChart('c-b', span('2024-01'), { ...opts, presets: presetsFor(last), group: 'g' });
    renderChart('c-solo', span('2023-01'), { ...opts, presets: presetsFor(last) });
  });

  it('mirrors range presets to charts in the same group', () => {
    const a = chartFor('c-a')!;
    const b = chartFor('c-b')!;
    (a.option as AnyRec).graphic[0].children[0].onclick();
    expect(b.actions.at(-1)).toMatchObject({ type: 'dataZoom', startValue: addMonths(last, -11) });
    expect((b.option as AnyRec).graphic[0].children[0].children[1].style.font).toContain('600');
    expect(chartFor('c-solo')!.actions).toHaveLength(0);
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
