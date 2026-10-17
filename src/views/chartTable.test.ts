/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { writeChartTable } from './chartTable';

describe('writeChartTable', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="chart-table-wrap" hidden></div>';
  });

  it('keeps pagination inside the collapsible content and pages rows correctly', () => {
    const rows = Array.from({ length: 26 }, (_, index) => [`Row ${index + 1}`, index + 1]);

    writeChartTable('chart-table-wrap', 'Test chart data', ['Label', 'Value'], rows, [1]);

    const wrap = document.getElementById('chart-table-wrap') as HTMLDivElement;
    const toggle = wrap.querySelector('.chart-data-table-toggle') as HTMLButtonElement;
    const content = wrap.querySelector('.chart-data-table-content') as HTMLDivElement;
    const pagination = wrap.querySelector('.chart-data-table-pagination') as HTMLDivElement;
    const nextBtn = wrap.querySelector('.chart-data-table-next') as HTMLButtonElement;
    const prevBtn = wrap.querySelector('.chart-data-table-prev') as HTMLButtonElement;
    const pageInfo = wrap.querySelector('.chart-data-table-page-info') as HTMLSpanElement;
    const tbody = wrap.querySelector('.chart-data-table tbody') as HTMLTableSectionElement;

    expect(wrap.hasAttribute('hidden')).toBe(false);
    expect(content.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(pagination.parentElement).toBe(content);

    toggle.click();
    expect(content.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(pageInfo.textContent).toBe('1 / 2');
    expect(tbody.querySelectorAll('tr')).toHaveLength(25);
    expect(prevBtn.disabled).toBe(true);
    expect(nextBtn.disabled).toBe(false);

    nextBtn.click();
    expect(pageInfo.textContent).toBe('2 / 2');
    expect(tbody.querySelectorAll('tr')).toHaveLength(1);
    expect(tbody.querySelector('td')?.textContent).toBe('Row 26');
    expect(tbody.querySelector('td:nth-child(2)')?.className).toBe('chart-data-number');
    expect(prevBtn.disabled).toBe(false);
    expect(nextBtn.disabled).toBe(true);

    toggle.click();
    expect(content.hidden).toBe(true);
    expect(pagination.parentElement).toBe(content);
  });

  it('aligns only declared numeric columns, preserving dates and identifiers', () => {
    writeChartTable(
      'chart-table-wrap',
      'Mixed data',
      ['Month', 'Amount', 'Share', 'ISIN'],
      [
        ['Jan 2026', '-€1,234.56', '12.5%', 'IE00B4L5Y983'],
        ['Feb 2026', '—', '0%', 'IE00BK5BQT80'],
      ],
      [1, 2],
    );
    const table = document.querySelector('.chart-data-table')!;
    expect([...table.querySelectorAll('th')].map((cell) => cell.className)).toEqual([
      '',
      'chart-data-number',
      'chart-data-number',
      '',
    ]);
    for (const row of table.querySelectorAll('tbody tr')) {
      expect([...row.children].map((cell) => cell.className)).toEqual([
        '',
        'chart-data-number',
        'chart-data-number',
        '',
      ]);
    }
    expect(table.textContent).toContain('-€1,234.56');
    expect(table.textContent).toContain('IE00B4L5Y983');
  });

  it('preserves expanded state when re-rendered', () => {
    writeChartTable('chart-table-wrap', 'Test chart data', ['Label'], [['Row 1']]);

    const wrap = document.getElementById('chart-table-wrap') as HTMLDivElement;
    const toggle = wrap.querySelector('.chart-data-table-toggle') as HTMLButtonElement;
    toggle.click();

    writeChartTable('chart-table-wrap', 'Test chart data', ['Label'], [['Row 1'], ['Row 2']]);

    const content = wrap.querySelector('.chart-data-table-content') as HTMLDivElement;
    const rerenderedToggle = wrap.querySelector('.chart-data-table-toggle') as HTMLButtonElement;

    expect(content.hidden).toBe(false);
    expect(rerenderedToggle.getAttribute('aria-expanded')).toBe('true');
    expect(rerenderedToggle.textContent).toBe('Hide data table');
  });
});
