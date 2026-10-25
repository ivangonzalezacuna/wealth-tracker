// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachCombobox, fillLinkedField, toComboOptions } from './combobox';

function setup(values = ['Alpha', 'Beta', 'Gamma'], value = '') {
  document.body.innerHTML = `<div class="dialog-overlay"><input id="f" class="form-input" value="${value}"><input id="linked" value=""></div>`;
  const input = document.getElementById('f') as HTMLInputElement;
  const handle = attachCombobox(input, toComboOptions(values));
  const wrap = input.closest('.combo') as HTMLElement;
  const toggle = wrap.querySelector('.combo-toggle') as HTMLButtonElement;
  const list = wrap.querySelector('[role="listbox"]') as HTMLElement;
  const shown = () => [...list.querySelectorAll('.combo-value')].map((el) => el.textContent);
  return { input, handle, wrap, toggle, list, shown };
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function key(input: HTMLInputElement, k: string) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  input.dispatchEvent(e);
  return e;
}

describe('combobox', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('wraps the input with ARIA wiring and an arrow button', () => {
    const { input, toggle, list } = setup();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hidden).toBe(false);
    expect(toggle.tabIndex).toBe(0);
    expect(list.hidden).toBe(true);
  });

  it('hides the arrow when there are no options', () => {
    const { toggle, wrap } = setup([]);
    expect(toggle.hidden).toBe(true);
    expect(wrap.classList.contains('has-options')).toBe(false);
  });

  it('the arrow lists every option and marks the current value', () => {
    const { toggle, list, shown, input } = setup(undefined, 'Beta');
    toggle.click();
    expect(list.hidden).toBe(false);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(shown()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(list.querySelector('.is-current')?.textContent).toBe('Beta');
    toggle.click();
    expect(list.hidden).toBe(true);
  });

  it('typing filters (prefix first) and keeps free text when nothing matches', () => {
    const { input, list, shown } = setup(['Gamma', 'Alpha', 'Malta']);
    type(input, 'al');
    expect(shown()).toEqual(['Alpha', 'Malta']);
    type(input, 'Zeta');
    expect(list.hidden).toBe(true);
    expect(input.value).toBe('Zeta');
  });

  it('picking an option fills the input and fires input + change', () => {
    const { input, toggle, list } = setup();
    const onChange = vi.fn();
    input.addEventListener('change', onChange);
    toggle.click();
    (list.querySelectorAll('[role="option"]')[2] as HTMLElement).click();
    expect(input.value).toBe('Gamma');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(list.hidden).toBe(true);
  });

  it('supports arrow keys, Enter to pick and Escape without bubbling to the dialog', () => {
    const { input, list } = setup();
    const onDocKey = vi.fn();
    document.addEventListener('keydown', onDocKey);
    key(input, 'ArrowDown');
    expect(list.hidden).toBe(false);
    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(`${list.id}-1`);
    const enter = key(input, 'Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(input.value).toBe('Beta');
    key(input, 'ArrowDown');
    const esc = key(input, 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(list.hidden).toBe(true);
    expect(onDocKey.mock.calls.some(([e]) => (e as KeyboardEvent).key === 'Escape')).toBe(false);
    document.removeEventListener('keydown', onDocKey);
  });

  it('Escape closes a list opened from the arrow even when focus is elsewhere (touch)', () => {
    const { toggle, list } = setup();
    const onDocKey = vi.fn();
    document.addEventListener('keydown', onDocKey);
    toggle.click();
    expect(list.hidden).toBe(false);
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    expect(list.hidden).toBe(true);
    expect(onDocKey).not.toHaveBeenCalled();
    // Once closed, Escape reaches the dialog again.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onDocKey).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', onDocKey);
  });

  it('a list left open in a removed dialog no longer swallows Escape', () => {
    const { toggle, list } = setup();
    toggle.click();
    expect(list.hidden).toBe(false);
    document.body.innerHTML = '';
    const onDocKey = vi.fn();
    document.addEventListener('keydown', onDocKey);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onDocKey).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', onDocKey);
  });

  it('a picked value counts as the user choice, so later fills keep it', () => {
    const { input, toggle, list } = setup();
    toggle.click();
    (list.querySelector('[role="option"]') as HTMLElement).click();
    fillLinkedField(input, 'Other');
    expect(input.value).toBe('Alpha');
  });
  it('fills linked fields only while the user has not typed into them', () => {
    document.body.innerHTML = `<div class="dialog-overlay"><input id="f"><input id="cur" value="EUR" data-autofill="1"><input id="country" value="Spain"></div>`;
    const input = document.getElementById('f') as HTMLInputElement;
    const cur = document.getElementById('cur') as HTMLInputElement;
    const country = document.getElementById('country') as HTMLInputElement;
    attachCombobox(input, [{ value: 'Broker', fills: { cur: 'USD', country: 'Germany' } }]);
    (input.closest('.combo')!.querySelector('.combo-toggle') as HTMLElement).click();
    (input.closest('.combo')!.querySelector('[role="option"]') as HTMLElement).click();
    expect(cur.value).toBe('USD');
    // A value the user already had is kept.
    expect(country.value).toBe('Spain');

    type(cur, 'GBP');
    fillLinkedField(cur, 'CHF');
    expect(cur.value).toBe('GBP');
  });

  it('setOptions updates the list (e.g. after values disappear)', () => {
    const { handle, toggle, shown } = setup();
    handle.setOptions(toComboOptions(['Alpha']));
    toggle.click();
    expect(shown()).toEqual(['Alpha']);
    handle.setOptions([]);
    expect(toggle.hidden).toBe(true);
  });

  describe('placement', () => {
    const rect = (top: number, height = 32, left = 20, width = 300) =>
      ({
        top,
        bottom: top + height,
        left,
        right: left + width,
        width,
        height,
        x: left,
        y: top,
      }) as DOMRect;

    function placed(fieldTop: number, contentHeight: number, viewport = 600) {
      vi.stubGlobal('innerHeight', viewport);
      const s = setup();
      Object.defineProperty(s.list, 'scrollHeight', { configurable: true, value: contentHeight });
      s.wrap.getBoundingClientRect = () => rect(fieldTop);
      s.list.getBoundingClientRect = () =>
        rect(parseFloat(s.list.style.top), 0, parseFloat(s.list.style.left));
      s.toggle.click();
      return s.list;
    }

    afterEach(() => vi.unstubAllGlobals());

    it('opens below as a fixed overlay sized to the space left in the viewport', () => {
      const list = placed(100, 1000);
      expect(list.classList.contains('combo-list-up')).toBe(false);
      expect(list.style.top).toBe('136px');
      expect(list.style.left).toBe('20px');
      expect(list.style.width).toBe('300px');
      expect(list.style.maxHeight).toBe('260px');
    });

    it('shrinks to the visible room so every option stays reachable by scrolling', () => {
      const list = placed(380, 1000);
      // Room below: 600 - (380 + 32) - 4 gap - 8 margin = 176px, enough to stay below.
      expect(list.classList.contains('combo-list-up')).toBe(false);
      expect(list.style.maxHeight).toBe('176px');
    });

    it('opens upwards near the bottom of the screen', () => {
      const list = placed(500, 1000);
      expect(list.classList.contains('combo-list-up')).toBe(true);
      expect(list.style.maxHeight).toBe('260px');
      expect(list.style.top).toBe(`${500 - 4 - 260}px`);
    });

    it('closes when the field scrolls out of its scrolling dialog body', () => {
      const list = placed(100, 100);
      const body = list.closest('.dialog-overlay') as HTMLElement;
      body.style.overflowY = 'auto';
      body.getBoundingClientRect = () => rect(200, 300);
      window.dispatchEvent(new Event('scroll'));
      expect(list.hidden).toBe(true);
    });
  });
});
