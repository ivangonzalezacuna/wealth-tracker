/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { bindSheetGesture } from './sheetGesture';

let cleanup = () => {};
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
function pointer(target: HTMLElement, type: string, dy: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 100 + dy,
  });
  Object.assign(event, { pointerType: 'touch', pointerId: 1, isPrimary: true });
  target.dispatchEvent(event);
}
function setup() {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: !q.includes('reduced-motion') }));
  const overlay = document.createElement('div');
  overlay.innerHTML =
    '<div class="dialog-card"><div class="dialog-header">Title</div><div class="content">Content</div></div>';
  document.body.append(overlay);
  const card = overlay.firstElementChild as HTMLElement;
  const header = card.firstElementChild as HTMLElement;
  const content = card.lastElementChild as HTMLElement;
  Object.defineProperty(card, 'offsetHeight', { value: 400 });
  const dismiss = vi.fn();
  cleanup = bindSheetGesture(overlay, dismiss);
  return { overlay, card, header, content, dismiss };
}
it('springs back below the threshold and after a dismissal is refused', () => {
  const { card, header, dismiss } = setup();
  pointer(header, 'pointerdown', 0);
  pointer(header, 'pointermove', 25);
  pointer(header, 'pointercancel', 25);
  expect(card.style.transform).toBe('');
  expect(dismiss).not.toHaveBeenCalled();
  pointer(header, 'pointerdown', 0);
  pointer(header, 'pointermove', 120);
  expect(card.style.transform).toBe('translateY(120px)');
  pointer(header, 'pointerup', 120);
  expect(dismiss).toHaveBeenCalledOnce();
  expect(card.style.transform).toBe('');
  expect(card.style.transition).toContain('180ms');
});
it('does not steal upward scrolling or downward scrolling away from the top', () => {
  const { card, content, dismiss } = setup();
  pointer(content, 'pointerdown', 0);
  pointer(content, 'pointermove', -50);
  pointer(content, 'pointerup', -50);
  expect(dismiss).not.toHaveBeenCalled();
  content.scrollTop = 50;
  content.dispatchEvent(new Event('scroll'));
  expect(card.classList.contains('sheet-at-top')).toBe(false);
  pointer(content, 'pointerdown', 0);
  pointer(content, 'pointermove', 150);
  pointer(content, 'pointerup', 150);
  expect(dismiss).not.toHaveBeenCalled();
  expect(card.style.transform).toBe('');
});

it('allows the grab handle to dismiss even when the content is scrolled', () => {
  const { card, content, dismiss } = setup();
  content.scrollTop = 50;
  content.dispatchEvent(new Event('scroll'));
  const grip = card.querySelector<HTMLElement>('.sheet-grip')!;
  pointer(grip, 'pointerdown', 0);
  pointer(grip, 'pointermove', 120);
  pointer(grip, 'pointerup', 120);
  expect(dismiss).toHaveBeenCalledOnce();
});
