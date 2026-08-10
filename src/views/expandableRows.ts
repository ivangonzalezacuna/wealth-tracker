export interface ToggleSingleDetailRowOptions<T> {
  container: HTMLElement;
  row: HTMLElement;
  item: T;
  detailSelector: string;
  createDetail: (row: HTMLElement, item: T) => HTMLElement;
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
