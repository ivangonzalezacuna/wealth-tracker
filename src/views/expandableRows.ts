export interface ToggleSingleDetailRowOptions<T> {
  container: HTMLElement;
  row: HTMLElement;
  item: T;
  detailSelector: string;
  createDetail: (row: HTMLElement, item: T) => HTMLElement;
  onExpandedChange?: (row: HTMLElement, expanded: boolean) => void;
}

export interface BindExpandableRowsOptions<T> {
  container: HTMLElement | null;
  rowSelector: string;
  detailSelector: string;
  getItem: (row: HTMLElement) => T | undefined;
  createDetail: (row: HTMLElement, item: T) => HTMLElement;
  ignoreClick?: (target: HTMLElement) => boolean;
  onExpandedChange?: (row: HTMLElement, expanded: boolean) => void;
}

export function toggleSingleDetailRow<T>(opts: ToggleSingleDetailRowOptions<T>): boolean {
  const { container, row, item, detailSelector, createDetail, onExpandedChange } = opts;
  const existing = container.querySelector(detailSelector) as HTMLElement | null;
  if (existing) {
    const prevRow = existing.previousElementSibling as HTMLElement | null;
    const wasSameRow = prevRow === row;
    prevRow?.setAttribute('aria-expanded', 'false');
    if (prevRow) onExpandedChange?.(prevRow, false);
    existing.remove();
    if (wasSameRow) return false;
  }

  const detail = createDetail(row, item);
  row.insertAdjacentElement('afterend', detail);
  row.setAttribute('aria-expanded', 'true');
  onExpandedChange?.(row, true);
  return true;
}

export function bindExpandableRows<T>(opts: BindExpandableRowsOptions<T>): void {
  const {
    container,
    rowSelector,
    detailSelector,
    getItem,
    createDetail,
    ignoreClick,
    onExpandedChange,
  } = opts;
  if (!container) return;
  const boundContainer = container as HTMLElement & { _rowDetail_bound?: boolean };
  if (!boundContainer._rowDetail_bound) {
    boundContainer._rowDetail_bound = true;
    boundContainer.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      if (ignoreClick?.(target)) return;
      const row = target.closest(rowSelector) as HTMLElement | null;
      if (!row) return;
      const item = getItem(row);
      if (!item) return;
      toggleSingleDetailRow({
        container,
        row,
        item,
        detailSelector,
        createDetail,
        onExpandedChange,
      });
    });
    boundContainer.addEventListener('keydown', (ev) => {
      const row = (ev.target as HTMLElement).closest(rowSelector) as HTMLElement | null;
      if (!row || (ev.key !== 'Enter' && ev.key !== ' ')) return;
      ev.preventDefault();
      row.click();
    });
  }
}

export interface RestoreExpandableRowsOptions<T> {
  container: HTMLElement | null;
  rowSelector: string;
  detailSelector: string;
  getItem: (row: HTMLElement) => T | undefined;
  createDetail: (row: HTMLElement, item: T) => HTMLElement;
  isExpanded: (row: HTMLElement) => boolean;
  onExpandedChange?: (row: HTMLElement, expanded: boolean) => void;
}

export function restoreExpandableRows<T>(opts: RestoreExpandableRowsOptions<T>): void {
  const {
    container,
    rowSelector,
    detailSelector,
    getItem,
    createDetail,
    isExpanded,
    onExpandedChange,
  } = opts;
  if (!container) return;
  container.querySelectorAll(rowSelector).forEach((rowEl) => {
    const row = rowEl as HTMLElement;
    if (!isExpanded(row)) return;
    const item = getItem(row);
    if (!item) return;
    toggleSingleDetailRow({
      container,
      row,
      item,
      detailSelector,
      createDetail,
      onExpandedChange,
    });
  });
}
