export interface PaginationExtras {
  /** Total number of items across all pages (enables the "x–y of n" range). */
  totalItems: number;
  /** Current page size. */
  pageSize: number;
  /** Selectable page sizes; renders a "Rows" selector when provided. */
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (size: number) => void;
  /** Accessible noun for the page-size selector, e.g. "transactions". */
  itemLabel?: string;
}

/** Page sizes for month-based tables (one, two or four years of rows). */
export const MONTH_PAGE_SIZES = [12, 24, 48] as const;
/** Page sizes for general tables. */
export const DEFAULT_PAGE_SIZES = [10, 25, 50] as const;

export function loadPageSize(key: string, allowed: readonly number[], fallback: number): number {
  try {
    const stored = Number(globalThis.localStorage?.getItem(key));
    return allowed.includes(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function savePageSize(key: string, size: number): void {
  try {
    globalThis.localStorage?.setItem(key, String(size));
  } catch {
    // Storage may be unavailable (private mode); the size still applies for this session.
  }
}

/** A remembered rows-per-page choice for one table. */
export interface PageSizePref {
  readonly options: readonly number[];
  size: number;
  /** Store a new size (persisted in localStorage). */
  set(size: number): void;
}

export function createPageSizePref(key: string, options: readonly number[]): PageSizePref {
  const pref: PageSizePref = {
    options,
    size: loadPageSize(key, options, options[0]),
    set(size: number) {
      pref.size = size;
      savePageSize(key, size);
    },
  };
  return pref;
}

/** "Show more" growth per list, dropped once its item count changes. */
const shownMore = new Map<string, { size: number; total: number }>();

/** Rows to render for a list: its page size, or the larger size reached through "Show more". */
export function rowsFor(containerId: string, pageSize: number, totalItems: number): number {
  const more = shownMore.get(containerId);
  if (more?.total === totalItems) return Math.max(pageSize, more.size);
  shownMore.delete(containerId);
  return pageSize;
}

/** Collapse every "Show more" list back to its page size; true when any list was grown. */
export function resetShowMore(): boolean {
  const had = shownMore.size > 0;
  shownMore.clear();
  return had;
}

/** Phone footer: "Show N more" grows the list in place instead of paging. */
function moreHtml(page: number, extras: PaginationExtras, enabled: boolean): string {
  if (!enabled) return '';
  const shown = Math.min(page * extras.pageSize, extras.totalItems);
  const next = Math.min(
    Math.min(...(extras.pageSizeOptions ?? [extras.pageSize])),
    extras.totalItems - shown,
  );
  return `<span class="page-more">${
    next > 0
      ? `<button type="button" class="btn btn-sm btn-outline js-page-more">Show ${next} more</button>`
      : ''
  }<span>Showing ${shown} of ${extras.totalItems}</span></span>`;
}

/**
 * Render prev/next pagination controls. Hidden when totalPages <= 1, unless
 * a page-size selector is requested and there are more items than the
 * smallest page size (so users can always switch back to a smaller size).
 */
export function renderPagination(
  containerId: string,
  page: number,
  totalPages: number,
  onPageChange: (page: number) => void,
  extras?: PaginationExtras,
): void {
  const el = document.getElementById(containerId);
  if (!el) return;
  const sizes = extras?.pageSizeOptions ?? [];
  const showSizes =
    !!extras &&
    sizes.length > 1 &&
    !!extras.onPageSizeChange &&
    extras.totalItems > Math.min(...sizes);
  if (totalPages <= 1 && !showSizes) {
    el.innerHTML = '';
    return;
  }

  let rangeHtml = '';
  if (extras && extras.totalItems > 0) {
    const start = (page - 1) * extras.pageSize + 1;
    const end = Math.min(page * extras.pageSize, extras.totalItems);
    rangeHtml = `<span class="page-range">${start}\u2013${end} of ${extras.totalItems}</span>`;
  }
  const sizeHtml = showSizes
    ? `<label class="page-size"><span class="page-size-label">Rows</span><select class="form-input form-input-sm js-page-size" aria-label="Rows per page${
        extras!.itemLabel ? ` (${extras!.itemLabel})` : ''
      }">${sizes
        .map(
          (s) => `<option value="${s}"${s === extras!.pageSize ? ' selected' : ''}>${s}</option>`,
        )
        .join('')}</select></label>`
    : '';
  const navHtml =
    totalPages > 1
      ? `<span class="pagination-nav">
    <button class="btn btn-sm btn-ghost js-page-prev" aria-label="Previous page" ${page <= 1 ? 'disabled' : ''}>\u2190</button>
    <span class="page-info" aria-live="polite">${page} / ${totalPages}</span>
    <button class="btn btn-sm btn-ghost js-page-next" aria-label="Next page" ${page >= totalPages ? 'disabled' : ''}>\u2192</button>
  </span>`
      : '';

  el.innerHTML = extras
    ? `${rangeHtml}${sizeHtml}${navHtml}${moreHtml(page, extras, showSizes)}`
    : navHtml;
  el.classList.toggle('pagination-more', !!extras && showSizes);
  el.querySelector('.js-page-more')?.addEventListener('click', () => {
    shownMore.set(containerId, {
      size: page * extras!.pageSize + Math.min(...sizes),
      total: extras!.totalItems,
    });
    onPageChange(1);
  });
  el.querySelector('.js-page-prev')?.addEventListener('click', () => {
    if (page > 1) onPageChange(page - 1);
  });
  el.querySelector('.js-page-next')?.addEventListener('click', () => {
    if (page < totalPages) onPageChange(page + 1);
  });
  el.querySelector<HTMLSelectElement>('.js-page-size')?.addEventListener('change', (ev) => {
    const size = Number((ev.currentTarget as HTMLSelectElement).value);
    shownMore.delete(containerId);
    if (Number.isFinite(size) && size > 0) extras?.onPageSizeChange?.(size);
  });
}
