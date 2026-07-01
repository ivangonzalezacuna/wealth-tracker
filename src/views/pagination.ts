/**
 * Generic pagination control renderer, used by every paginated table/chart
 * in the app. Writes prev/page-info/next controls into `containerId` and
 * wires click handlers that call `onPageChange` with the new page number.
 * Hides the container entirely when there is only one page.
 */
export function renderPagination(
  containerId: string,
  page: number,
  totalPages: number,
  onPageChange: (page: number) => void,
): void {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <button class="btn btn-sm btn-ghost js-page-prev" ${page <= 1 ? 'disabled' : ''}>\u2190</button>
    <span class="page-info">${page} / ${totalPages}</span>
    <button class="btn btn-sm btn-ghost js-page-next" ${page >= totalPages ? 'disabled' : ''}>\u2192</button>
  `;
  el.querySelector('.js-page-prev')?.addEventListener('click', () => {
    if (page > 1) onPageChange(page - 1);
  });
  el.querySelector('.js-page-next')?.addEventListener('click', () => {
    if (page < totalPages) onPageChange(page + 1);
  });
}
