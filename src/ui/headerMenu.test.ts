// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { headerMenuMarkup, initHeaderMenu } from './headerMenu';
import type { UserThemePref } from '../theme';

function setup(theme: UserThemePref = 'system') {
  document.body.innerHTML = `<header>${headerMenuMarkup()}</header><main id="out">x</main>`;
  let current = theme;
  const onTheme = vi.fn((t: UserThemePref) => (current = t));
  const onSignOut = vi.fn();
  const menu = initHeaderMenu({ getTheme: () => current, onTheme, onSignOut })!;
  const btn = document.getElementById('btn-header-menu') as HTMLButtonElement;
  const list = document.getElementById('header-menu')!;
  const choice = (t: string) => list.querySelector<HTMLElement>(`[data-theme-choice="${t}"]`)!;
  const key = (target: HTMLElement, k: string) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  return { menu, btn, list, choice, onTheme, onSignOut, key };
}

describe('header menu', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('opens on click with the current theme checked and focused', () => {
    const { btn, list, choice } = setup('dark');
    expect(list.hidden).toBe(true);
    btn.click();
    expect(list.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(choice('dark').getAttribute('aria-checked')).toBe('true');
    expect(choice('light').getAttribute('aria-checked')).toBe('false');
    expect(document.activeElement).toBe(choice('dark'));
  });

  it('picking a theme applies it and keeps the menu open', () => {
    const { btn, list, choice, onTheme } = setup('system');
    btn.click();
    choice('light').click();
    expect(onTheme).toHaveBeenCalledWith('light');
    expect(choice('light').getAttribute('aria-checked')).toBe('true');
    expect(list.hidden).toBe(false);
  });

  it('only offers Sign out when signed in', () => {
    const { menu, btn, onSignOut, list } = setup();
    const signOut = document.getElementById('btn-signout')!;
    expect(signOut.closest('[hidden]')).not.toBeNull();
    menu.setSignedIn(true);
    btn.click();
    expect(signOut.closest('[hidden]')).toBeNull();
    signOut.click();
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(list.hidden).toBe(true);
  });

  it('shows the connected account email when known', () => {
    const { menu } = setup();
    const note = document.querySelector<HTMLElement>('.header-menu-note')!;
    menu.setAccount('me@example.com');
    expect(note.textContent).toBe('Signed in as me@example.com');
    menu.setAccount(null);
    expect(note.textContent).toBe('Signed in with Google');
  });

  it('arrow keys move between items, Escape closes and refocuses the button', () => {
    const { menu, btn, list, choice, key } = setup('light');
    menu.setSignedIn(true);
    btn.click();
    key(list, 'ArrowDown');
    expect(document.activeElement).toBe(choice('dark'));
    key(list, 'End');
    expect(document.activeElement?.id).toBe('btn-signout');
    key(list, 'ArrowDown');
    expect(document.activeElement).toBe(choice('light'));
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    list.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(btn);
  });

  it('closes on an outside press', () => {
    const { btn, list } = setup();
    btn.click();
    document.getElementById('out')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(list.hidden).toBe(true);
  });
});
