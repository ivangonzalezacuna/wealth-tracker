/** Calls `close` when anything scrolls (page or inner scroller) or the viewport resizes. */
export function closeOnScroll(close: () => void): () => void {
  const opts = { passive: true, capture: true };
  window.addEventListener('scroll', close, opts);
  window.addEventListener('resize', close, opts);
  return () => {
    window.removeEventListener('scroll', close, opts);
    window.removeEventListener('resize', close, opts);
  };
}

/** Popovers sit below the navigation, except above a fixed layer (dialog, dock) holding the trigger. */
export function stackAboveLayer(trigger: HTMLElement, pop: HTMLElement): void {
  for (
    let node = trigger.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    if (style.position !== 'fixed') continue;
    const z = parseInt(style.zIndex, 10);
    if (!Number.isNaN(z)) pop.style.zIndex = String(z + 1);
    return;
  }
}
