export function populateYearFilterOptions(
  elementId: string,
  items: Array<{ date: string }>,
): void {
  const select = document.getElementById(elementId) as HTMLSelectElement | null;
  if (!select) return;
  const years = [...new Set(items.map((item) => item.date.slice(0, 4)))].sort().reverse();
  const current = select.value;
  select.innerHTML =
    '<option value="">All years</option>' +
    years
      .map((y) => `<option value="${y}" ${y === current ? 'selected' : ''}>${y}</option>`)
      .join('');
}

export function bindYearFilter(
  elementId: string,
  onChange: (year: string) => void,
): void {
  const yearEl = document.getElementById(elementId) as
    (HTMLSelectElement & { _bound?: boolean }) | null;
  if (yearEl && !yearEl._bound) {
    yearEl._bound = true;
    yearEl.addEventListener('change', () => {
      onChange(yearEl.value);
    });
  }
}
