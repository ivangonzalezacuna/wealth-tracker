import { infoTip } from '../ui/infoTip';

export type SortDir = 'asc' | 'desc' | null;

export interface SortState {
  key: string | null;
  dir: SortDir;
}

/** Advances a column's sort state on click: none → desc → asc → none.
 *  Clicking a different column than the one currently active always
 *  starts that new column at 'desc', regardless of the old column's state.
 *  This means numbers sort high→low first, text sorts A→Z first. */
export function advanceSort(current: SortState, clickedKey: string): SortState {
  if (current.key !== clickedKey) return { key: clickedKey, dir: 'desc' };
  if (current.dir === 'desc') return { key: clickedKey, dir: 'asc' };
  return { key: null, dir: null }; // asc -> back to default order
}

/** Sort items by state. Returns a copy; when state.key is null returns default order.
 *  Strings sort A-Z on first click (desc); numbers sort high-to-low. */
export function applySort<T>(
  items: T[],
  state: SortState,
  getters: Record<string, (item: T) => string | number>,
): T[] {
  if (!state.key || !state.dir || !getters[state.key]) return items.slice();
  const getter = getters[state.key];
  const numDir = state.dir === 'asc' ? 1 : -1;
  const strDir = -numDir; // strings: desc = A→Z, asc = Z→A
  return items.slice().sort((a, b) => {
    const av = getter(a);
    const bv = getter(b);
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * strDir;
    return ((av as number) - (bv as number)) * numDir;
  });
}

/** Returns a sortable columnheader cell. `key` must match a getter key
 *  passed to applySort for this table. `align` mirrors the existing
 *  `style="text-align:right"` convention used on numeric columns.
 *  For right-aligned columns the arrow appears before the label to avoid
 *  text jumping. Optional `tip` renders an InfoTip next to the label. */
export function sortableHeader(
  label: string,
  key: string,
  state: SortState,
  align: 'left' | 'right' = 'left',
  tip?: string,
): string {
  const active = state.key === key;
  const dirGlyph = active ? (state.dir === 'asc' ? '\u25b2' : '\u25bc') : '\u25bc';
  const ariaSort = active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const styleAttr = align === 'right' ? ' style="text-align:right"' : '';
  const arrowSpan = `<span class="sort-arrow"${active ? '' : ' style="visibility:hidden"'}>${dirGlyph}</span>`;
  const labelHtml = tip ? `<span class="th-label">${label}${infoTip(tip)}</span>` : label;
  const content = align === 'right' ? `${arrowSpan}${labelHtml}` : `${labelHtml}${arrowSpan}`;
  return `<div role="columnheader" class="sortable-th${active ? ' sort-active' : ''}" data-sort-key="${key}" aria-sort="${ariaSort}"${styleAttr}>${content}</div>`;
}

/** Bind click handlers to sortable header cells. Calls onSort(newState) on click.
 *  Safe to rebind on each render (fresh DOM nodes). */
export function bindSortableHeader(
  headerRowEl: HTMLElement,
  state: SortState,
  onSort: (newState: SortState) => void,
): void {
  headerRowEl.querySelectorAll('[data-sort-key]').forEach((cell) => {
    cell.addEventListener('click', () => {
      const key = (cell as HTMLElement).dataset.sortKey;
      if (!key) return;
      onSort(advanceSort(state, key));
    });
  });
}
