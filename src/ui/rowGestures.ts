import { bindGesture, isPhone, reducedMotion } from './gesture';
import { trackOverlay } from './overlayHistory';
import { DELETE_ICON, EDIT_ICON } from '../views/icons';

export interface RowAction {
  label: string;
  run: () => void;
}
const ACTION_WIDTH = 64;
const bound = new WeakMap<HTMLElement, () => void>();
let closeActive = () => {};

export function bindRowGestures(
  container: HTMLElement | null,
  selector: string,
  actionsFor: (row: HTMLElement) => RowAction[],
): void {
  if (!container) return;
  const existing = bound.get(container);
  if (existing) {
    existing();
    return;
  }
  let row: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let suppressClick = false;
  let menu: HTMLElement | null = null;
  let rail: HTMLElement | null = null;
  let releaseHistory: (() => void) | undefined;
  let actions: RowAction[] = [];
  let base = 0;
  const reveal = () => actions.length * ACTION_WIDTH;
  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const close = () => {
    clearTimer();
    base = 0;
    if (menu && row?.isConnected) row.focus({ preventScroll: true });
    menu?.remove();
    menu = null;
    const swiped = row;
    const panel = rail;
    rail = null;
    swiped?.classList.remove('gesture-dragging');
    swiped?.style.removeProperty('--swipe-x');
    const finish = () => {
      panel?.remove();
      if (swiped && !swiped.querySelector('.gesture-row-actions'))
        swiped.classList.remove('gesture-row');
    };
    if (panel && !reducedMotion()) setTimeout(finish, 180);
    else finish();
    releaseHistory?.();
    releaseHistory = undefined;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', keydown, true);
    window.removeEventListener('scroll', close, true);
  };
  bound.set(container, close);
  const outside = (e: PointerEvent) => {
    if (menu ? !menu.contains(e.target as Node) : !row?.contains(e.target as Node)) close();
  };
  const keydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
    if (menu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const buttons = [...menu.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? buttons.length - 1
            : (index + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
      ]?.focus();
    }
    if (e.key === 'Tab') close();
  };
  const watch = () => {
    closeActive = close;
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('scroll', close, true);
  };
  const buttons = (target: HTMLElement, popover: boolean) => {
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      const remove = action.label === 'Delete';
      if (popover) {
        button.className = 'header-menu-item';
        button.setAttribute('role', 'menuitem');
        button.textContent = action.label;
      } else {
        button.className = 'gesture-action';
        button.innerHTML = `${remove ? DELETE_ICON : EDIT_ICON}<span>${action.label}</span>`;
      }
      if (remove) button.classList.add('gesture-delete');
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        // Actions may click the row's own buttons; that click must not be swallowed.
        suppressClick = false;
        close();
        action.run();
      });
      target.append(button);
    }
  };
  const openMenu = () => {
    if (!row?.isConnected || menu) return;
    clearTimer();
    suppressClick = true;
    menu = document.createElement('div');
    menu.className = 'header-menu-list gesture-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Row actions');
    buttons(menu, true);
    document.body.append(menu);
    const rect = row.getBoundingClientRect();
    menu.style.left =
      Math.max(12, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 12)) +
      'px';
    menu.style.top =
      Math.max(12, Math.min(rect.bottom + 4, innerHeight - menu.offsetHeight - 12)) + 'px';
    releaseHistory = trackOverlay(close);
    watch();
    menu.querySelector('button')?.focus({ preventScroll: true });
  };
  bindGesture(container, {
    axis: 'x',
    start(e) {
      clearTimer();
      if (!isPhone() || (e.target as HTMLElement).closest('button, a, label, summary'))
        return false;
      const target = (e.target as HTMLElement).closest<HTMLElement>(selector);
      if (!target) return false;
      if (rail && target === row && !menu) {
        base = -reveal();
        return;
      }
      const next = actionsFor(target);
      if (!next.length || menu || rail) return false;
      closeActive();
      row = target;
      actions = next;
      suppressClick = false;
      watch();
      timer = setTimeout(openMenu, 450);
    },
    lock(dx) {
      clearTimer();
      return !menu && (base ? dx > 0 : dx < 0);
    },
    move(dx) {
      clearTimer();
      suppressClick = true;
      if (!row) return;
      row.classList.add('gesture-dragging');
      if (!rail) {
        row.classList.add('gesture-row');
        rail = document.createElement('div');
        rail.className = 'gesture-row-actions';
        buttons(rail, false);
        row.append(rail);
        watch();
      }
      row.style.setProperty('--swipe-x', Math.max(-reveal(), Math.min(0, base + dx)) + 'px');
    },
    end(dx) {
      row?.classList.remove('gesture-dragging');
      if (base + dx < (base ? -reveal() / 2 : -44)) {
        row?.style.setProperty('--swipe-x', -reveal() + 'px');
        base = 0;
      } else close();
    },
    cancel() {
      clearTimer();
      if (!menu && (!rail || row?.classList.contains('gesture-dragging'))) close();
    },
  });
  container.addEventListener(
    'pointerdown',
    () => {
      if (!menu && !rail) suppressClick = false;
    },
    true,
  );
  container.addEventListener(
    'click',
    (e) => {
      if ((e.target as HTMLElement).closest('.gesture-row-actions')) return;
      if (!suppressClick && !rail) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      suppressClick = false;
      if (!menu) close();
    },
    true,
  );
  container.addEventListener('contextmenu', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(selector);
    if (
      !isPhone() ||
      !target ||
      !actionsFor(target).length ||
      (e as PointerEvent).pointerType === 'mouse'
    )
      return;
    e.preventDefault();
    if (row === target && (timer || menu)) openMenu();
  });
  window.addEventListener('resize', close);
  window.addEventListener('overlaychange', () => {
    if (!menu) close();
  });
}
