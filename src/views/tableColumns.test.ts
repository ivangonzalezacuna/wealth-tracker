/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import {
  visibleColumnCount,
  renderTableHeader,
  renderTableRow,
  getSortGetters,
} from './tableColumns';
import type { ColumnDef } from './tableColumns';
import type { SortState } from './tableSort';

describe('visibleColumnCount', () => {
  const columns: ColumnDef<unknown>[] = [
    { key: 'a', label: 'A' },
    { key: 'b', label: 'B', mobileHidden: true },
    { key: 'c', label: 'C' },
    { key: 'd', label: 'D', mobileHidden: true },
  ];

  it('returns full length when mobile is false', () => {
    expect(visibleColumnCount(columns, false)).toBe(4);
  });

  it('returns count excluding mobileHidden columns when mobile is true', () => {
    expect(visibleColumnCount(columns, true)).toBe(2);
  });

  it('returns full length when no columns are mobileHidden', () => {
    const cols: ColumnDef<unknown>[] = [
      { key: 'x', label: 'X' },
      { key: 'y', label: 'Y' },
    ];
    expect(visibleColumnCount(cols, true)).toBe(2);
  });
});

describe('renderTableHeader', () => {
  const state: SortState = { key: null, dir: null };

  it('a column with no sortValue renders a plain columnheader', () => {
    const columns: ColumnDef<unknown>[] = [{ key: 'name', label: 'Name' }];
    const html = renderTableHeader(columns, state);
    expect(html).toContain('role="columnheader"');
    expect(html).toContain('Name');
    expect(html).not.toContain('data-sort-key');
  });

  it('a column with sortValue renders via sortableHeader with data-sort-key', () => {
    const columns: ColumnDef<{ name: string }>[] = [
      { key: 'name', label: 'Name', sortValue: (r) => r.name },
    ];
    const html = renderTableHeader(columns, state);
    expect(html).toContain('data-sort-key="name"');
    expect(html).toContain('sortable-th');
  });

  it('a sortable column with active sort shows the arrow', () => {
    const columns: ColumnDef<{ cost: number }>[] = [
      { key: 'cost', label: 'Cost', sortValue: (r) => r.cost, align: 'right' },
    ];
    const activeState: SortState = { key: 'cost', dir: 'desc' };
    const html = renderTableHeader(columns, activeState);
    expect(html).toContain('data-sort-key="cost"');
    expect(html).toContain('\u25bc'); // down arrow
  });

  it('a column with mobileHidden renders data-mobile-hidden regardless of sortable', () => {
    const sortable: ColumnDef<{ v: number }>[] = [
      { key: 'v', label: 'Value', sortValue: (r) => r.v, mobileHidden: true },
    ];
    const plain: ColumnDef<unknown>[] = [{ key: 'p', label: 'Plain', mobileHidden: true }];

    const htmlSortable = renderTableHeader(sortable, state);
    expect(htmlSortable).toContain('data-mobile-hidden="1"');
    expect(htmlSortable).toContain('data-sort-key="v"');

    const htmlPlain = renderTableHeader(plain, state);
    expect(htmlPlain).toContain('data-mobile-hidden="1"');
    expect(htmlPlain).toContain('role="columnheader"');
  });

  it('a column with label "" and no sortValue renders an empty-content columnheader', () => {
    const columns: ColumnDef<unknown>[] = [{ key: 'swatch', label: '' }];
    const html = renderTableHeader(columns, state);
    expect(html).toBe('<div role="columnheader"></div>');
  });

  it('right-aligned non-sortable column renders text-align style', () => {
    const columns: ColumnDef<unknown>[] = [{ key: 'amt', label: 'Amount', align: 'right' }];
    const html = renderTableHeader(columns, state);
    expect(html).toContain('style="text-align:right"');
  });
});

