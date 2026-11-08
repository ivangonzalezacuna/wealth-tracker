const PHONE_QUERY = '(max-width: 640px)';

export function isMobileLayout(): boolean {
  return document.body.classList.contains('mobile-ui-pilot') && matchMedia(PHONE_QUERY).matches;
}

export interface MobileNavigation {
  reset(): void;
}

export function initMobileNavigation(): MobileNavigation {
  const nav = document.querySelector<HTMLElement>('.nav')!;
  const phone = matchMedia(PHONE_QUERY);
  document.body.classList.toggle(
    'mobile-ui-pilot',
    new URLSearchParams(location.search).get('mobile-ui') === '1',
  );
  if (document.body.classList.contains('mobile-ui-pilot')) {
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (viewport && !viewport.content.includes('viewport-fit'))
      viewport.content += ', viewport-fit=cover';
  }
  let lastY = 0;
  let distance = 0;
  let direction = 0;
  let intentUntil = 0;
  let stableUntil = 0;
  let keyboard = false;
  let frame = 0;

  const position = () =>
    Math.max(
      0,
      Math.min(scrollY, Math.max(0, document.documentElement.scrollHeight - innerHeight)),
    );
  function reveal(): void {
    document.body.classList.remove('mobile-nav-hidden');
  }
  function reset(): void {
    lastY = position();
    distance = 0;
    direction = 0;
    intentUntil = 0;
    stableUntil = 0;
    reveal();
  }
  function blocked(): boolean {
    return (
      document.body.style.overflow === 'hidden' ||
      document.body.classList.contains('chart-expanded-open') ||
      document.querySelector('.header-menu-list:not([hidden])') !== null
    );
  }
  function onIntent(event: Event): void {
    if (!isMobileLayout() || !(event.target instanceof Element)) return;
    if (event.target.closest('.dialog-overlay,.nav,.chart-expanded')) return;
    for (let el: Element | null = event.target; el && el !== document.body; el = el.parentElement) {
      if (
        /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
        el.scrollHeight > el.clientHeight + 2
      )
        return;
    }
    intentUntil = performance.now() + 800;
  }
  function update(): void {
    frame = 0;
    const y = position();
    const delta = y - lastY;
    lastY = y;
    const now = performance.now();
    if (!isMobileLayout() || blocked()) {
      distance = 0;
      direction = 0;
      return;
    }
    const remaining = document.documentElement.scrollHeight - innerHeight - y;
    if (y <= 32 || remaining <= nav.offsetHeight + 16) {
      distance = 0;
      direction = 0;
      reveal();
      return;
    }
    if (now > intentUntil) {
      distance = 0;
      direction = 0;
      return;
    }
    if (Math.abs(delta) < 2) return;
    if (Math.sign(delta) !== direction) {
      direction = Math.sign(delta);
      distance = 0;
    }
    distance += Math.abs(delta);
    const hidden = document.body.classList.contains('mobile-nav-hidden');
    const nextHidden =
      direction < 0 && distance >= 10
        ? false
        : direction > 0 && distance >= 48 && y > 80 && now >= stableUntil
          ? true
          : hidden;
    if (nextHidden === hidden || (keyboard && nav.contains(document.activeElement))) return;
    document.body.classList.toggle('mobile-nav-hidden', nextHidden);
    stableUntil = now + 140;
    distance = 0;
    direction = 0;
  }
  window.addEventListener(
    'scroll',
    () => {
      if (!frame) frame = requestAnimationFrame(update);
    },
    { passive: true },
  );
  window.addEventListener('wheel', onIntent, { passive: true });
  window.addEventListener('touchmove', onIntent, { passive: true });
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
      if (event.key === 'Tab' || nav.contains(event.target as Node)) reset();
      if (
        event.target instanceof Element &&
        !event.target.matches('input,textarea,select,[contenteditable="true"]') &&
        ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(event.key)
      )
        intentUntil = performance.now() + 800;
    },
    true,
  );
  // Keep hidden tabs in the accessibility tree. Keyboard or AT focus reveals them.
  nav.addEventListener('focusin', reveal);
  phone.addEventListener('change', reset);
  window.addEventListener('resize', reset);
  window.visualViewport?.addEventListener('resize', reset);
  reset();
  return { reset };
}
