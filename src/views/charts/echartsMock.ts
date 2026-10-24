/**
 * Minimal `echarts/core` stand-in for jsdom unit tests (no canvas). Records options per host so
 * tests can assert on the generated chart option. Use with:
 *   vi.mock('echarts/core', () => import('./charts/echartsMock'));
 */
type Handler = (params: unknown) => void;

export interface MockChart {
  dom: HTMLElement;
  theme: unknown;
  option: Record<string, unknown> | null;
  options: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  handlers: Map<string, Handler[]>;
  disposed: boolean;
  group: string;
  setOption(option: Record<string, unknown>, opts?: unknown): void;
  getOption(): Record<string, unknown> | null;
  dispatchAction(action: Record<string, unknown>): void;
  on(event: string, handler: Handler): void;
  off(event: string): void;
  trigger(event: string, params?: unknown): void;
  resize(): void;
  convertToPixel(finder: unknown, value: unknown): number;
  convertFromPixel(finder: unknown, value: unknown): unknown;
  containPixel(finder: unknown, value: unknown): boolean;
  getZr(): MockZr;
  zr: MockZr;
  getHeight(): number;
  setTheme(theme: unknown): void;
  dispose(): void;
  isDisposed(): boolean;
}

export const instances: MockChart[] = [];
const byDom = new Map<HTMLElement, MockChart>();

/** zrender stand-in: tests fire raw pointer events with `chart.zr.trigger('click', {offsetX, offsetY})`. */
export interface MockZr {
  handlers: Map<string, Handler[]>;
  cursor: string;
  on(event: string, handler: Handler): void;
  trigger(event: string, params?: unknown): void;
  setCursorStyle(cursor: string): void;
}

function mockZr(): MockZr {
  return {
    handlers: new Map(),
    cursor: 'default',
    on(event, handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    },
    trigger(event, params) {
      for (const h of this.handlers.get(event) ?? []) h(params);
    },
    setCursorStyle(cursor) {
      this.cursor = cursor;
    },
  };
}

function toArrays(option: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(option)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && k !== 'aria' ? [v] : v;
  }
  return out;
}

function isNotMerge(opts: unknown): boolean {
  if (opts === true) return true;
  return Boolean(opts && typeof opts === 'object' && (opts as { notMerge?: boolean }).notMerge);
}

export function init(dom: HTMLElement, theme?: unknown): MockChart {
  const chart: MockChart = {
    dom,
    theme,
    option: null,
    options: [],
    actions: [],
    handlers: new Map(),
    disposed: false,
    group: '',
    setOption(option, opts) {
      this.option =
        isNotMerge(opts) || !this.option ? { ...option } : { ...this.option, ...option };
      this.options.push(option);
    },
    getOption() {
      return this.option ? toArrays(this.option) : null;
    },
    dispatchAction(action) {
      this.actions.push(action);
      this.trigger(String(action.type).toLowerCase(), action);
    },
    on(event, handler) {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
    },
    off(event) {
      this.handlers.delete(event);
    },
    trigger(event, params) {
      for (const h of this.handlers.get(event) ?? []) h(params);
    },
    resize() {},
    convertToPixel(_finder, value) {
      return Number(value);
    },
    // Pixels map 1:1 to axis values and the whole canvas is the plot.
    convertFromPixel(_finder, value) {
      return value;
    },
    containPixel() {
      return true;
    },
    zr: mockZr(),
    getZr() {
      return this.zr;
    },
    getHeight() {
      return 200;
    },
    setTheme(t) {
      this.theme = t;
    },
    dispose() {
      this.disposed = true;
      byDom.delete(dom);
    },
    isDisposed() {
      return this.disposed;
    },
  };
  instances.push(chart);
  byDom.set(dom, chart);
  return chart;
}

export function getInstanceByDom(dom: HTMLElement): MockChart | undefined {
  return byDom.get(dom);
}

export function use(): void {}
export function connect(): void {}
export function disconnect(): void {}
export function registerTheme(): void {}

/** Latest live (non-disposed) mock chart for a host id. */
export function chartFor(id: string): MockChart | undefined {
  return [...instances].reverse().find((c) => c.dom.id === id && !c.disposed);
}

export function resetMockCharts(): void {
  instances.length = 0;
  byDom.clear();
}
