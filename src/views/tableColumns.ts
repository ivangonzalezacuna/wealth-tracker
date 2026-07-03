import { sortableHeader } from './tableSort';
import type { SortState } from './tableSort';

/**
 * Declarative column definition. Single source of truth for a table's
 * header, cell rendering, sort behavior, and mobile visibility.
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
  /** InfoTip text shown next to the header label. */
  tip?: string;
  /** Hidden below the 599px mobile breakpoint (rendered as data-mobile-hidden attr). */
  mobileHidden?: boolean;
  /** Marks column value for inclusion in the mobile tap-to-expand detail panel. */
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
  /** If true, cell() returns the full element markup (no outer role="cell" div wrapper). */
  raw?: boolean;
}

/** Count of visible columns at the given breakpoint (for verifying CSS grid-template-columns). */
export function visibleColumnCount<T>(columns: ColumnDef<T>[], mobile: boolean): number {
  return mobile ? columns.filter((c) => !c.mobileHidden).length : columns.length;
}

/** Render all columnheader cells for a table. Caller wraps in the .tbl-row.th container. */
export function renderTableHeader<T>(columns: ColumnDef<T>[], state: SortState): string {
  return columns
    .map((col) => {
      const mobileAttr = col.mobileHidden ? ' data-mobile-hidden="1"' : '';
      if (col.sortValue) {
        // sortableHeader() handles the tip parameter for InfoTip columns.
        const html = sortableHeader(col.label, col.key, state, col.align, col.tip);
        return mobileAttr ? html.replace('<div ', `<div${mobileAttr} `) : html;
      }
      const alignStyle = col.align === 'right' ? ' style="text-align:right"' : '';
      return `<div role="columnheader"${alignStyle}${mobileAttr}>${col.label}</div>`;
    })
    .join('');
}

/** Render all cell divs for one data row. Caller wraps in its .tbl-row container. */
export function renderTableRow<T>(columns: ColumnDef<T>[], row: T): string {
  return columns
    .map((col) => {
      if (col.raw) return col.cell ? col.cell(row) : '';
      // When cellAttrs is defined, it is responsible for including text-align
      // in the style attribute if needed (avoids duplicate style attrs).
      const alignStyle = col.align === 'right' && !col.cellAttrs ? ' style="text-align:right"' : '';
      const mobileAttr = col.mobileHidden ? ' data-mobile-hidden="1"' : '';
      const cls = col.cellClass ? ` class="${col.cellClass(row)}"` : '';
      const attrs = col.cellAttrs ? ` ${col.cellAttrs(row)}` : '';
      const content = col.cell ? col.cell(row) : '';
      return `<div role="cell"${cls}${alignStyle}${mobileAttr}${attrs}>${content}</div>`;
    })
    .join('');
}

/** Extract {key: getter} map from sortable columns for use with applySort(). */
export function getSortGetters<T>(
  columns: ColumnDef<T>[],
): Record<string, (row: T) => string | number> {
  const getters: Record<string, (row: T) => string | number> = {};
  for (const col of columns) {
    if (col.sortValue) getters[col.key] = col.sortValue;
  }
  return getters;
}
