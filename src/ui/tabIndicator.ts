const TABLISTS = '.nav[role="tablist"], .subnav.range-toggle[role="tablist"]';

/** Slides one active-tab highlight per tablist instead of swapping button backgrounds. */
export function initTabIndicators(root: HTMLElement = document.body): void {
  let frame = 0;
  const observed = new WeakSet<Element>();
  const resize = new ResizeObserver(() => schedule());

  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(syncAll);
  }
  function sync(list: HTMLElement): void {
    if (!observed.has(list)) {
      observed.add(list);
      resize.observe(list);
    }
    const active = list.querySelector<HTMLElement>(':scope > [role="tab"][aria-selected="true"]');
    if (!active || list.getClientRects().length === 0) {
      list.classList.remove('tab-indicator', 'tab-indicator-animate');
      return;
    }
    const style = list.style;
    style.setProperty('--tab-x', `${active.offsetLeft}px`);
    style.setProperty('--tab-y', `${active.offsetTop}px`);
    style.setProperty('--tab-w', `${active.offsetWidth}px`);
    style.setProperty('--tab-h', `${active.offsetHeight}px`);
    if (!list.classList.contains('tab-indicator')) {
      list.classList.add('tab-indicator');
      // Enable the transition after the first placement has painted.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (list.classList.contains('tab-indicator')) list.classList.add('tab-indicator-animate');
        }),
      );
    }
  }
  function syncAll(): void {
    frame = 0;
    root.querySelectorAll<HTMLElement>(TABLISTS).forEach(sync);
  }

  new MutationObserver((records) => {
    const relevant = records.some(
      (record) =>
        (record.target instanceof Element && !!record.target.closest(TABLISTS)) ||
        [...record.addedNodes].some(
          (node) =>
            node instanceof Element && (node.matches(TABLISTS) || !!node.querySelector(TABLISTS)),
        ),
    );
    if (relevant) schedule();
  }).observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-selected', 'class', 'hidden'],
  });
  window.addEventListener('resize', schedule, { passive: true });
  void document.fonts?.ready.then(schedule);
  schedule();
}
