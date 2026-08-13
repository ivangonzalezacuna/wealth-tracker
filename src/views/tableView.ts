import type { ColumnDef } from './tableColumns';
import { getSortGetters } from './tableColumns';
import { renderTableHeader, renderTableRow } from './tableColumns';
import type { SortState } from './tableSort';
import { applySort, bindSortableHeader } from './tableSort';

export interface SortedPaginatedResult<T> {
  pageItems: T[];
  page: number;
  totalPages: number;
}

export function sortAndPaginate<T>(
  items: T[],
  columns: ColumnDef<T>[],
  sortState: SortState,
  page: number,
  pageSize: number,
  minTotalPages = 1,
): SortedPaginatedResult<T> {
  const sorted = applySort(items, sortState, getSortGetters(columns));
  const totalPages = Math.max(minTotalPages, Math.ceil(sorted.length / pageSize));
  const nextPage = Math.min(Math.max(page, 1), totalPages);
  const start = (nextPage - 1) * pageSize;
  return {
    pageItems: sorted.slice(start, start + pageSize),
    page: nextPage,
    totalPages,
  };
}

export function bindSortedTableHeader(
  headerEl: HTMLElement | null,
  sortState: SortState,
  onChange: (newState: SortState) => void,
): void {
  if (!headerEl) return;
  bindSortableHeader(headerEl, sortState, onChange);
}

export interface RenderTableSectionOptions<T> {
  container: HTMLElement | null;
  columns: ColumnDef<T>[];
  items: T[];
  sortState: SortState;
  page: number;
  pageSize: number;
  rowClassName: string;
  headerId: string;
  emptyHtml: string;
  headerAttrs?: string;
  footerHtml?: string;
}

export interface RenderTableSectionResult<T> extends SortedPaginatedResult<T> {
  hasItems: boolean;
}

export function renderTableSection<T>(
  opts: RenderTableSectionOptions<T>,
): RenderTableSectionResult<T> {
  const {
    container,
    columns,
    items,
    sortState,
    page,
    pageSize,
    rowClassName,
    headerId,
    emptyHtml,
    headerAttrs,
    footerHtml,
  } = opts;
  if (!container) {
    return { pageItems: [], page, totalPages: 1, hasItems: false };
  }
  if (!items.length) {
    container.innerHTML = emptyHtml;
    return { pageItems: [], page: 1, totalPages: 1, hasItems: false };
  }
  const result = sortAndPaginate(items, columns, sortState, page, pageSize);
  const rows = result.pageItems
    .map(
      (item) => `
    <div class="${rowClassName}" role="row">
      ${renderTableRow(columns, item)}
    </div>`,
    )
    .join('');
  container.innerHTML = `
    <div class="${rowClassName} th" role="row" id="${headerId}"${headerAttrs ? ` ${headerAttrs}` : ''}>${renderTableHeader(columns, sortState)}</div>
    ${rows}
    ${footerHtml || ''}`;
  return { ...result, hasItems: true };
}
