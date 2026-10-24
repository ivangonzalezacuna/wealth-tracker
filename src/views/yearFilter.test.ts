// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { populateYearFilterOptions } from './yearFilter';

describe('populateYearFilterOptions', () => {
  it('lists years newest first and keeps the current selection', () => {
    document.body.innerHTML =
      '<div class="filter-bar"><select id="y"><option value="2024">2024</option></select></div>';
    const select = document.getElementById('y') as HTMLSelectElement;
    select.value = '2024';
    populateYearFilterOptions('y', [{ date: '2024-03' }, { date: '2026-01' }, { date: '2025-07' }]);
    expect([...select.options].map((o) => o.value)).toEqual(['', '2026', '2025', '2024']);
    expect(select.value).toBe('2024');
    expect(select.hidden).toBe(false);
    expect(select.parentElement!.hidden).toBe(false);
  });

  it('hides a single-year filter and its otherwise empty bar', () => {
    document.body.innerHTML = '<div class="filter-bar"><select id="y"></select></div>';
    populateYearFilterOptions('y', [{ date: '2026-01' }, { date: '2026-02' }]);
    const select = document.getElementById('y') as HTMLSelectElement;
    expect(select.hidden).toBe(true);
    expect(select.parentElement!.hidden).toBe(true);
    populateYearFilterOptions('y', [{ date: '2025-12' }, { date: '2026-02' }]);
    expect(select.hidden).toBe(false);
    expect(select.parentElement!.hidden).toBe(false);
  });

  it('leaves a shared bar visible', () => {
    document.body.innerHTML =
      '<div class="filter-bar"><select id="y"></select><input id="s"></div>';
    populateYearFilterOptions('y', [{ date: '2026-01' }]);
    expect(document.getElementById('y')!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.filter-bar')!.hidden).toBe(false);
  });
});
