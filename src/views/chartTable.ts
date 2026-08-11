import { esc } from '../utils';

const CHART_TABLE_PAGE_SIZE = 25;

/**
 * Populate (or refresh) an accessible data-table mirror inside a `.chart-data-table-wrap`.
 * The table is always present in the DOM for screen readers; a toggle button lets sighted
 * users show or hide it. Re-calling this function updates the content in place.
 * Tables with more than PAGE_SIZE rows show pagination controls. The scroll wrapper allows
 * wide tables to scroll horizontally without overflowing the page.
 */
export function writeChartTable(
  wrapId: string,
  ariaLabel: string,
  headers: string[],
  rows: (string | number)[][],
): void {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const existingContent = wrap.querySelector('.chart-data-table-content') as HTMLDivElement | null;
  const existingTable = wrap.querySelector('.chart-data-table') as HTMLTableElement | null;
  const wasVisible = existingContent
    ? !existingContent.hidden
    : existingTable
      ? !existingTable.hidden
      : false;

  const totalPages = Math.max(1, Math.ceil(rows.length / CHART_TABLE_PAGE_SIZE));
  let currentPage = 0;

  const thCells = headers.map((h) => `<th scope="col">${esc(String(h))}</th>`).join('');
  const renderBodyRows = (page: number): string =>
    rows
      .slice(page * CHART_TABLE_PAGE_SIZE, (page + 1) * CHART_TABLE_PAGE_SIZE)
      .map((r) => `<tr>${r.map((c) => `<td>${esc(String(c))}</td>`).join('')}</tr>`)
      .join('');

  const paginationHtml =
    totalPages > 1
      ? `<div class="chart-data-table-pagination">
        <button class="chart-data-table-prev" type="button" aria-label="Previous page" disabled>&#8249;</button>
        <span class="chart-data-table-page-info">1 / ${totalPages}</span>
        <button class="chart-data-table-next" type="button" aria-label="Next page">&#8250;</button>
      </div>`
      : '';

  const tableHtml = `<div class="chart-data-table-content"${wasVisible ? '' : ' hidden'}>
    <div class="chart-data-table-scroll"><table class="chart-data-table" role="table" aria-label="${esc(ariaLabel)}">
    <thead><tr>${thCells}</tr></thead>
    <tbody>${renderBodyRows(0)}</tbody>
  </table></div>
    ${paginationHtml}
  </div>`;

  const toggleLabel = wasVisible ? 'Hide data table' : 'Show data table';
  wrap.innerHTML = `<button class="chart-data-table-toggle" type="button" aria-expanded="${wasVisible}">${toggleLabel}</button>${tableHtml}`;

  const btn = wrap.querySelector('.chart-data-table-toggle') as HTMLButtonElement;
  const content = wrap.querySelector('.chart-data-table-content') as HTMLDivElement;
  const table = wrap.querySelector('.chart-data-table') as HTMLTableElement;
  btn.addEventListener('click', () => {
    const visible = !content.hidden;
    content.hidden = visible;
    btn.textContent = visible ? 'Show data table' : 'Hide data table';
    btn.setAttribute('aria-expanded', String(!visible));
  });

  if (totalPages > 1) {
    const prevBtn = wrap.querySelector('.chart-data-table-prev') as HTMLButtonElement;
    const nextBtn = wrap.querySelector('.chart-data-table-next') as HTMLButtonElement;
    const pageInfo = wrap.querySelector('.chart-data-table-page-info') as HTMLSpanElement;
    const goToPage = (page: number): void => {
      currentPage = page;
      table.querySelector('tbody')!.innerHTML = renderBodyRows(currentPage);
      pageInfo.textContent = `${currentPage + 1} / ${totalPages}`;
      prevBtn.disabled = currentPage === 0;
      nextBtn.disabled = currentPage === totalPages - 1;
    };
    prevBtn.addEventListener('click', () => goToPage(currentPage - 1));
    nextBtn.addEventListener('click', () => goToPage(currentPage + 1));
  }

  wrap.removeAttribute('hidden');
}
