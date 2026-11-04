// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { attachScrollHint } from './scrollHint';

describe('attachScrollHint', () => {
  it('updates directional fades at each scroll position and removes them without overflow', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(el, 'scrollWidth', { value: 600, configurable: true });
    const update = attachScrollHint(el);
    expect(el.classList.contains('can-scroll-left')).toBe(false);
    expect(el.classList.contains('can-scroll-right')).toBe(true);
    el.scrollLeft = 150;
    el.dispatchEvent(new Event('scroll'));
    expect(el.classList.contains('can-scroll-left')).toBe(true);
    expect(el.classList.contains('can-scroll-right')).toBe(true);
    el.scrollLeft = 400;
    update();
    expect(el.classList.contains('can-scroll-left')).toBe(true);
    expect(el.classList.contains('can-scroll-right')).toBe(false);
    Object.defineProperty(el, 'scrollWidth', { value: 200 });
    update();
    expect(el.classList.contains('can-scroll-left')).toBe(false);
    expect(el.classList.contains('can-scroll-right')).toBe(false);
    expect(attachScrollHint(el)).toBe(update);
  });

  it('refreshes hints when strip content changes', async () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 200 });
    Object.defineProperty(el, 'scrollWidth', { value: 200, configurable: true });
    attachScrollHint(el);
    Object.defineProperty(el, 'scrollWidth', { value: 400 });
    el.append(document.createElement('button'));
    await Promise.resolve();
    expect(el.classList.contains('can-scroll-right')).toBe(true);
  });
});
