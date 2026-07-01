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

/** Sorts a copy of `items` by `state`, using `getters[state.key]` to extract
 *  a comparable value per item. Returns `items` unchanged (same reference's
 *  contents, new array) when state.key is null — this is what makes "click a
 *  third time" restore the table's original default order: the caller must
 *  always pass the same pre-sort default-ordered array in, every render. */
export function applySort<T>(
  items: T[],
  state: SortState,
  getters: Record<string, (item: T) => string | number>,
): T[] {
  if (!state.key || !state.dir || !getters[state.key]) return items.slice();
  const getter = getters[state.key];
  const dir = state.dir === 'asc' ? 1 : -1;
  return items.slice().sort((a, b) => {
    const av = getter(a);
    const bv = getter(b);
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
    return ((av as number) - (bv as number)) * dir;
  });
}

/** Returns a sortable columnheader cell. `key` must match a getter key
 *  passed to applySort for this table. `align` mirrors the existing
 *  `style="text-align:right"` convention used on numeric columns.
 *  For right-aligned columns the arrow appears before the label to avoid
 *  text jumping. */
export function sortableHeader(
  label: string,
  key: string,
  state: SortState,
  align: 'left' | 'right' = 'left',
): string {
  const active = state.key === key;
  const arrow = active ? (state.dir === 'asc' ? '\u25b2' : '\u25bc') : '';
  const ariaSort = active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const styleAttr = align === 'right' ? ' style="text-align:right"' : '';
  const arrowSpan = `<span class="sort-arrow">${arrow}</span>`;
  const content = align === 'right' ? `${arrowSpan}${label}` : `${label}${arrowSpan}`;
  return `<div role="columnheader" class="sortable-th${active ? ' sort-active' : ''}" data-sort-key="${key}" aria-sort="${ariaSort}"${styleAttr}>${content}</div>`;
}

/** Binds delegated click handling to a header row's sortable cells.
 *  `onSort(newState)` is called with the freshly-advanced state; the
 *  caller is responsible for storing it in its own module state and
 *  triggering a re-render. Safe to call on every render — this binds to
 *  the header row element itself, which is always a fresh DOM node when
 *  the caller rebuilds `innerHTML` on each render (matching every other
 *  event-delegation pattern already used in this codebase, e.g.
 *  `_bindLegendToggle`), so no `_bound` guard is needed here. */
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
