// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  bindChipGroup,
  bindFilterStatus,
  bindSearchClear,
  chipGroupHtml,
  renderFilterStatus,
  searchHtml,
  setChipValue,
} from './filterBar';

describe('filterBar', () => {
  it('renders chips with counts and pressed state', () => {
    document.body.innerHTML = chipGroupHtml({
      id: 'g',
      ariaLabel: 'Status',
      attr: 'filter',
      value: 'held',
      scroll: true,
      chips: [
        { value: 'held', label: 'Held', count: 3 },
        { value: 'all', label: 'All', count: 1200 },
      ],
    });
    const group = document.getElementById('g')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.classList.contains('filter-chips-scroll')).toBe(true);
    expect(group.textContent).toBe('Held 3All 1.200');
    const [held, all] = group.querySelectorAll('button');
    expect(held.getAttribute('aria-pressed')).toBe('true');
    expect(all.getAttribute('aria-pressed')).toBe('false');
    setChipValue(group, 'filter', 'all');
    expect(held.getAttribute('aria-pressed')).toBe('false');
    expect(all.classList.contains('active')).toBe(true);
  });

  it('binds chip clicks once and survives re-renders', () => {
    document.body.innerHTML = '<div id="g"></div>';
    const group = document.getElementById('g')!;
    const pick = vi.fn();
    bindChipGroup(group, 'tx-type', pick);
    bindChipGroup(group, 'tx-type', pick);
    group.innerHTML = '<button data-tx-type="BUY"><span>Buy</span></button>';
    group.querySelector('span')!.click();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick).toHaveBeenCalledWith('BUY');
  });

  it('clears the search input and fires input', () => {
    document.body.innerHTML = `<div id="bar">${searchHtml({ id: 's', value: 'abc', placeholder: 'Search', ariaLabel: 'Search' })}</div>`;
    const input = document.getElementById('s') as HTMLInputElement;
    const onInput = vi.fn();
    input.addEventListener('input', onInput);
    bindSearchClear(document.getElementById('bar'));
    (document.querySelector('[data-clear-search]') as HTMLButtonElement).click();
    expect(input.value).toBe('');
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
  });

  it('shows the status line only while filtering', () => {
    document.body.innerHTML = '<div id="st" hidden></div>';
    const el = document.getElementById('st')!;
    const clear = vi.fn();
    bindFilterStatus(el, clear);
    renderFilterStatus(el, { shown: 2, total: 9, noun: 'rows', active: true, note: 'From chart' });
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('From chart2 of 9 rowsClear filters');
    (el.querySelector('[data-clear-filters]') as HTMLButtonElement).click();
    expect(clear).toHaveBeenCalledTimes(1);
    renderFilterStatus(el, { shown: 9, total: 9, noun: 'rows', active: false });
    expect(el.hidden).toBe(true);
    expect(el.innerHTML).toBe('');
  });
});
