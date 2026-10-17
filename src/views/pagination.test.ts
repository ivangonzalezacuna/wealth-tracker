/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderPagination } from './pagination';

describe('renderPagination', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'test-pagination';
    document.body.innerHTML = '';
    document.body.appendChild(container);
  });

  it('renders nothing when totalPages <= 1', () => {
    container.innerHTML = 'old content';
    renderPagination('test-pagination', 1, 1, vi.fn());
    expect(container.innerHTML).toBe('');
  });

  it('renders correct page info text', () => {
    renderPagination('test-pagination', 3, 10, vi.fn());
    const info = container.querySelector('.page-info');
    expect(info?.textContent).toBe('3 / 10');
  });

  it('prev button disabled on page 1', () => {
    renderPagination('test-pagination', 1, 5, vi.fn());
    const prev = container.querySelector('.js-page-prev') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
  });

  it('next button disabled on last page', () => {
    renderPagination('test-pagination', 5, 5, vi.fn());
    const next = container.querySelector('.js-page-next') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('clicking prev calls onPageChange with page - 1', () => {
    const cb = vi.fn();
    renderPagination('test-pagination', 3, 5, cb);
    const prev = container.querySelector('.js-page-prev') as HTMLButtonElement;
    prev.click();
    expect(cb).toHaveBeenCalledWith(2);
  });

  it('clicking next calls onPageChange with page + 1', () => {
    const cb = vi.fn();
    renderPagination('test-pagination', 3, 5, cb);
    const next = container.querySelector('.js-page-next') as HTMLButtonElement;
    next.click();
    expect(cb).toHaveBeenCalledWith(4);
  });

  it('does nothing if container does not exist', () => {
    const cb = vi.fn();
    renderPagination('nonexistent', 1, 5, cb);
    // No error thrown
    expect(cb).not.toHaveBeenCalled();
  });

  it('renders the item range when extras are provided', () => {
    renderPagination('test-pagination', 2, 3, vi.fn(), { totalItems: 40, pageSize: 15 });
    expect(container.querySelector('.page-range')?.textContent).toBe('16\u201330 of 40');
  });

  it('renders a page-size selector and reports changes', () => {
    const onSize = vi.fn();
    renderPagination('test-pagination', 1, 3, vi.fn(), {
      totalItems: 40,
      pageSize: 15,
      pageSizeOptions: [15, 25, 50],
      onPageSizeChange: onSize,
      itemLabel: 'transactions',
    });
    const select = container.querySelector('.js-page-size') as HTMLSelectElement;
    expect(select.value).toBe('15');
    expect(select.getAttribute('aria-label')).toBe('Rows per page (transactions)');
    select.value = '50';
    select.dispatchEvent(new Event('change'));
    expect(onSize).toHaveBeenCalledWith(50);
  });

  it('keeps the page-size selector on a single page when items exceed the smallest size', () => {
    renderPagination('test-pagination', 1, 1, vi.fn(), {
      totalItems: 40,
      pageSize: 50,
      pageSizeOptions: [15, 25, 50],
      onPageSizeChange: vi.fn(),
    });
    expect(container.querySelector('.js-page-size')).not.toBeNull();
    expect(container.querySelector('.js-page-next')).toBeNull();
    expect(container.querySelector('.page-range')?.textContent).toBe('1\u201340 of 40');
  });

  it('renders nothing on a single page when items fit the smallest size', () => {
    renderPagination('test-pagination', 1, 1, vi.fn(), {
      totalItems: 10,
      pageSize: 15,
      pageSizeOptions: [15, 25, 50],
      onPageSizeChange: vi.fn(),
    });
    expect(container.innerHTML).toBe('');
  });
});
