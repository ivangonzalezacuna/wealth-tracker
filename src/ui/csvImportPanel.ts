/**
 * CSV import preview for the transaction ledger. Replaces the ledger list while open and reuses
 * its row layout, filter bar, sortable headers and pagination. Rows already stored are shown
 * but never imported; unknown types start excluded; SELLs that exceed holdings block Confirm.
 * Filter categories are fixed per row, so toggling a checkbox never hides the row.
 */
import type { ImportProfile, ParseResult, Transaction } from '../types';
import { parseWithProfile, previewSummary } from '../import/parse';
import {
  classifyPreviewRows,
  defaultExcluded,
  findOversells,
  type PreviewRow,
} from '../import/previewRows';
import { esc, fmtDay } from '../utils';
import { TX_PAGE_SIZES, createTxDetail, fmtTxMoney, txDetailId, txTypeLabel } from '../views/log';
import type { ColumnDef } from '../views/tableColumns';
import { renderTableHeader, renderTableRow } from '../views/tableColumns';
import { bindSortedTableHeader, sortAndPaginate, tableEmptyStateHtml } from '../views/tableView';
import { createPageSizePref, renderPagination } from '../views/pagination';
import { createTableState, setTablePage, setTableSort } from '../views/tableState';
import { bindChipGroup, bindSearchClear, chipButtonsHtml } from './filterBar';
import { attachEtfPopovers } from './etfPopover';

export interface CsvImportSource {
  csvText: string;
  fileName: string;
  /** Auto-detected profile, or null to ask the user. */
  profile: ImportProfile | null;
}

export interface CsvImportResult {
  /** New, included rows to store. */
  rows: Transaction[];
  duplicateCount: number;
  excludedCount: number;
}

export interface CsvImportHost {
  profiles: ImportProfile[];
  /** Transactions currently stored (read on every render). */
  existing(): Transaction[];
  /** Read-only or sync in progress: Confirm stays disabled. */
  blocked(): string;
  /** Store the rows; resolve true to close the preview, false to keep it open. */
  confirm(result: CsvImportResult): Promise<boolean>;
  onOpenChange(open: boolean): void;
  onCancel(): void;
}

type StatusFilter = '' | 'new' | 'stored' | 'review';

const PAGE_SIZE_KEY = 'wt:log:importPageSize';
const pageSizePref = createPageSizePref(PAGE_SIZE_KEY, TX_PAGE_SIZES);

let active: { refresh(): void; close(): void } | null = null;

export function isCsvImportPreviewOpen(): boolean {
  return active !== null;
}

export function closeCsvImportPreview(): void {
  active?.close();
}

