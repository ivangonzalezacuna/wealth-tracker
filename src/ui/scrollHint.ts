/** Fade the edges of a horizontally scrollable strip while more content sits
 *  beyond them, so cut-off items read as "scroll for more". Returns an update
 *  function to call after the strip's content changes. */
export function attachScrollHint(el: HTMLElement): () => void {
  const update = (): void => {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('can-scroll-left', max > 1 && el.scrollLeft > 1);
    el.classList.toggle('can-scroll-right', max > 1 && max - el.scrollLeft > 1);
  };
  el.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(el);
  update();
  return update;
}
