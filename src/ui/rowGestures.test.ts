/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bindRowGestures } from './rowGestures';

let phone = true;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: phone }));
  vi.spyOn(history, 'pushState').mockImplementation(() => {});
  vi.spyOn(history, 'back').mockImplementation(() => {});
});
afterEach(async () => {
  window.dispatchEvent(new Event('scroll'));
  window.dispatchEvent(new PopStateEvent('popstate'));
  await vi.runAllTimersAsync();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  phone = true;
});
function pointer(target: HTMLElement, type: string, x = 200, y = 100) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.assign(event, { pointerType: 'touch', pointerId: 1, isPrimary: true });
  target.dispatchEvent(event);
}
function setup(enabled = true) {
  const container = document.createElement('div');
  container.innerHTML =
    '<div class="row" tabindex="0">One</div><div class="row" tabindex="0">Two</div>';
  document.body.append(container);
  const edit = vi.fn(),
    remove = vi.fn();
  const actions = () =>
    enabled
      ? [
          { label: 'Edit', run: edit },
          { label: 'Delete', run: remove },
        ]
      : [];
  bindRowGestures(container, '.row', actions);
  return { container, rows: [...container.children] as HTMLElement[], edit, remove, actions };
}
it('opens one touch menu, suppresses the follow-up row click, and runs an existing action', () => {
  const { container, rows, edit } = setup();
  const click = vi.fn();
  container.addEventListener('click', click);
  pointer(rows[0], 'pointerdown');
  vi.advanceTimersByTime(450);
  pointer(rows[0], 'pointerup');
  rows[0].click();
  expect(click).not.toHaveBeenCalled();
  expect(document.querySelectorAll('.gesture-menu')).toHaveLength(1);
  (document.querySelector('.gesture-menu button') as HTMLButtonElement).click();
  expect(edit).toHaveBeenCalledOnce();
  expect(document.querySelector('.gesture-menu')).toBeNull();
});
it('cancels a long press on movement or scroll and leaves desktop and disabled rows alone', () => {
  const { rows } = setup();
  pointer(rows[0], 'pointerdown');
  pointer(rows[0], 'pointermove', 200, 110);
  vi.advanceTimersByTime(500);
  expect(document.querySelector('.gesture-menu')).toBeNull();
  pointer(rows[0], 'pointerdown');
  window.dispatchEvent(new Event('scroll'));
  vi.advanceTimersByTime(500);
  expect(document.querySelector('.gesture-menu')).toBeNull();
  pointer(rows[0], 'pointerup');
  phone = false;
  pointer(rows[0], 'pointerdown');
  vi.advanceTimersByTime(500);
  expect(document.querySelector('.gesture-menu')).toBeNull();
  phone = true;
  const disabled = setup(false).rows[0];
  pointer(disabled, 'pointerdown');
  vi.advanceTimersByTime(500);
  expect(document.querySelector('.gesture-menu')).toBeNull();
});
it('allows one revealed row, does not auto-delete, and closes on scroll or rerender', () => {
  const { container, rows, remove, actions } = setup();
  const swipe = (row: HTMLElement) => {
    pointer(row, 'pointerdown');
    pointer(row, 'pointermove', 50);
    pointer(container, 'pointerup', 50);
  };
  swipe(rows[0]);
  expect(document.querySelectorAll('.gesture-row-actions')).toHaveLength(1);
  expect(remove).not.toHaveBeenCalled();
  swipe(rows[1]);
  expect(document.querySelectorAll('.gesture-row-actions')).toHaveLength(1);
  expect(rows[0].classList.contains('gesture-row')).toBe(false);
  window.dispatchEvent(new Event('scroll'));
  expect(document.querySelector('.gesture-row-actions')).toBeNull();
  swipe(rows[0]);
  bindRowGestures(container, '.row', actions);
  expect(document.querySelector('.gesture-row-actions')).toBeNull();
});
