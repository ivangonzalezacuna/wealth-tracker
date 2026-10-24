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
    ? `<label class="page-size"><span class="page-size-label">Rows</span><select class="form-input form-input-sm themed-select js-page-size" aria-label="Rows per page${
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

  el.innerHTML = extras ? `${rangeHtml}${sizeHtml}${navHtml}` : navHtml;
  el.querySelector('.js-page-prev')?.addEventListener('click', () => {
    if (page > 1) onPageChange(page - 1);
  });
  el.querySelector('.js-page-next')?.addEventListener('click', () => {
    if (page < totalPages) onPageChange(page + 1);
  });
  el.querySelector<HTMLSelectElement>('.js-page-size')?.addEventListener('change', (ev) => {
    const size = Number((ev.currentTarget as HTMLSelectElement).value);
    if (Number.isFinite(size) && size > 0) extras?.onPageSizeChange?.(size);
  });
}
