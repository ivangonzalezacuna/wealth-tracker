/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindGesture, ignoreGesture, reducedMotion } from './gesture';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function pointer(target: HTMLElement, type: string, x: number, y: number, extra = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.assign(event, { pointerType: 'touch', pointerId: 1, isPrimary: true, ...extra });
  target.dispatchEvent(event);
  return event as PointerEvent;
}
function setup(axis: 'x' | 'y' = 'x') {
  const el = document.createElement('div');
  document.body.append(el);
  el.setPointerCapture = vi.fn();
  const callbacks = { axis, start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
  cleanups.push(bindGesture(el, callbacks));
  return { el, ...callbacks };
}
describe('touch gesture arbitration', () => {
  it('locks after eight pixels, captures only then, and reports displacement and velocity', () => {
    const { el, move, end } = setup();
    pointer(el, 'pointerdown', 100, 100);
    pointer(el, 'pointermove', 95, 101);
    expect(move).not.toHaveBeenCalled();
    expect(el.setPointerCapture).not.toHaveBeenCalled();
    pointer(el, 'pointermove', 75, 102);
    expect(el.setPointerCapture).toHaveBeenCalledWith(1);
    expect(move).toHaveBeenCalledWith(-25, 2);
    pointer(el, 'pointerup', 70, 102);
    expect(end).toHaveBeenCalledWith(-30, 2, expect.any(Number));
  });
  it('keeps a locked gesture when implicit capture transfers from a child', () => {
    const { el, cancel, end } = setup();
    const child = document.createElement('span');
    el.append(child);
    pointer(child, 'pointerdown', 100, 100);
    pointer(child, 'pointermove', 80, 100);
    pointer(child, 'lostpointercapture', 80, 100);
    expect(cancel).not.toHaveBeenCalled();
    pointer(el, 'pointermove', 60, 100);
    pointer(el, 'pointerup', 60, 100);
    expect(end).toHaveBeenCalledWith(-40, 0, expect.any(Number));
  });
  it('leaves perpendicular swipes to native scrolling and cancels pending presses', () => {
    const { el, move, cancel } = setup();
    pointer(el, 'pointerdown', 100, 100);
    pointer(el, 'pointermove', 101, 125);
    expect(cancel).toHaveBeenCalledOnce();
    expect(move).not.toHaveBeenCalled();
  });
  it('cancels on pointercancel and ignores additional fingers and mouse pointers', () => {
    const { el, start, cancel, end } = setup();
    pointer(el, 'pointerdown', 100, 100, { pointerType: 'mouse' });
    expect(start).not.toHaveBeenCalled();
    pointer(el, 'pointerdown', 100, 100);
    pointer(el, 'pointerdown', 150, 100, { pointerId: 2, isPrimary: false });
    expect(cancel).toHaveBeenCalledOnce();
    pointer(el, 'pointerup', 70, 100);
    expect(end).not.toHaveBeenCalled();
    pointer(el, 'pointerdown', 100, 100);
    pointer(el, 'pointercancel', 100, 100);
    expect(cancel).toHaveBeenCalledTimes(2);
  });
  it('ignores editable controls, charts, horizontal scrollers and OS screen edges', () => {
    const { el, start } = setup();
    el.innerHTML =
      '<input><select></select><textarea></textarea><div contenteditable="true"></div><div class="chart-host"></div>';
    for (const child of el.children) pointer(child as HTMLElement, 'pointerdown', 100, 100);
    pointer(el, 'pointerdown', 10, 100);
    pointer(el, 'pointerdown', innerWidth - 10, 100);
    expect(start).not.toHaveBeenCalled();
    el.style.overflowX = 'auto';
    Object.defineProperty(el, 'scrollWidth', { value: 500 });
    Object.defineProperty(el, 'clientWidth', { value: 100 });
    expect(ignoreGesture(pointer(el, 'pointerdown', 100, 100))).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });
  it('detects reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(reducedMotion()).toBe(true);
  });
});
