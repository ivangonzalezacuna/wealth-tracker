import { PHONE_QUERY } from './mobileNavigation';

export const isPhone = () => window.matchMedia?.(PHONE_QUERY).matches ?? false;
export const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function ignoreGesture(event: PointerEvent): boolean {
  const target = event.target as HTMLElement;
  if (
    event.clientX < 20 ||
    event.clientX > window.innerWidth - 20 ||
    target.closest(
      'input, select, textarea, [contenteditable]:not([contenteditable="false"]), .chart-host',
    )
  )
    return true;
  for (let el: HTMLElement | null = target; el; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX))
      return true;
  }
  return false;
}

interface GestureOptions {
  axis?: 'x' | 'y';
  start(event: PointerEvent): boolean | void;
  lock?(dx: number, dy: number): boolean;
  move(dx: number, dy: number): void;
  end(dx: number, dy: number, velocity: number): void;
  cancel(): void;
}

export function bindGesture(element: HTMLElement, options: GestureOptions): () => void {
  let pointer: number | null = null;
  let x = 0,
    y = 0,
    last = 0,
    position = 0,
    velocity = 0;
  let locked = false;
  const reset = () => {
    const id = pointer;
    pointer = null;
    locked = false;
    if (id != null && element.hasPointerCapture?.(id)) element.releasePointerCapture(id);
  };
  const cancel = () => {
    if (pointer == null) return;
    reset();
    options.cancel();
  };
  const down = (e: PointerEvent) => {
    if (pointer != null) {
      cancel();
      return;
    }
    if (e.pointerType !== 'touch' || e.isPrimary === false || ignoreGesture(e)) return;
    if (options.start(e) === false) return;
    pointer = e.pointerId;
    x = e.clientX;
    y = e.clientY;
    last = e.timeStamp;
    position = velocity = 0;
  };
  const move = (e: PointerEvent) => {
    if (pointer !== e.pointerId) return;
    const dx = e.clientX - x,
      dy = e.clientY - y;
    if (!locked) {
      if (Math.hypot(dx, dy) < 8) return;
      if (
        (options.axis === 'x' && Math.abs(dy) >= Math.abs(dx)) ||
        (options.axis === 'y' && Math.abs(dx) >= Math.abs(dy)) ||
        options.lock?.(dx, dy) === false
      ) {
        cancel();
        return;
      }
      locked = true;
      try {
        element.setPointerCapture?.(e.pointerId);
      } catch {
        /* Synthetic pointers have no capture. */
      }
    }
    const next = options.axis === 'x' ? dx : dy;
    velocity = (next - position) / Math.max(1, e.timeStamp - last);
    position = next;
    last = e.timeStamp;
    if (e.cancelable) e.preventDefault();
    options.move(dx, dy);
  };
  const up = (e: PointerEvent) => {
    if (pointer !== e.pointerId) return;
    const active = locked;
    reset();
    if (active) options.end(e.clientX - x, e.clientY - y, e.timeStamp - last > 100 ? 0 : velocity);
    else options.cancel();
  };
  const lostCapture = (e: PointerEvent) => {
    if (e.target === element && e.pointerId === pointer) cancel();
  };
  // Without this Chrome starts its own fling and swallows the next tap to stop it.
  const touchMove = (e: TouchEvent) => {
    if (locked && e.cancelable) e.preventDefault();
  };
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move, { passive: false });
  element.addEventListener('touchmove', touchMove, { passive: false });
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', cancel);
  element.addEventListener('lostpointercapture', lostCapture);
  return () => {
    cancel();
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('touchmove', touchMove);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', cancel);
    element.removeEventListener('lostpointercapture', lostCapture);
  };
}
