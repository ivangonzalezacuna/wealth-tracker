const PHONE_QUERY = '(max-width: 640px)';
/** Downward travel before the dock hides, and upward travel before it returns. */
const HIDE_AFTER = 40;
const REVEAL_AFTER = 10;
/** The dock stays pinned near the top of a page. */
const TOP_ZONE = 64;

export function isMobileLayout(): boolean {
  return matchMedia(PHONE_QUERY).matches;
}

export interface MobileNavigation {
  reset(): void;
}

export function initMobileNavigation(): MobileNavigation {
  const nav = document.querySelector<HTMLElement>('.nav')!;
  const phone = matchMedia(PHONE_QUERY);
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const baseViewport = viewport?.content.replace(/,\s*viewport-fit=cover/, '') ?? '';
  let lastY = 0;
  let lastHeight = 0;
  let lastWidth = innerWidth;
  let travel = 0;
  let keyboard = false;
  let inputAt = 0;
  let frame = 0;

  function syncViewport(): void {
    // Safe-area insets only apply to the phone dock, so wider layouts keep the default fit.
    if (viewport)
      viewport.content = phone.matches ? `${baseViewport}, viewport-fit=cover` : baseViewport;
  }
  const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - innerHeight);
  const position = () => Math.max(0, Math.min(scrollY, maxScroll()));
  function setHidden(hidden: boolean): void {
    travel = 0;
    document.body.classList.toggle('mobile-nav-hidden', hidden);
  }
  function reset(): void {
    lastY = position();
    lastHeight = document.documentElement.scrollHeight;
    setHidden(false);
  }
  function blocked(): boolean {
    return (
      document.body.style.overflow === 'hidden' ||
      document.body.classList.contains('chart-expanded-open') ||
      document.querySelector('.header-menu-list:not([hidden])') !== null
    );
  }
  function update(): void {
    frame = 0;
    const y = position();
    const height = document.documentElement.scrollHeight;
    const delta = y - lastY;
    const layoutShift = height !== lastHeight;
    lastY = y;
    lastHeight = height;
    if (!phone.matches || blocked()) {
      travel = 0;
      return;
    }
    const max = maxScroll();
    const dock = nav.offsetHeight;
    // Pages with little to scroll gain nothing from hiding, and the page end always shows the
    // dock so the final content is never left above an empty gap.
    if (max < dock * 4 || y <= TOP_ZONE || max - y <= dock + 16) {
      if (document.body.classList.contains('mobile-nav-hidden')) setHidden(false);
      travel = 0;
      return;
    }
    // Lazy content and scroll anchoring can move the page without user input; skip those frames.
    if (delta === 0 || (layoutShift && performance.now() - inputAt > 500)) return;
    if (Math.sign(delta) !== Math.sign(travel)) travel = 0;
    travel += delta;
    const hidden = document.body.classList.contains('mobile-nav-hidden');
    if (!hidden && travel >= HIDE_AFTER && !(keyboard && nav.contains(document.activeElement)))
      setHidden(true);
    else if (hidden && travel <= -REVEAL_AFTER) setHidden(false);
  }
  window.addEventListener(
    'scroll',
    () => {
      if (!frame) frame = requestAnimationFrame(update);
    },
    { passive: true },
  );
  const markInput = () => {
    inputAt = performance.now();
  };
  window.addEventListener('wheel', markInput, { passive: true });
  window.addEventListener('touchmove', markInput, { passive: true });
  window.addEventListener(
    'pointerdown',
    () => {
      keyboard = false;
    },
    { passive: true },
  );
  document.addEventListener(
    'keydown',
    (event) => {
      keyboard = true;
      markInput();
      if (event.key === 'Tab' || nav.contains(event.target as Node)) reset();
    },
    true,
  );
  // Keep hidden tabs in the accessibility tree. Keyboard or AT focus reveals them.
  nav.addEventListener('focusin', () => setHidden(false));
  phone.addEventListener('change', () => {
    syncViewport();
    reset();
  });
  // Mobile browsers resize the viewport height while their URL bar collapses mid-scroll.
  // Only a width change is a real layout change.
  window.addEventListener('resize', () => {
    if (innerWidth === lastWidth) return;
    syncViewport();
    lastWidth = innerWidth;
    reset();
  });
  syncViewport();
  reset();
  return { reset };
}
