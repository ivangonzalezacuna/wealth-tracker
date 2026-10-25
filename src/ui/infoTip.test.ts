/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { attachInfoTips, infoTip } from './infoTip';

function mount(): HTMLElement {
  document.body.innerHTML = `<div id="root">${infoTip('Some help', 'warn')}</div>`;
  const root = document.getElementById('root')!;
  attachInfoTips(root);
  return root.querySelector<HTMLElement>('.info-tip')!;
}

const popCount = () => document.querySelectorAll('.info-tip-pop').length;

describe('infoTip', () => {
  afterEach(() => {
    document.querySelectorAll('.info-tip-pop').forEach((p) => p.remove());
    document.body.innerHTML = '';
  });

  it('opens on click and closes on a second click', () => {
    const tip = mount();
    tip.click();
    expect(popCount()).toBe(1);
    tip.click();
    expect(popCount()).toBe(0);
  });

  it('stays open when a tap focuses the tip before the click', () => {
    const tip = mount();
    tip.dispatchEvent(new Event('focus'));
    tip.click();
    expect(popCount()).toBe(1);
  });

  it('does not stack listeners when the bound flag is cleared and re-attached', () => {
    const tip = mount();
    delete tip.dataset.tipBound;
    attachInfoTips(document.getElementById('root')!);
    expect(tip.dataset.tipBound).toBe('1');
    tip.click();
    expect(popCount()).toBe(1);
  });
});