/** Re-evaluate Confirm (e.g. after sync busy / read-only changes). */
export function refreshCsvImportPreview(): void {
  active?.refresh();
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;

/**
 * When every row of a recognised file is already in the ledger (and none failed to parse),
 * the preview would have nothing to act on: return a notice to show instead of opening it.
 */
export function nothingNewNotice(source: CsvImportSource, existing: Transaction[]): string | null {
  if (!source.profile) return null;
  const parsed = parseWithProfile(source.csvText, source.profile);
  if (parsed.errorLines.length) return null;
  const rows = classifyPreviewRows(existing, parsed.transactions, parsed.numberErrorRows);
  if (!rows.length || rows.some((r) => r.status === 'new')) return null;
  const changed = rows.filter((r) => r.status === 'changed').length;
  const all =
    rows.length === 1 ? 'Its only row is' : `All ${rows.length.toLocaleString('de-DE')} rows are`;
  return `Nothing new in ${source.fileName}. ${all} already in the ledger${
    changed
      ? `; ${plural(changed, 'row')} ${changed === 1 ? 'differs' : 'differ'} from the stored version, which is kept`
      : ''
  }.`;
}

export function openCsvImportPreview(
  container: HTMLElement,
  source: CsvImportSource,
  host: CsvImportHost,
): void {
  active?.close();

  let profile = source.profile;
  let parsed: ParseResult | null = null;
  let rows: PreviewRow[] = [];
  let excluded = new Set<number>();
  /** Rows flagged for review; only grows so rows never vanish from the "Needs review" view. */
  let review = new Set<number>();
  let hideDateWarning = false;
  let saving = false;
  let statusFilter: StatusFilter = '';
  let search = '';
  const table = createTableState();
  const openDetails = new Set<number>();

  container.innerHTML = `
    <div class="import-preview-head">
      <div class="import-preview-title">
        <div class="section-label">Import preview</div>
        <div class="log-panel-meta" id="import-preview-meta"></div>
      </div>
      <label class="import-profile">
        <span class="import-profile-label">Format</span>
        <select id="import-profile-select" class="form-input form-input-sm" aria-label="CSV format">
          ${profile ? '' : '<option value="" selected disabled>Choose format\u2026</option>'}
          ${host.profiles
            .map(
              (p) =>
                `<option value="${esc(p.id)}"${p.id === profile?.id ? ' selected' : ''}>${esc(p.label)}</option>`,
            )
            .join('')}
        </select>
      </label>
    </div>
    <div id="import-issues"></div>
    <div id="import-preview-body">
      <div class="filter-bar log-filter-bar" id="import-filter-bar">
        <span class="filter-search"><input type="search" id="import-search" class="form-input form-input-sm" aria-label="Search import rows" placeholder="Name, ISIN, type\u2026" autocomplete="off"><button type="button" class="filter-clear" data-clear-search aria-label="Clear search">&times;</button></span>
        <div class="filter-bar-actions import-selection" id="import-selection">
          <span class="note" id="import-selection-count" aria-live="polite"></span>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-import-select"></button>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-import-clear"></button>
        </div>
        <div id="import-status-filter" class="range-toggle filter-chips filter-chips-scroll" role="group" aria-label="Filter import rows by status"></div>
      </div>
      <div class="tbl">
        <div id="import-preview-wrap"><div id="import-preview-list" class="tx-ledger-grid" role="table" aria-label="Rows to import"></div></div>
      </div>
      <div id="import-pagination" class="pagination"></div>
    </div>
    <div class="import-preview-actions">
      <span class="note" id="import-preview-hint" role="status" aria-live="polite"></span>
      <button type="button" class="btn btn-ghost btn-sm" id="btn-cancel-import">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-confirm-import" disabled>Import</button>
    </div>`;
  container.hidden = false;

  const $ = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel)!;
  const metaEl = $('#import-preview-meta');
  const issuesEl = $('#import-issues');
  const bodyEl = $('#import-preview-body');
  const listEl = $('#import-preview-list');
  const chipsEl = $('#import-status-filter');
  const hintEl = $('#import-preview-hint');
  const confirmBtn = $<HTMLButtonElement>('#btn-confirm-import');
  const cancelBtn = $<HTMLButtonElement>('#btn-cancel-import');
  const profileSelect = $<HTMLSelectElement>('#import-profile-select');
  const searchEl = $<HTMLInputElement>('#import-search');
  const selectionEl = $('#import-selection');
  const selectionCountEl = $('#import-selection-count');
  const selectBtn = $<HTMLButtonElement>('#btn-import-select');
  const clearBtn = $<HTMLButtonElement>('#btn-import-clear');

  function parse(): void {
    if (!profile) {
      parsed = null;
      rows = [];
      excluded = new Set();
      review = new Set();
      return;
    }
    parsed = parseWithProfile(source.csvText, profile);
    rows = classifyPreviewRows(host.existing(), parsed.transactions, parsed.numberErrorRows);
    excluded = defaultExcluded(rows);
    review = new Set(
      rows.filter((r) => r.unmapped || r.numberError || r.status === 'changed').map((r) => r.idx),
    );
    const hasNew = rows.some((r) => r.status === 'new');
    // Re-imports are mostly rows already stored: start on the new ones.
    statusFilter = hasNew && rows.some((r) => r.status !== 'new') ? 'new' : '';
    hideDateWarning = false;
    openDetails.clear();
    setTablePage(table, 1);
  }

  const isIncluded = (r: PreviewRow) => r.status === 'new' && !excluded.has(r.idx);

  function computeOversells(): Set<Transaction> {
    const oversells = findOversells(
      host.existing(),
      rows.filter(isIncluded).map((r) => r.tx),
    );
    for (const r of rows) if (oversells.has(r.tx)) review.add(r.idx);
    return oversells;
  }

  function matchesStatus(r: PreviewRow, f: StatusFilter): boolean {
    switch (f) {
      case 'new':
        return r.status === 'new';
      case 'stored':
        return r.status !== 'new';
      case 'review':
        return review.has(r.idx);
      default:
        return true;
    }
  }

  const shownRows = () => rows.filter((r) => matchesStatus(r, statusFilter) && matchesSearch(r));

  function matchesSearch(r: PreviewRow): boolean {
    if (!search) return true;
    const t = r.tx;
    return [t.name, t.isin, t.type, txTypeLabel(t.type), t.date].some((v) =>
      (v || '').toLowerCase().includes(search),
    );
  }

  function statusBadge(r: PreviewRow, oversells: Set<Transaction>): string {
    const pill = (cls: string, label: string, title = '') =>
      `<span class="status-pill import-status ${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</span>`;
    if (r.status === 'duplicate')
      return pill('status-empty', 'In ledger', 'Already stored; skipped');
    if (r.status === 'changed')
      return pill(
        'status-warn',
        'In ledger \u00B7 differs',
        'Already stored with different values; the stored row is kept',
      );
    if (excluded.has(r.idx)) return pill('status-empty', 'Excluded');
    if (oversells.has(r.tx))
      return pill(
        'status-err',
        'Exceeds holdings',
        'Sells more shares than held; exclude it to continue',
      );
    if (r.unmapped) return pill('status-warn', 'Unknown type', `Stored as "${r.tx.type}"`);
    if (r.numberError)
      return pill('status-warn', 'Check values', 'A number could not be read and was set to 0');
    return pill('status-ok', 'New');
  }

  function columns(oversells: Set<Transaction>): ColumnDef<PreviewRow>[] {
    return [
      {
        key: 'date',
        label: 'Date',
        sortValue: (r) => r.tx.date,
        cellAttrs: () => 'data-ledger-label="Date"',
        cell: (r) =>
          `<span class="row-expand-chevron" aria-hidden="true">&#x25B8;</span><span class="snap-month">${fmtDay(r.tx.date)}</span>`,
      },
      {
        key: 'type',
        label: 'Type',
        sortValue: (r) => r.tx.type,
        cellAttrs: () => 'data-ledger-label="Type"',
        cell: (r) =>
          `<span class="tx-ledger-chip${r.unmapped ? ' tx-ledger-chip-unknown' : ''}">${esc(txTypeLabel(r.tx.type || '-'))}</span>`,
      },
      {
        key: 'name',
        label: 'Name',
        sortValue: (r) => r.tx.name || '',
        cellAttrs: (r) => `data-ledger-label="Name"${!r.tx.name ? ' data-ledger-empty="1"' : ''}`,
        cell: (r) =>
          r.tx.name
            ? `<span class="tx-ledger-name" data-etf-isin="${esc(r.tx.isin || '')}" data-etf-name="${esc(r.tx.name)}">${esc(r.tx.name)}</span>${
                r.tx.isin
                  ? `<span class="tx-ledger-meta tx-ledger-isin">${esc(r.tx.isin)}</span>`
                  : ''
              }`
            : '',
      },
      {
        key: 'amount',
        label: 'Amount',
        align: 'right',
        sortValue: (r) => r.tx.amount || 0,
        cellAttrs: () => 'style="text-align:right" data-ledger-label="Amount"',
        cell: (r) => {
          const t = r.tx;
          const amount = `<span class="tx-ledger-amount ${(t.amount || 0) < 0 ? 'neg' : 'pos'}">${fmtTxMoney(t.amount || 0, t.currency)}</span>`;
          return (
            amount + (t.shares ? `<span class="tx-ledger-meta">${t.shares} shares</span>` : '')
          );
        },
      },
      {
        key: 'status',
        label: 'Status',
        sortValue: (r) =>
          r.status !== 'new'
            ? 3
            : excluded.has(r.idx)
              ? 2
              : oversells.has(r.tx) || r.unmapped || r.numberError
                ? 0
                : 1,
        raw: true,
        cell: (r) =>
          `<div role="cell" class="tx-actions tx-actions-desktop import-status-cell" data-ledger-label="Status">${statusBadge(r, oversells)}</div>`,
      },
    ];
  }

  function renderMeta(): void {
    if (!parsed) {
      metaEl.textContent = source.fileName;
      return;
    }
    const newCount = rows.filter((r) => r.status === 'new').length;
    const stored = rows.length - newCount;
    metaEl.textContent = [
      source.fileName,
      plural(rows.length, 'row'),
      `${newCount.toLocaleString('de-DE')} new`,
      stored ? `${stored.toLocaleString('de-DE')} in ledger` : '',
    ]
      .filter(Boolean)
      .join(' \u00B7 ');
  }

  function renderIssues(oversells: Set<Transaction>): void {
    if (!parsed) {
      issuesEl.innerHTML = `<div class="status-bar status-info import-issues">Couldn\u2019t detect the format of this file. Choose the matching export format above.</div>`;
      return;
    }
    const summary = previewSummary(parsed);
    const items: string[] = [];
    const codeList = (list: { label: string; count: number }[]) =>
      list.map((x) => `<code>${esc(x.label)}</code> (${x.count})`).join(', ');

    const unmappedRows = rows.filter((r) => r.status === 'new' && r.unmapped).length;
    if (unmappedRows)
      items.push(
        `<li>${plural(unmappedRows, 'row')} with unknown types ${codeList(
          summary.unmapped.map((u) => ({ label: u.type, count: u.count })),
        )} start excluded. Include them to store them under that type.</li>`,
      );
    const dateErrors = summary.dateErrors.reduce((s, d) => s + d.count, 0);
    if (dateErrors && !hideDateWarning)
      items.push(
        `<li id="import-date-warn">${plural(dateErrors, 'row')} skipped: unreadable date ${codeList(
          summary.dateErrors.map((d) => ({ label: d.raw, count: d.count })),
        )}. <button type="button" class="btn-link" id="btn-dismiss-date-warn">Dismiss</button></li>`,
      );
    const numberErrors = summary.numberErrors.reduce((s, e) => s + e.count, 0);
    if (numberErrors)
      items.push(
        `<li>${plural(numberErrors, 'cell')} could not be read as numbers and were set to 0 ${codeList(
          summary.numberErrors.map((e) => ({ label: `${e.field}: ${e.raw}`, count: e.count })),
        )}.</li>`,
      );
    const changed = rows.filter((r) => r.status === 'changed').length;
    if (changed)
      items.push(
        `<li>${plural(changed, 'row')} already in the ledger ${changed === 1 ? 'differs' : 'differ'} from this file. The stored ${changed === 1 ? 'version is' : 'versions are'} kept.</li>`,
      );
    if (oversells.size)
      items.push(
        `<li class="import-issue-block">${plural(oversells.size, 'sell')} ${oversells.size === 1 ? 'exceeds' : 'exceed'} the shares held. Exclude ${oversells.size === 1 ? 'it' : 'them'} to continue. <button type="button" class="btn-link" id="btn-exclude-oversells">Exclude ${oversells.size === 1 ? 'it' : 'them'}</button></li>`,
      );
    const errorRows = dateErrors > 0 || numberErrors > 0;
    if (!items.length && !errorRows) {
      issuesEl.innerHTML = '';
      return;
    }
    issuesEl.innerHTML = `<div class="status-bar ${oversells.size ? 'status-err' : 'status-warn'} import-issues" role="note">
      <ul>${items.join('')}</ul>
      ${errorRows ? '<button type="button" class="btn btn-ghost btn-sm" id="btn-dl-error-rows">Download problem rows (CSV)</button>' : ''}
    </div>`;
  }

  function renderChips(): void {
    const count = (f: StatusFilter) => rows.filter((r) => matchesStatus(r, f)).length;
    const chips: { value: StatusFilter; label: string; count: number }[] = [
      { value: '', label: 'All', count: rows.length },
      { value: 'new', label: 'New', count: count('new') },
      { value: 'review', label: 'Needs review', count: count('review') },
      { value: 'stored', label: 'In ledger', count: count('stored') },
    ];
    const visible = chips.filter((c) => c.value === '' || c.count > 0 || c.value === statusFilter);
    chipsEl.hidden = visible.length < 3;
    chipsEl.innerHTML = chipButtonsHtml({
      attr: 'import-status',
      value: statusFilter,
      chips: visible,
    });
  }

  function renderList(oversells: Set<Transaction>): void {
    const shown = shownRows();
    const pagination = document.getElementById('import-pagination');
    if (!shown.length) {
      listEl.innerHTML = tableEmptyStateHtml(
        rows.length
          ? '<p class="note">No rows match. <button type="button" class="btn-link filter-clear-all" data-clear-filters>Clear filters</button></p>'
          : '<p class="note">No transactions found in this file.</p>',
      );
      if (pagination) pagination.innerHTML = '';
      return;
    }
    const cols = columns(oversells);
    const { pageItems, page, totalPages } = sortAndPaginate(
      shown,
      cols,
      table.sort,
      table.page,
      pageSizePref.size,
    );
    setTablePage(table, page);
    const [dateCol, typeCol, ...restCols] = cols;
    const statusCol = restCols.pop()!;
    const newShown = shown.filter((r) => r.status === 'new');
    const checkedShown = newShown.filter(isIncluded).length;
    listEl.innerHTML = `
      <div class="tbl-row th tx-row" role="row" id="import-table-header">
        <div role="columnheader" class="import-include-cell">${
          newShown.length
            ? `<input type="checkbox" class="js-import-include-page" aria-label="Select all shown new rows" ${checkedShown === newShown.length ? 'checked' : ''}>`
            : ''
        }</div>
        ${renderTableHeader([dateCol, typeCol, ...restCols, statusCol], table.sort)}
      </div>
      ${pageItems
        .map((r) => {
          const key = `import-${r.idx}`;
          const include =
            r.status === 'new'
              ? `<input type="checkbox" class="js-import-include" data-idx="${r.idx}" aria-label="Include ${esc(txTypeLabel(r.tx.type))} on ${fmtDay(r.tx.date)}" ${excluded.has(r.idx) ? '' : 'checked'}>`
              : '';
          const rowCls = [
            'tbl-row tx-row',
            r.status !== 'new' ? 'import-row-stored' : '',
            r.status === 'new' && excluded.has(r.idx) ? 'import-row-excluded' : '',
            oversells.has(r.tx) ? 'import-row-blocked' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return `<div class="${rowCls}" role="row" tabindex="0" aria-expanded="false" aria-controls="${txDetailId(key)}" data-txkey="${esc(key)}" data-idx="${r.idx}">
            <div class="tx-card-header"><div role="cell" class="import-include-cell" data-ledger-label="Include">${include}</div>${renderTableRow([dateCol, typeCol], r)}<div role="cell" class="tx-actions tx-actions-mobile" data-ledger-label="Status">${statusBadge(r, oversells)}</div></div>
            ${renderTableRow(restCols, r)}
            ${statusCol.cell!(r)}
          </div>`;
        })
        .join('')}`;

    const headerBox = listEl.querySelector<HTMLInputElement>('.js-import-include-page');
    if (headerBox) headerBox.indeterminate = checkedShown > 0 && checkedShown < newShown.length;
    for (const row of listEl.querySelectorAll<HTMLElement>('.tx-row:not(.th)')) {
      if (openDetails.has(Number(row.dataset.idx))) toggleDetail(row, true);
    }
    bindSortedTableHeader(document.getElementById('import-table-header'), table.sort, (s) => {
      setTableSort(table, s);
      update();
    });
    attachEtfPopovers(listEl);
    renderPagination(
      'import-pagination',
      table.page,
      totalPages,
      (p) => {
        setTablePage(table, p);
        update();
      },
      {
        totalItems: shown.length,
        pageSize: pageSizePref.size,
        pageSizeOptions: TX_PAGE_SIZES,
        itemLabel: 'rows',
        onPageSizeChange: (size) => {
          pageSizePref.set(size);
          setTablePage(table, 1);
          update();
        },
      },
    );
  }

  /** "12 of 40 new rows selected ? Select all ? Clear" (or "? shown" while filtered). */
  function renderSelection(): void {
    const allNew = rows.filter((r) => r.status === 'new');
    selectionEl.hidden = !allNew.length;
    if (!allNew.length) return;
    const selected = allNew.filter(isIncluded).length;
    const shownNew = shownRows().filter((r) => r.status === 'new');
    const narrowed = shownNew.length < allNew.length;
    const shownSelected = shownNew.filter(isIncluded).length;
    selectionCountEl.textContent = `${selected.toLocaleString('de-DE')} of ${plural(allNew.length, 'new row')} selected`;
    selectBtn.textContent = narrowed
      ? `Select ${shownNew.length.toLocaleString('de-DE')} shown`
      : 'Select all';
    clearBtn.textContent = narrowed ? 'Clear shown' : 'Clear';
    selectBtn.disabled = saving || shownSelected === shownNew.length;
    clearBtn.disabled = saving || shownSelected === 0;
  }

  function renderActions(oversells: Set<Transaction>): void {
    const included = rows.filter(isIncluded).length;
    const stored = rows.filter((r) => r.status !== 'new').length;
    const excludedCount = rows.filter((r) => r.status === 'new' && excluded.has(r.idx)).length;
    const blockedReason = host.blocked();
    confirmBtn.textContent = saving
      ? 'Importing\u2026'
      : included
        ? `Import ${plural(included, 'transaction')}`
        : 'Import';
    confirmBtn.disabled =
      saving || !parsed || included === 0 || oversells.size > 0 || !!blockedReason;
    confirmBtn.title = blockedReason;
    cancelBtn.disabled = saving;
    profileSelect.disabled = saving;
    let hint: string;
    if (!parsed) hint = 'Choose a format to preview the rows.';
    else if (blockedReason) hint = blockedReason;
    else if (oversells.size) hint = 'Exclude the rows that exceed holdings to continue.';
    else if (!rows.length) hint = 'Nothing to import.';
    else if (!rows.some((r) => r.status === 'new'))
      hint = 'Nothing new to import. Every row is already in the ledger.';
    else if (!included) hint = 'All new rows are excluded.';
    else
      hint = [
        stored ? `${stored.toLocaleString('de-DE')} already in ledger (skipped)` : '',
        excludedCount ? `${excludedCount.toLocaleString('de-DE')} excluded` : '',
      ]
        .filter(Boolean)
        .join(' \u00B7 ');
    hintEl.textContent = hint;
  }

  function update(): void {
    const oversells = computeOversells();
    renderMeta();
    renderIssues(oversells);
    bodyEl.hidden = !parsed;
    if (parsed) {
      renderChips();
      renderList(oversells);
      renderSelection();
    }
    renderActions(oversells);
  }

  function toggleDetail(row: HTMLElement, open?: boolean): void {
    const idx = Number(row.dataset.idx);
    const r = rows[idx];
    if (!r) return;
    const next = row.nextElementSibling as HTMLElement | null;
    const isOpen = !!next?.matches('.tx-detail');
    const want = open ?? !isOpen;
    if (isOpen && !want) {
      next!.remove();
      row.setAttribute('aria-expanded', 'false');
      openDetails.delete(idx);
    } else if (!isOpen && want) {
      row.insertAdjacentElement(
        'afterend',
        createTxDetail(r.tx, row.dataset.txkey || `import-${idx}`),
      );
      row.setAttribute('aria-expanded', 'true');
      openDetails.add(idx);
    }
  }

  function setIncluded(idxs: number[], include: boolean): void {
    for (const idx of idxs) {
      if (include) excluded.delete(idx);
      else excluded.add(idx);
    }
    update();
  }

  const shownNewIdxs = () =>
    shownRows()
      .filter((r) => r.status === 'new')
      .map((r) => r.idx);

  const listeners = new AbortController();

  function close(): void {
    if (active !== handle) return;
    active = null;
    listeners.abort();
    container.innerHTML = '';
    container.hidden = true;
    host.onOpenChange(false);
  }

  const handle = { refresh: update, close };
  active = handle;

  profileSelect.addEventListener('change', () => {
    const next = host.profiles.find((p) => p.id === profileSelect.value);
    if (!next) return;
    profile = next;
    profileSelect.querySelector('option[value=""]')?.remove();
    parse();
    update();
  });
  searchEl.addEventListener('input', () => {
    search = searchEl.value.trim().toLowerCase();
    setTablePage(table, 1);
    update();
  });
  bindSearchClear($('#import-filter-bar'));
  bindChipGroup(chipsEl, 'import-status', (value) => {
    statusFilter = value as StatusFilter;
    setTablePage(table, 1);
    update();
  });
  selectBtn.addEventListener('click', () => setIncluded(shownNewIdxs(), true));
  clearBtn.addEventListener('click', () => setIncluded(shownNewIdxs(), false));

  container.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('#btn-dismiss-date-warn')) {
        hideDateWarning = true;
        update();
        return;
      }
      if (target.closest('#btn-exclude-oversells')) {
        const oversells = computeOversells();
        setIncluded(
          rows.filter((r) => oversells.has(r.tx)).map((r) => r.idx),
          false,
        );
        return;
      }
      if (target.closest('#btn-dl-error-rows') && parsed) {
        const blob = new Blob([[parsed.headerLine, ...parsed.errorLines].join('\n')], {
          type: 'text/csv',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'import-errors.csv';
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      if (target.closest('[data-clear-filters]')) {
        statusFilter = '';
        search = '';
        searchEl.value = '';
        setTablePage(table, 1);
        update();
        return;
      }
      if (!listEl.contains(target)) return;
      if (target.closest('button, a, input, select, label, textarea')) return;
      const row = target.closest<HTMLElement>('.tx-row:not(.th)');
      if (row) toggleDetail(row);
    },
    { signal: listeners.signal },
  );
  listEl.addEventListener('keydown', (e) => {
    const row = e.target as HTMLElement;
    if (!row.matches?.('.tx-row:not(.th)')) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    toggleDetail(row);
  });
  listEl.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.matches('.js-import-include')) {
      const idx = target.dataset.idx;
      setIncluded([Number(idx)], target.checked);
      listEl.querySelector<HTMLInputElement>(`.js-import-include[data-idx="${idx}"]`)?.focus();
    } else if (target.matches('.js-import-include-page')) {
      setIncluded(shownNewIdxs(), target.checked);
      listEl.querySelector<HTMLInputElement>('.js-import-include-page')?.focus();
    }
  });
  cancelBtn.addEventListener('click', () => {
    close();
    host.onCancel();
  });
  confirmBtn.addEventListener('click', async () => {
    if (saving || confirmBtn.disabled) return;
    const included = rows.filter(isIncluded);
    if (!included.length || computeOversells().size) return;
    saving = true;
    update();
    let done = false;
    try {
      done = await host.confirm({
        rows: included.map((r) => r.tx),
        duplicateCount: rows.filter((r) => r.status !== 'new').length,
        excludedCount: rows.filter((r) => r.status === 'new' && excluded.has(r.idx)).length,
      });
    } finally {
      saving = false;
      if (done) close();
      else if (active === handle) update();
    }
  });

  host.onOpenChange(true);
  parse();
  update();
}
