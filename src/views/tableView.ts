import type { ColumnDef } from './tableColumns';
import { getSortGetters } from './tableColumns';
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
