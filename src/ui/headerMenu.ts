import type { UserThemePref } from '../theme';

/** Top-right header menu: theme choice (Light / Dark / System) and Sign out. */

const svg = (body: string) =>
  `<svg class="header-menu-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${body}</svg>`;

const THEME_ICONS: Record<UserThemePref, string> = {
  light: svg(
    '<circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.4v2M8 12.6v2M1.4 8h2M12.6 8h2M3.34 3.34l1.42 1.42M11.24 11.24l1.42 1.42M12.66 3.34l-1.42 1.42M4.76 11.24l-1.42 1.42" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  ),
  dark: svg(
    '<path d="M10.6 1.7a5.9 5.9 0 1 0 3.7 8.5A6.3 6.3 0 0 1 10.6 1.7Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  ),
  system: svg(
    '<rect x="2.2" y="2.4" width="11.6" height="8.2" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 13h4M8 10.8V13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  ),
};

const MORE_ICON = svg(
  '<circle cx="3.2" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="12.8" cy="8" r="1.3" fill="currentColor"/>',
);
const SIGN_OUT_ICON = svg(
  '<path d="M6.5 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10.5 5l3 3-3 3M13.3 8H6.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
);

const THEME_LABELS: Record<UserThemePref, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

export function headerMenuMarkup(): string {
  const themes = (Object.keys(THEME_LABELS) as UserThemePref[])
    .map(
      (t) =>
        `<button type="button" role="menuitemradio" aria-checked="false" class="header-menu-item" data-theme-choice="${t}" tabindex="-1">${THEME_ICONS[t]}<span>${THEME_LABELS[t]}</span></button>`,
    )
    .join('');
  return `<div class="header-menu">
    <button type="button" id="btn-header-menu" class="header-menu-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="header-menu" aria-label="Menu: theme and account" title="Theme and account">${MORE_ICON}</button>
    <div id="header-menu" class="header-menu-list" role="menu" aria-label="Theme and account" hidden>
      <div class="header-menu-label" id="header-menu-theme-label">Theme</div>
      <div role="group" aria-labelledby="header-menu-theme-label">${themes}</div>
      <div class="header-menu-account" hidden>
        <div class="header-menu-sep" role="separator"></div>
        <div class="header-menu-note">Signed in with Google</div>
        <button type="button" id="btn-signout" role="menuitem" class="header-menu-item" tabindex="-1">${SIGN_OUT_ICON}<span>Sign out</span></button>
      </div>
    </div>
  </div>`;
}

export interface HeaderMenu {
  /** Reflect the current theme preference (checked item). */
  setTheme(pref: UserThemePref): void;
  /** Show or hide the account section (Sign out). */
  setSignedIn(signedIn: boolean): void;
  /** Show which Google account this browser uses (null when unknown). */
  setAccount(email: string | null): void;
  close(): void;
}

export function initHeaderMenu(opts: {
  getTheme: () => UserThemePref;
  onTheme: (pref: UserThemePref) => void;
  onSignOut: () => void;
}): HeaderMenu | null {
  const btn = document.getElementById('btn-header-menu') as HTMLButtonElement | null;
  const menu = document.getElementById('header-menu');
  if (!btn || !menu) return null;
  const account = menu.querySelector<HTMLElement>('.header-menu-account')!;

  const items = () =>
    [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
      (el) => !el.closest('[hidden]'),
    );
  const isOpen = () => !menu.hidden;

  function setTheme(pref: UserThemePref): void {
    for (const el of menu!.querySelectorAll<HTMLElement>('[data-theme-choice]')) {
      el.setAttribute('aria-checked', String(el.dataset.themeChoice === pref));
    }
    btn!.dataset.theme = pref;
  }

  function close(returnFocus = false): void {
    if (!isOpen()) return;
    menu!.hidden = true;
    btn!.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    if (returnFocus) btn!.focus();
  }

  function open(focus: 'checked' | 'first' | 'last' | null): void {
    setTheme(opts.getTheme());
    menu!.hidden = false;
    btn!.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    const list = items();
    const target =
      focus === 'checked'
        ? (list.find((el) => el.getAttribute('aria-checked') === 'true') ?? list[0])
        : focus === 'first'
          ? list[0]
          : focus === 'last'
            ? list[list.length - 1]
            : null;
    target?.focus();
  }

  function onOutside(e: Event): void {
    const t = e.target as Node;
    if (!menu!.contains(t) && !btn!.contains(t)) close();
  }

  btn.addEventListener('click', () => {
    if (isOpen()) close();
    else open('checked');
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open(e.key === 'ArrowDown' ? 'first' : 'last');
    }
  });

  menu.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[role^="menuitem"]');
    if (!item) return;
    const theme = item.dataset.themeChoice as UserThemePref | undefined;
    if (theme) {
      // Stay open so the effect of each theme can be compared.
      opts.onTheme(theme);
      setTheme(theme);
      return;
    }
    if (item.id === 'btn-signout') {
      close(true);
      opts.onSignOut();
    }
  });

  menu.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const move = (n: number) => list[(n + list.length) % list.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(i + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(i - 1);
        break;
      case 'Home':
        e.preventDefault();
        move(0);
        break;
      case 'End':
        e.preventDefault();
        move(list.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case 'Tab':
        close();
        break;
    }
  });

  setTheme(opts.getTheme());
  return {
    setTheme,
    setSignedIn(signedIn) {
      account.hidden = !signedIn;
    },
    setAccount(email) {
      const note = account.querySelector<HTMLElement>('.header-menu-note');
      if (!note) return;
      note.textContent = email ? `Signed in as ${email}` : 'Signed in with Google';
      note.title = email ?? '';
    },
    close: () => close(),
  };
}
