/**
 * Shared filter controls: chip groups with counts, a search box with a clear button and a
 * "x of y · Clear filters" status line. Views keep their own filter state and semantics.
 */
import { esc } from '../utils';

export interface FilterChip {
  value: string;
  label: string;
  count?: number;
}

export interface ChipGroupOptions {
  id?: string;
  ariaLabel: string;
  /** Data attribute (without `data-`) that carries the chip value, e.g. `filter`. */
  attr: string;
  chips: FilterChip[];
  value: string;
  /** Single row that scrolls sideways instead of wrapping (phones). */
  scroll?: boolean;
}

const fmtCount = (n: number) => n.toLocaleString('de-DE');

export function chipGroupHtml(o: ChipGroupOptions): string {
  const cls = `range-toggle filter-chips${o.scroll ? ' filter-chips-scroll' : ''}`;
  return `<div class="${cls}"${o.id ? ` id="${esc(o.id)}"` : ''} role="group" aria-label="${esc(o.ariaLabel)}">${chipButtonsHtml(o)}</div>`;
}

/** Just the chip buttons, for a static group container in the template. */
export function chipButtonsHtml(o: Pick<ChipGroupOptions, 'attr' | 'chips' | 'value'>): string {
  return o.chips
    .map((c) => {
      const on = c.value === o.value;
      const count =
        c.count != null ? ` <span class="chip-count">${esc(fmtCount(c.count))}</span>` : '';
      return `<button type="button" class="btn btn-sm btn-ghost filter-chip${on ? ' active' : ''}" data-${o.attr}="${esc(c.value)}" aria-pressed="${on}">${esc(c.label)}${count}</button>`;
    })
    .join('');
}

/** Sync pressed state after a chip group was rendered (static containers). */
export function setChipValue(group: HTMLElement | null, attr: string, value: string): void {
  if (!group) return;
  const key = attr.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  for (const btn of group.querySelectorAll<HTMLElement>(`[data-${attr}]`)) {
    const on = btn.dataset[key] === value;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
}

const _boundChips = new WeakSet<HTMLElement>();

/** Delegated chip clicks on a container that outlives re-renders (bound once). */
export function bindChipGroup(
  container: HTMLElement | null,
  attr: string,
  onPick: (value: string) => void,
): void {
  if (!container || _boundChips.has(container)) return;
  _boundChips.add(container);
  const key = attr.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  container.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(`[data-${attr}]`);
    if (!btn || !container.contains(btn)) return;
    onPick(btn.dataset[key] ?? '');
  });
}

export interface SearchOptions {
  id: string;
  value: string;
  placeholder: string;
  ariaLabel: string;
}

/** Search input wrapped with a clear (×) button that shows only while there is text. */
export function searchHtml(o: SearchOptions): string {
  return `<span class="filter-search"><input type="search" id="${esc(o.id)}" class="form-input form-input-sm" placeholder="${esc(o.placeholder)}" aria-label="${esc(o.ariaLabel)}" value="${esc(o.value)}" autocomplete="off"><button type="button" class="filter-clear" data-clear-search aria-label="Clear search">&times;</button></span>`;
}

const _boundClear = new WeakSet<HTMLElement>();

/**
 * Clear buttons inside `root` empty their sibling input and fire `input`, so the view's own
 * search handler runs. Bound once per root.
 */
export function bindSearchClear(root: HTMLElement | null): void {
  if (!root || _boundClear.has(root)) return;
  _boundClear.add(root);
  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-clear-search]');
    if (!btn || !root.contains(btn)) return;
    const input = btn.parentElement?.querySelector<HTMLInputElement>('input');
    if (!input) return;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // The view may have re-rendered the input; focus whichever one is current.
    (document.getElementById(input.id) as HTMLInputElement | null)?.focus();
  });
}

export interface FilterStatus {
  shown: number;
  total: number;
  /** Plural noun, e.g. "transactions". */
  noun: string;
  active: boolean;
  /** Short note, e.g. "from chart". */
  note?: string;
}

/** Fill a status element with "x of y noun · Clear filters", or hide it when no filter is on. */
export function renderFilterStatus(el: HTMLElement | null, s: FilterStatus): void {
  if (!el) return;
  el.hidden = !s.active;
  if (!s.active) {
    el.innerHTML = '';
    return;
  }
  const note = s.note ? `<span class="filter-status-note">${esc(s.note)}</span>` : '';
  el.innerHTML = `${note}<span>${esc(fmtCount(s.shown))} of ${esc(fmtCount(s.total))} ${esc(s.noun)}</span><button type="button" class="btn-link filter-clear-all" data-clear-filters>Clear filters</button>`;
}

const _boundStatus = new WeakSet<HTMLElement>();

export function bindFilterStatus(el: HTMLElement | null, onClear: () => void): void {
  if (!el || _boundStatus.has(el)) return;
  _boundStatus.add(el);
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-clear-filters]')) onClear();
  });
}
