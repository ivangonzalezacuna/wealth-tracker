const PHONE_QUERY = '(max-width: 640px)';
const HIDE_AFTER = 40;
const REVEAL_AFTER = 10;
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
  // Marks where content ends and the reserved dock space begins.
  const end = document.createElement('div');
  end.className = 'mobile-nav-end';
  end.setAttribute('aria-hidden', 'true');
  document.body.append(end);
  let lastY = 0;
  let lastHeight = 0;
  let lastWidth = innerWidth;
  let travel = 0;
  let atEnd = false;
  let keyboard = false;
  let inputAt = 0;
  let frame = 0;

  const syncViewport = () => {
    if (viewport)
      viewport.content = phone.matches ? `${baseViewport}, viewport-fit=cover` : baseViewport;
  };
  const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - innerHeight);
  const position = () => Math.max(0, Math.min(scrollY, maxScroll()));
  const isHidden = () => document.body.classList.contains('mobile-nav-hidden');
  function setHidden(hidden: boolean): void {
    travel = 0;
    document.body.classList.toggle('mobile-nav-hidden', hidden);
  }
  function reset(): void {
    lastY = position();
    lastHeight = document.documentElement.scrollHeight;
    setHidden(false);
  }
  const blocked = () =>
    document.body.style.overflow === 'hidden' ||
    document.body.classList.contains('chart-expanded-open') ||
    document.querySelector('.header-menu-list:not([hidden])') !== null;

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
    const remaining = maxScroll() - y;
    // The dock returns once the space reserved for it shows, and at the top.
    if (atEnd || y <= TOP_ZONE || remaining <= nav.offsetHeight + 16) {
      if (isHidden()) setHidden(false);
      travel = 0;
      return;
    }
    // Lazy content and scroll anchoring can move the page without user input.
    if (delta === 0 || (layoutShift && performance.now() - inputAt > 500)) return;
    if (Math.sign(delta) !== Math.sign(travel)) travel = 0;
    travel += delta;
    // Hiding with less than a screen left would only flash the dock before the end.
    if (
      !isHidden() &&
      travel >= HIDE_AFTER &&
      remaining > innerHeight &&
      !(keyboard && nav.contains(document.activeElement))
    )
      setHidden(true);
    else if (isHidden() && travel <= -REVEAL_AFTER) setHidden(false);
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  new IntersectionObserver(([entry]) => {
    atEnd = entry.isIntersecting;
    schedule();
  }).observe(end);
  window.addEventListener('scroll', schedule, { passive: true });
  const markInput = () => {
    inputAt = performance.now();
  };
  window.addEventListener('wheel', markInput, { passive: true });
  window.addEventListener('touchmove', markInput, { passive: true });
  window.addEventListener('pointerdown', () => (keyboard = false), { passive: true });
  document.addEventListener(
    'keydown',
    (event) => {
      keyboard = true;
      markInput();
      if (event.key === 'Tab' || nav.contains(event.target as Node)) reset();
    },
    true,
  );
  nav.addEventListener('focusin', () => setHidden(false));
  phone.addEventListener('change', () => {
    syncViewport();
    reset();
  });
  // Mobile URL bars change only the viewport height mid-scroll; only width changes reset.
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
