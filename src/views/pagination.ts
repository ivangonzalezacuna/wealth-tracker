/** Render prev/next pagination controls. Hidden when totalPages <= 1. */
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
    <button class="btn btn-sm btn-ghost js-page-prev" aria-label="Previous page" ${page <= 1 ? 'disabled' : ''}>\u2190</button>
    <span class="page-info" aria-live="polite">${page} / ${totalPages}</span>
    <button class="btn btn-sm btn-ghost js-page-next" aria-label="Next page" ${page >= totalPages ? 'disabled' : ''}>\u2192</button>
  `;
  el.querySelector('.js-page-prev')?.addEventListener('click', () => {
    if (page > 1) onPageChange(page - 1);
  });
  el.querySelector('.js-page-next')?.addEventListener('click', () => {
    if (page < totalPages) onPageChange(page + 1);
  });
}
