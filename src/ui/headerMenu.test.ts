// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { headerMenuMarkup, initHeaderMenu } from './headerMenu';
import { whenOverlayHistorySettled } from './overlayHistory';
import type { UserThemePref } from '../theme';

const closeMenus: (() => void)[] = [];
function setup(theme: UserThemePref = 'system', diagnosticsEnabled = false) {
  document.body.innerHTML = `<header>${headerMenuMarkup(diagnosticsEnabled)}</header><main id="out">x</main>`;
  let current = theme;
  const onTheme = vi.fn((t: UserThemePref) => (current = t));
  const onSignOut = vi.fn();
  const onDiagnostics = vi.fn();
  const menu = initHeaderMenu({ getTheme: () => current, onTheme, onSignOut, onDiagnostics })!;
  closeMenus.push(menu.close);
  const btn = document.getElementById('btn-header-menu') as HTMLButtonElement;
  const list = document.getElementById('header-menu')!;
  const choice = (t: string) => list.querySelector<HTMLElement>(`[data-theme-choice="${t}"]`)!;
  const key = (target: HTMLElement, k: string) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  return { menu, btn, list, choice, onTheme, onSignOut, onDiagnostics, key };
}

describe('header menu', () => {
  beforeEach(() => {
    vi.spyOn(history, 'back').mockImplementation(() =>
      queueMicrotask(() => window.dispatchEvent(new PopStateEvent('popstate'))),
    );
  });
  afterEach(async () => {
    closeMenus.splice(0).forEach((close) => close());
    await whenOverlayHistorySettled();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
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

  it('only offers Sign out when signed in, after its history entry settles', async () => {
    const { menu, btn, onSignOut, list } = setup();
    const signOut = document.getElementById('btn-signout')!;
    expect(signOut.closest('[hidden]')).not.toBeNull();
    menu.setSignedIn(true);
    btn.click();
    expect(signOut.closest('[hidden]')).toBeNull();
    signOut.click();
    expect(onSignOut).not.toHaveBeenCalled();
    await whenOverlayHistorySettled();
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

  it('only shows and opens diagnostics when the build enables profiling', () => {
    setup();
    expect(document.getElementById('btn-performance-diagnostics')).toBeNull();
    const { btn, list, onDiagnostics } = setup('system', true);
    btn.click();
    document.getElementById('btn-performance-diagnostics')!.click();
    expect(onDiagnostics).toHaveBeenCalledTimes(1);
    expect(list.hidden).toBe(true);
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
