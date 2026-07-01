import { sortableHeader } from './tableSort';
import type { SortState } from './tableSort';

/**
 * Declarative definition of one table column. An array of these is the
 * single source of truth for a table's header, cell rendering, sort
 * behavior, and mobile visibility -- replacing the previous pattern of
 * independently hand-written header strings, row strings, CSS nth-child
 * selectors, and applySort getter objects per table.
 */
export interface ColumnDef<T> {
  /** Must match the key used in this table's SortState and applySort getters. */
  key: string;
  /** Header label. Empty string renders an unlabeled header cell (e.g. a
   *  decorative leading swatch column that carries no text). */
  label: string;
  /** Default 'left'. */
  align?: 'left' | 'right';
  /** If provided, the column is sortable and this extracts the comparable
   *  value from a row. Omit for non-sortable columns (e.g. decorative or
   *  purely visual columns). */
  sortValue?: (row: T) => string | number;
  /** InfoTip text. Composed into the header via sortableHeader's own `tip`
   *  parameter (Phase 44) -- do not hand-compose th-label/infoTip markup
   *  at a ColumnDef call site; that duplication is exactly what this
   *  phase exists to remove. */
  tip?: string;
  /** Hidden below the 599px breakpoint. Rendered as a `data-mobile-hidden`
   *  attribute (Commit 4) rather than positional CSS -- see Known gotchas
   *  for why grid-template-columns itself is not auto-generated from this
   *  flag. */
  mobileHidden?: boolean;
  /** Marks this column's value as eligible for inclusion in a tap-to-expand
   *  detail panel (consumed by a table's own detail-panel builder in a
   *  later migration phase, e.g. Holdings in Phase 45b). Purely a hint;
   *  this module does not itself render any detail panel. */
  detail?: boolean;
  /** Extra class(es) on the rendered cell div, e.g. 'hold-etf-cell'. */
  cellClass?: (row: T) => string;
  /** Extra raw HTML attributes on the rendered cell div, e.g. data-isin="...".
   *  Caller is responsible for escaping any user-controlled values passed
   *  through here (matching the existing esc() convention used throughout
   *  the codebase's row templates today). */
  cellAttrs?: (row: T) => string;
  /** Inner HTML of the cell. Ignored if `raw` is true. */
  cell?: (row: T) => string;
  /** If true, `cell(row)` returns the *entire* cell element (its own
   *  wrapping tag included, e.g. a bare `<span class="leg-sq">`) and the
   *  renderer does not wrap it in a `role="cell"` div at all. Needed for
   *  the one existing case (Dividends' leading color-swatch column) that
   *  is not a `role="cell"` div in the shipped markup today -- see
   *  Phase 45c. Default false. */
  raw?: boolean;
}

/** Returns the number of columns visible at the given breakpoint. Used
 *  only as a verification aid (Commit 6, and by every migration phase's
 *  manual checklist) to confirm a table's hand-maintained CSS
 *  grid-template-columns track count matches its ColumnDef array --
 *  this function does not itself generate CSS. See Known gotchas for why
 *  grid-template-columns stays hand-maintained in styles.css. */
export function visibleColumnCount<T>(columns: ColumnDef<T>[], mobile: boolean): number {
  return mobile ? columns.filter((c) => !c.mobileHidden).length : columns.length;
}

/** Renders a full header row's inner content (the `<div role="columnheader">`
 *  cells only -- the caller wraps these in whatever `.tbl-row.th` container
 *  markup and id that table already uses, unchanged, so the sort-binding
 *  call site in each migration phase requires no structural change beyond
 *  swapping its header-cell-generation code for this call). */
export function renderTableHeader<T>(columns: ColumnDef<T>[], state: SortState): string {
  return columns
    .map((col) => {
      const mobileAttr = col.mobileHidden ? ' data-mobile-hidden="1"' : '';
      if (col.sortValue) {
        // sortableHeader() does not currently accept an extra-attributes
        // parameter; inject data-mobile-hidden by post-processing the
        // single root element it returns (it always returns exactly one
        // `<div ...>...</div>`, confirmed by its own implementation).
        const html = sortableHeader(col.label, col.key, state, col.align);
        return mobileAttr ? html.replace('<div ', `<div${mobileAttr} `) : html;
      }
      const alignStyle = col.align === 'right' ? ' style="text-align:right"' : '';
      return `<div role="columnheader"${alignStyle}${mobileAttr}>${col.label}</div>`;
    })
    .join('');
}

/** Renders one data row's inner content (the per-column `role="cell"` divs
 *  only -- the caller wraps these in whatever `.tbl-row` container markup,
 *  data-date/data-isin row-level attributes, and click-delegate class names
 *  that table already uses, unchanged). */
export function renderTableRow<T>(columns: ColumnDef<T>[], row: T): string {
  return columns
    .map((col) => {
      if (col.raw) return col.cell ? col.cell(row) : '';
      const alignStyle = col.align === 'right' ? ' style="text-align:right"' : '';
      const mobileAttr = col.mobileHidden ? ' data-mobile-hidden="1"' : '';
      const cls = col.cellClass ? ` class="${col.cellClass(row)}"` : '';
      const attrs = col.cellAttrs ? ` ${col.cellAttrs(row)}` : '';
      const content = col.cell ? col.cell(row) : '';
      return `<div role="cell"${cls}${alignStyle}${mobileAttr}${attrs}>${content}</div>`;
    })
    .join('');
}

/** Extracts the {key: getter} map that applySort() expects, from whichever
 *  columns declare a sortValue. Columns without one are simply absent from
 *  the returned map (matching applySort's existing behavior of falling
 *  back to unsorted when a key has no matching getter). */
export function getSortGetters<T>(
  columns: ColumnDef<T>[],
): Record<string, (row: T) => string | number> {
  const getters: Record<string, (row: T) => string | number> = {};
  for (const col of columns) {
    if (col.sortValue) getters[col.key] = col.sortValue;
  }
  return getters;
}
