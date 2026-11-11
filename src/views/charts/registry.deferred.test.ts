/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as Registry from './registry';
import * as echarts from './echartsMock';

let registry: typeof Registry | undefined;

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
});

afterEach(() => {
  registry?._resetChartsForTests();
  echarts.resetMockCharts();
  vi.unstubAllGlobals();
  vi.doUnmock('./core');
  vi.resetModules();
  vi.restoreAllMocks();
});

function observers(): Array<(host: HTMLElement, visible: boolean) => void> {
  const callbacks: Array<(host: HTMLElement, visible: boolean) => void> = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '200px 0px';
      readonly scrollMargin = '0px';
      readonly thresholds = [0];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      constructor(callback: IntersectionObserverCallback) {
        callbacks.push((target, isIntersecting) => {
          const rect = target.getBoundingClientRect();
          callback(
            [
              {
                target,
                isIntersecting,
                time: 0,
                boundingClientRect: rect,
                intersectionRect: rect,
                rootBounds: null,
                intersectionRatio: isIntersecting ? 1 : 0,
              },
            ],
            this,
          );
        });
      }
    },
  );
  return callbacks;
}

it('rechecks visibility, disposal and latest data after a slow chunk load', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.doMock('./core', async () => {
    await gate;
    return { echarts };
  });
  registry = await import('./registry');
  document.body.innerHTML =
    '<div id="hidden"></div><div id="removed"></div><div id="latest"></div>';
  const callbacks = observers();
  const first = vi.fn(() => ({}));
  const latest = vi.fn(() => ({}));
  for (const id of ['hidden', 'removed', 'latest']) {
    registry.renderChart(id, first, { deferUntilVisible: true });
    callbacks.at(-1)!(document.getElementById(id)!, true);
  }
  callbacks[0](document.getElementById('hidden')!, false);
  registry.disposeChart('removed');
  registry.renderChart('latest', latest, { deferUntilVisible: true });
  release();
  await registry.loadCharts();
  await vi.waitFor(() => expect(registry!.getChart('latest')).not.toBeNull());
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledOnce();
  expect(registry.getChart('hidden')).toBeNull();
  expect(registry.getChart('removed')).toBeNull();
  callbacks[0](document.getElementById('hidden')!, true);
  expect(registry.getChart('hidden')).not.toBeNull();
});

it('reports a failed chunk load and permits a later retry', async () => {
  vi.doMock('./core', async () => {
    throw new Error('Synthetic chunk failure');
  });
  registry = await import('./registry');
  document.body.innerHTML = '<div id="chart"></div>';
  const callbacks = observers();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  registry.renderChart('chart', () => ({}), { deferUntilVisible: true });
  callbacks[0](document.getElementById('chart')!, true);
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  expect(document.getElementById('chart')!.textContent).toContain('Chart could not be loaded');
  expect(document.getElementById('chart')!.hasAttribute('aria-busy')).toBe(false);
  vi.doMock('./core', () => ({ echarts }));
  registry.renderChart('chart', () => ({}), { deferUntilVisible: true });
  callbacks[1](document.getElementById('chart')!, true);
  await vi.waitFor(() => expect(registry!.getChart('chart')).not.toBeNull());
});
