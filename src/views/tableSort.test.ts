import { describe, it, expect } from 'vitest';
import { advanceSort, applySort, sortableHeader } from './tableSort';
import type { SortState } from './tableSort';

describe('advanceSort', () => {
  it('clicking a fresh key returns {key, dir:"desc"}', () => {
    const state: SortState = { key: null, dir: null };
    expect(advanceSort(state, 'name')).toEqual({ key: 'name', dir: 'desc' });
  });

  it('clicking the same key from desc returns {key, dir:"asc"}', () => {
    const state: SortState = { key: 'name', dir: 'desc' };
    expect(advanceSort(state, 'name')).toEqual({ key: 'name', dir: 'asc' });
  });

  it('clicking the same key from asc returns {key:null, dir:null}', () => {
    const state: SortState = { key: 'name', dir: 'asc' };
    expect(advanceSort(state, 'name')).toEqual({ key: null, dir: null });
  });

  it('clicking a different key while another is active resets to desc', () => {
    const state: SortState = { key: 'name', dir: 'asc' };
    expect(advanceSort(state, 'cost')).toEqual({ key: 'cost', dir: 'desc' });
  });
});

describe('applySort', () => {
  const items = [
    { name: 'Charlie', cost: 30 },
    { name: 'Alice', cost: 10 },
    { name: 'Bob', cost: 20 },
  ];

  const getters = {
    name: (i: (typeof items)[0]) => i.name,
    cost: (i: (typeof items)[0]) => i.cost,
  };

  it('with state.key === null, returns a new array with same order', () => {
    const state: SortState = { key: null, dir: null };
    const result = applySort(items, state, getters);
    expect(result).toEqual(items);
    expect(result).not.toBe(items); // new array reference
  });

  it('does not mutate the original array', () => {
    const original = [...items];
    const state: SortState = { key: 'cost', dir: 'asc' };
    applySort(items, state, getters);
    expect(items).toEqual(original);
  });

  it('sorts strings A→Z on first click (desc)', () => {
    const state: SortState = { key: 'name', dir: 'desc' };
    const result = applySort(items, state, getters);
    expect(result.map((i) => i.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('sorts strings Z→A on second click (asc)', () => {
    const state: SortState = { key: 'name', dir: 'asc' };
    const result = applySort(items, state, getters);
    expect(result.map((i) => i.name)).toEqual(['Charlie', 'Bob', 'Alice']);
  });

  it('sorts numbers high→low on first click (desc)', () => {
    const state: SortState = { key: 'cost', dir: 'desc' };
    const result = applySort(items, state, getters);
    expect(result.map((i) => i.cost)).toEqual([30, 20, 10]);
  });

  it('sorts numbers low→high on second click (asc)', () => {
    const state: SortState = { key: 'cost', dir: 'asc' };
    const result = applySort(items, state, getters);
    expect(result.map((i) => i.cost)).toEqual([10, 20, 30]);
  });
});

describe('sortableHeader', () => {
  it('renders visible arrow when state.key matches the cell key', () => {
    const active: SortState = { key: 'name', dir: 'asc' };
    const html = sortableHeader('Name', 'name', active);
    expect(html).toContain('\u25b2'); // up arrow
    expect(html).not.toContain('visibility:hidden');

    const inactive: SortState = { key: 'cost', dir: 'asc' };
    const html2 = sortableHeader('Name', 'name', inactive);
    expect(html2).toMatch(
      /<span class="sort-arrow" style="visibility:hidden">[\u25b2\u25bc]<\/span>/,
    );
  });

  it('aria-sort is "none" when inactive', () => {
    const state: SortState = { key: 'cost', dir: 'asc' };
    const html = sortableHeader('Name', 'name', state);
    expect(html).toContain('aria-sort="none"');
  });

  it('aria-sort is "ascending" when active asc', () => {
    const state: SortState = { key: 'name', dir: 'asc' };
    const html = sortableHeader('Name', 'name', state);
    expect(html).toContain('aria-sort="ascending"');
  });

  it('aria-sort is "descending" when active desc', () => {
    const state: SortState = { key: 'name', dir: 'desc' };
    const html = sortableHeader('Name', 'name', state);
    expect(html).toContain('aria-sort="descending"');
  });

  it('includes sort-active class only when active', () => {
    const active: SortState = { key: 'name', dir: 'asc' };
    expect(sortableHeader('Name', 'name', active)).toContain('sort-active');

    const inactive: SortState = { key: null, dir: null };
    expect(sortableHeader('Name', 'name', inactive)).not.toContain('sort-active');
  });

  it('applies text-align:right for right-aligned columns', () => {
    const state: SortState = { key: null, dir: null };
    const html = sortableHeader('Cost', 'cost', state, 'right');
    expect(html).toContain('text-align:right');
  });

  it('places arrow before label for right-aligned columns', () => {
    const state: SortState = { key: 'cost', dir: 'desc' };
    const html = sortableHeader('Cost', 'cost', state, 'right');
    const arrowIdx = html.indexOf('\u25bc');
    const labelIdx = html.indexOf('Cost');
    expect(arrowIdx).toBeLessThan(labelIdx);
  });

  it('places arrow after label for left-aligned columns', () => {
    const state: SortState = { key: 'name', dir: 'desc' };
    const html = sortableHeader('Name', 'name', state);
    const arrowIdx = html.indexOf('\u25bc');
    const labelIdx = html.indexOf('Name');
    expect(arrowIdx).toBeGreaterThan(labelIdx);
  });
});