describe('renderTableRow', () => {
  it('align "right" produces style on cell div; left/omitted produces no style', () => {
    type R = { a: number; b: number };
    const columns: ColumnDef<R>[] = [
      { key: 'a', label: 'A', align: 'right', cell: (r) => String(r.a) },
      { key: 'b', label: 'B', cell: (r) => String(r.b) },
    ];
    const html = renderTableRow(columns, { a: 1, b: 2 });
    const cells = html.split('</div>').filter((s) => s.includes('role="cell"'));
    expect(cells[0]).toContain('style="text-align:right"');
    expect(cells[1]).not.toContain('style=');
  });

  it('mobileHidden produces data-mobile-hidden on the cell div', () => {
    const columns: ColumnDef<{ x: number }>[] = [
      { key: 'x', label: 'X', mobileHidden: true, cell: (r) => String(r.x) },
    ];
    const html = renderTableRow(columns, { x: 42 });
    expect(html).toContain('data-mobile-hidden="1"');
  });

  it('cellClass and cellAttrs appear on cell div when provided', () => {
    type R = { id: number };
    const columns: ColumnDef<R>[] = [
      {
        key: 'id',
        label: 'ID',
        cellClass: (r) => `item-${r.id}`,
        cellAttrs: (r) => `data-id="${r.id}"`,
        cell: (r) => String(r.id),
      },
    ];
    const html = renderTableRow(columns, { id: 7 });
    expect(html).toContain('class="item-7"');
    expect(html).toContain('data-id="7"');
  });

  it('omitted cellClass and cellAttrs produce no class or extra attrs', () => {
    const columns: ColumnDef<{ v: number }>[] = [
      { key: 'v', label: 'V', cell: (r) => String(r.v) },
    ];
    const html = renderTableRow(columns, { v: 5 });
    expect(html).not.toContain('class=');
    expect(html).toContain('role="cell"');
    expect(html).toContain('>5</div>');
  });

  it('raw: true returns cell output completely unwrapped', () => {
    const columns: ColumnDef<{ color: string }>[] = [
      {
        key: 'swatch',
        label: '',
        raw: true,
        cell: (r) => `<span class="leg-sq" style="background:${r.color}"></span>`,
      },
    ];
    const html = renderTableRow(columns, { color: 'red' });
    expect(html).not.toContain('role="cell"');
    expect(html).toBe('<span class="leg-sq" style="background:red"></span>');
  });

  it('no cell function and raw false renders empty valid div', () => {
    const columns: ColumnDef<unknown>[] = [{ key: 'empty', label: 'E' }];
    const html = renderTableRow(columns, {});
    expect(html).toBe('<div role="cell"></div>');
  });
});

describe('getSortGetters', () => {
  type Item = { name: string; cost: number; id: number };
  const columns: ColumnDef<Item>[] = [
    { key: 'name', label: 'Name', sortValue: (r) => r.name },
    { key: 'icon', label: '' /* no sortValue */ },
    { key: 'cost', label: 'Cost', sortValue: (r) => r.cost },
  ];

  it('returns only columns with sortValue', () => {
    const getters = getSortGetters(columns);
    expect(Object.keys(getters)).toEqual(['name', 'cost']);
    expect(Object.keys(getters)).not.toContain('icon');
  });

  it('returned getters produce same value as calling sortValue directly', () => {
    const getters = getSortGetters(columns);
    const row: Item = { name: 'ETF', cost: 100, id: 1 };
    expect(getters['name'](row)).toBe(columns[0].sortValue!(row));
    expect(getters['cost'](row)).toBe(columns[2].sortValue!(row));
  });

  it('returned getters are references to original functions, not wrappers', () => {
    const getters = getSortGetters(columns);
    expect(getters['name']).toBe(columns[0].sortValue);
    expect(getters['cost']).toBe(columns[2].sortValue);
  });
});

describe('round-trip proof', () => {
  type Row = { id: number; name: string; amount: number };
  const columns: ColumnDef<Row>[] = [
    { key: 'name', label: 'Name', cell: (r) => r.name },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      sortValue: (r) => r.amount,
      cell: (r) => `€${r.amount}`,
    },
    {
      key: 'pct',
      label: '% Share',
      align: 'right',
      sortValue: (r) => r.amount,
      mobileHidden: true,
      cell: (r) => `${((r.amount / 300) * 100).toFixed(1)}%`,
    },
  ];

  const state: SortState = { key: 'amount', dir: 'desc' };
  const row: Row = { id: 1, name: 'Test Fund', amount: 150 };

  it('header produces expected number of columnheader elements with correct attributes', () => {
    const headerHtml = renderTableHeader(columns, state);
    const container = document.createElement('div');
    container.innerHTML = headerHtml;

    const headers = container.querySelectorAll('[role="columnheader"]');
    expect(headers.length).toBe(3);

    // First column: plain non-sortable
    expect(headers[0].getAttribute('data-sort-key')).toBeNull();
    expect(headers[0].textContent).toContain('Name');

    // Second column: sortable, active, right-aligned
    expect(headers[1].getAttribute('data-sort-key')).toBe('amount');
    expect(headers[1].getAttribute('style')).toContain('text-align:right');

    // Third column: sortable, mobileHidden
    expect(headers[2].getAttribute('data-sort-key')).toBe('pct');
    expect(headers[2].getAttribute('data-mobile-hidden')).toBe('1');
  });

  it('row produces expected number of cell elements with correct content', () => {
    const rowHtml = renderTableRow(columns, row);
    const container = document.createElement('div');
    container.innerHTML = rowHtml;

    const cells = container.querySelectorAll('[role="cell"]');
    expect(cells.length).toBe(3);

    // First cell: left-aligned text
    expect(cells[0].textContent).toBe('Test Fund');
    expect(cells[0].getAttribute('style')).toBeNull();

    // Second cell: right-aligned amount
    expect(cells[1].textContent).toBe('€150');
    expect(cells[1].getAttribute('style')).toContain('text-align:right');

    // Third cell: right-aligned, mobile-hidden
    expect(cells[2].textContent).toBe('50.0%');
    expect(cells[2].getAttribute('data-mobile-hidden')).toBe('1');
  });
});
