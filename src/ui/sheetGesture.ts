import { bindGesture, isPhone, reducedMotion } from './gesture';

export function bindSheetGesture(overlay: HTMLElement, dismiss: () => void): () => void {
  if (!isPhone()) return () => {};
  const card = overlay.querySelector<HTMLElement>('.dialog-card');
  if (!card || overlay.matches('.confirm-overlay, .conflict-overlay')) return () => {};
  const grip = document.createElement('div');
  grip.className = 'sheet-grip';
  grip.setAttribute('aria-hidden', 'true');
  card.prepend(grip);
  let eligible = false;
  let suppressClick = false;
  const reset = () => {
    card.style.transition = reducedMotion() ? 'none' : 'transform 180ms ease-out';
    card.style.transform = '';
    overlay.style.backgroundColor = '';
  };
  const atTop = () =>
    ![card, ...card.querySelectorAll<HTMLElement>('*')].some((el) => el.scrollTop > 0);
  const update = () => card.classList.toggle('sheet-at-top', isPhone() && atTop());
  update();
  card.addEventListener('scroll', update, true);
  const cleanup = bindGesture(card, {
    axis: 'y',
    start(e) {
      if (!isPhone() || (e.target as HTMLElement).closest('button, a, summary')) return false;
      eligible = !!(e.target as HTMLElement).closest('.sheet-grip, .dialog-header') || atTop();
      return eligible;
    },
    lock: (_dx, dy) => eligible && dy > 0,
    move(_dx, dy) {
      suppressClick = true;
      card.style.animation = 'none';
      card.style.transition = 'none';
      card.style.transform = 'translateY(' + Math.max(0, dy) + 'px)';
      overlay.style.backgroundColor =
        'rgba(0, 0, 0, ' + 0.45 * (1 - Math.min(1, dy / card.offsetHeight)) + ')';
    },
    end(_dx, dy, velocity) {
      if (dy > card.offsetHeight * 0.25 || (dy > 40 && velocity > 0.6)) dismiss();
      reset();
    },
    cancel: reset,
  });
  const click = (e: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const clearClick = () => {
    suppressClick = false;
  };
  card.addEventListener('click', click, true);
  card.addEventListener('pointerdown', clearClick, true);
  return () => {
    cleanup();
    reset();
    grip.remove();
    card.removeEventListener('scroll', update, true);
    card.removeEventListener('click', click, true);
    card.removeEventListener('pointerdown', clearClick, true);
  };
}
