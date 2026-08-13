import type { SortState } from './tableSort';
import { bindYearFilter } from './yearFilter';

export interface TableState {
  page: number;
  sort: SortState;
  filters: Record<string, string>;
}

export interface CreateTableStateOptions {
  page?: number;
  sort?: SortState;
  filters?: Record<string, string>;
}

export interface SetTableFilterOptions {
  resetSort?: boolean;
  rerender?: () => void;
}

export interface BindTableYearFilterOptions {
  elementId: string;
  state: TableState;
  filterKey?: string;
  resetSort?: boolean;
  rerender: () => void;
}

export interface BindTableSearchFilterOptions {
  elementId: string;
  state: TableState;
  filterKey?: string;
  resetSort?: boolean;
  normalize?: (value: string) => string;
  rerender: () => void;
}

export function createTableState(options: CreateTableStateOptions = {}): TableState {
  return {
    page: Math.max(1, options.page ?? 1),
    sort: options.sort ?? { key: null, dir: null },
    filters: { ...(options.filters || {}) },
  };
}

export function setTablePage(state: TableState, page: number): void {
  state.page = Math.max(1, page);
}

export function setTableSort(state: TableState, sort: SortState): void {
  state.sort = sort;
  state.page = 1;
}

export function resetTableSort(state: TableState): void {
  state.sort = { key: null, dir: null };
}

export function getTableFilter(state: TableState, key: string): string {
  return state.filters[key] || '';
}

export function setTableFilter(
  state: TableState,
  key: string,
  value: string,
  options: SetTableFilterOptions = {},
): void {
  state.filters[key] = value;
  state.page = 1;
  if (options.resetSort) resetTableSort(state);
  options.rerender?.();
}

export function bindTableYearFilter(opts: BindTableYearFilterOptions): void {
  const { elementId, state, filterKey = 'year', resetSort = false, rerender } = opts;
  bindYearFilter(elementId, (year) => {
    setTableFilter(state, filterKey, year, { resetSort, rerender });
  });
}

export function bindTableSearchFilter(opts: BindTableSearchFilterOptions): void {
  const {
    elementId,
    state,
    filterKey = 'search',
    resetSort = false,
    normalize = (value) => value.toLowerCase(),
    rerender,
  } = opts;
  const input = document.getElementById(elementId) as
    (HTMLInputElement & { _bound?: boolean }) | null;
  if (!input || input._bound) return;
  input._bound = true;
  input.addEventListener('input', () => {
    setTableFilter(state, filterKey, normalize(input.value), { resetSort, rerender });
  });
}
