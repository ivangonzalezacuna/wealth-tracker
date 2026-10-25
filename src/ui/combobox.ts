/**
 * Editable dropdown for free-text inputs that have known values (WAI-ARIA combobox pattern).
 * The arrow button lists every option, typing filters them, and any other text stays valid.
 * An option can carry a secondary hint and values for linked fields (`fills`), which only
 * replace fields the user hasn't typed into.
 */

export interface ComboOption {
  value: string;
  /** Secondary text shown next to the value (e.g. the ISIN of a fund name). */
  hint?: string;
  /** Linked fields to fill on pick: element id → value. */
  fills?: Record<string, string>;
}

export interface ComboboxHandle {
  setOptions(options: ComboOption[]): void;
  close(): void;
}

let _uid = 0;
let _programmatic = false;

/** Set a field's value and fire input/change without counting it as the user's own edit. */
export function setFieldValue(el: HTMLInputElement, value: string): void {
  if (el.value === value) return;
  _programmatic = true;
  try {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } finally {
    _programmatic = false;
  }
}

/** Remember when the user types into a field so linked fills leave it alone. */
export function trackUserEdits(el: HTMLInputElement): void {
  if (el.dataset.editTracked) return;
  el.dataset.editTracked = '1';
  el.addEventListener('input', () => {
    if (_programmatic) return;
    el.dataset.userEdited = '1';
    delete el.dataset.autofill;
  });
}

/**
 * Fill a linked field unless the user typed into it or it holds a value they chose.
 * Empty fields and fields marked `data-autofill` (defaults or earlier fills) are replaced.
 */
export function fillLinkedField(el: HTMLInputElement | null, value: string): void {
  if (!el || !value) return;
  trackUserEdits(el);
  if (el.dataset.userEdited) return;
  if (el.value.trim() && !el.dataset.autofill) return;
  setFieldValue(el, value);
  el.dataset.autofill = '1';
}

function rank(options: ComboOption[], term: string): ComboOption[] {
  const q = term.trim().toLowerCase();
  if (!q) return options;
  const starts: ComboOption[] = [];
  const contains: ComboOption[] = [];
  for (const opt of options) {
    const v = opt.value.toLowerCase();
    const h = (opt.hint || '').toLowerCase();
    if (v.startsWith(q)) starts.push(opt);
    else if (v.includes(q) || h.includes(q)) contains.push(opt);
  }
  return [...starts, ...contains];
}

const LIST_GAP = 4;
const VIEW_MARGIN = 8;
const LIST_MAX = 260;
/** Below this much room under the field, open upwards if there is more space above. */
const LIST_MIN = 160;

export function attachCombobox(
  input: HTMLInputElement,
  initial: ComboOption[] = [],
): ComboboxHandle {
  let options = initial;
  let shown: ComboOption[] = [];
  let active = -1;
  const id = `${input.id || 'combo'}-listbox-${++_uid}`;

  const wrap = document.createElement('span');
  wrap.className = 'combo';
  input.parentNode?.insertBefore(wrap, input);
  wrap.appendChild(input);
  input.removeAttribute('list');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', id);
  trackUserEdits(input);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'combo-toggle';
  toggle.tabIndex = -1;
  toggle.setAttribute('aria-label', 'Show options');
  toggle.innerHTML =
    '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  wrap.appendChild(toggle);

  const list = document.createElement('ul');
  list.className = 'combo-list';
  list.id = id;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.appendChild(list);

  const isOpen = (): boolean => !list.hidden;

  const sync = (): void => {
    wrap.classList.toggle('has-options', options.length > 0);
    toggle.hidden = options.length === 0;
  };

  const setActive = (index: number): void => {
    active = index;
    list.querySelectorAll<HTMLElement>('[role="option"]').forEach((li, i) => {
      li.classList.toggle('is-active', i === index);
      li.setAttribute('aria-selected', String(i === index));
      if (i === index) {
        // Scroll only the list: scrollIntoView would also scroll the dialog body behind it.
        const top = li.offsetTop;
        const bottom = top + li.offsetHeight;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (bottom > list.scrollTop + list.clientHeight)
          list.scrollTop = bottom - list.clientHeight;
      }
    });
    if (index >= 0) input.setAttribute('aria-activedescendant', `${id}-${index}`);
    else input.removeAttribute('aria-activedescendant');
  };

  // The list is `position: fixed` so a scrolling dialog body can't clip it; it is
  // sized to the visible viewport (on-screen keyboard included) and opens upwards
  // when there is more room above.
  const place = (): void => {
    const rect = wrap.getBoundingClientRect();
    const vv = window.visualViewport;
    const viewTop = vv ? vv.offsetTop : 0;
    const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const below = viewBottom - rect.bottom - LIST_GAP - VIEW_MARGIN;
    const above = rect.top - viewTop - LIST_GAP - VIEW_MARGIN;
    list.style.maxHeight = '';
    const natural = Math.min(LIST_MAX, list.scrollHeight);
    const up = below < Math.min(natural, LIST_MIN) && above > below;
    const height = Math.max(0, Math.min(natural, up ? above : below));
    list.style.maxHeight = `${Math.min(LIST_MAX, Math.max(0, up ? above : below))}px`;
    list.style.left = `${rect.left}px`;
    list.style.width = `${rect.width}px`;
    list.style.top = `${up ? rect.top - LIST_GAP - height : rect.bottom + LIST_GAP}px`;
    list.classList.toggle('combo-list-up', up);
    // A transformed ancestor would make `fixed` relative to it: correct for any offset.
    const actual = list.getBoundingClientRect();
    const want = up ? rect.top - LIST_GAP - height : rect.bottom + LIST_GAP;
    const dx = rect.left - actual.left;
    const dy = want - actual.top;
    if (Math.abs(dx) > 0.5) list.style.left = `${rect.left + dx}px`;
    if (Math.abs(dy) > 0.5) list.style.top = `${want + dy}px`;
  };

  /** Nearest scrolling ancestor, so the list closes once the field scrolls out of it. */
  const clipRect = (): DOMRect | null => {
    for (let el = wrap.parentElement; el; el = el.parentElement) {
      const { overflowY } = getComputedStyle(el);
      if (/(auto|scroll|hidden)/.test(overflowY)) return el.getBoundingClientRect();
    }
    return null;
  };

  function onReflow(e?: Event): void {
    if (e?.target === list) return;
    if (!wrap.isConnected) {
      close();
      return;
    }
    const clip = clipRect();
    const rect = wrap.getBoundingClientRect();
    if (clip && (rect.bottom < clip.top || rect.top > clip.bottom)) {
      close();
      return;
    }
    place();
  }
  const close = (): void => {
    if (!isOpen()) return;
    list.hidden = true;
    wrap.classList.remove('is-open');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('keydown', onEscape, true);
    window.removeEventListener('scroll', onReflow, true);
    window.removeEventListener('resize', onReflow);
    window.visualViewport?.removeEventListener('resize', onReflow);
    window.visualViewport?.removeEventListener('scroll', onReflow);
  };

  const render = (items: ComboOption[]): void => {
    shown = items;
    const current = input.value.trim().toLowerCase();
    list.replaceChildren(
      ...items.map((opt, i) => {
        const li = document.createElement('li');
        li.id = `${id}-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.dataset.index = String(i);
        if (opt.value.toLowerCase() === current) li.classList.add('is-current');
        const value = document.createElement('span');
        value.className = 'combo-value';
        value.textContent = opt.value;
        li.appendChild(value);
        if (opt.hint) {
          const hint = document.createElement('span');
          hint.className = 'combo-hint';
          hint.textContent = opt.hint;
          li.appendChild(hint);
        }
        return li;
      }),
    );
  };

  const open = (showAll: boolean): void => {
    const items = showAll ? options : rank(options, input.value);
    if (!items.length) {
      close();
      return;
    }
    render(items);
    const wasOpen = isOpen();
    list.hidden = false;
    wrap.classList.add('is-open');
    input.setAttribute('aria-expanded', 'true');
    place();
    const currentIndex = showAll
      ? items.findIndex((o) => o.value.toLowerCase() === input.value.trim().toLowerCase())
      : -1;
    setActive(currentIndex);
    if (!wasOpen) {
      document.addEventListener('pointerdown', onOutside, true);
      window.addEventListener('keydown', onEscape, true);
      window.addEventListener('scroll', onReflow, true);
      window.addEventListener('resize', onReflow);
      window.visualViewport?.addEventListener('resize', onReflow);
      window.visualViewport?.addEventListener('scroll', onReflow);
    }
  };

  const pick = (opt: ComboOption): void => {
    setFieldValue(input, opt.value);
    // A picked value is the user's own choice, so linked fills must leave it alone too.
    input.dataset.userEdited = '1';
    delete input.dataset.autofill;
    const scope = (input.closest('.dialog-overlay') as HTMLElement | null) ?? document;
    for (const [fieldId, value] of Object.entries(opt.fills ?? {})) {
      fillLinkedField(scope.querySelector<HTMLInputElement>(`[id="${fieldId}"]`), value);
    }
    close();
  };

  function onOutside(e: Event): void {
    if (!wrap.contains(e.target as Node)) close();
  }

  // Escape closes an open list first, even when focus isn't in the input (touch).
  function onEscape(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    // A list whose dialog was removed must not swallow keys meant for whatever replaced it.
    if (!wrap.isConnected) {
      close();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    close();
  }

  toggle.addEventListener('pointerdown', (e) => e.preventDefault());
  toggle.addEventListener('click', () => {
    if (isOpen()) {
      close();
      return;
    }
    // Touch: keep the on-screen keyboard closed when browsing the list.
    if (!window.matchMedia?.('(pointer: coarse)').matches) input.focus();
    open(true);
  });

  list.addEventListener('pointerdown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
    if (!li) return;
    const opt = shown[Number(li.dataset.index)];
    if (opt) pick(opt);
  });

  input.addEventListener('input', () => {
    if (_programmatic) return;
    open(false);
  });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen()) {
        open(true);
        return;
      }
      const n = shown.length;
      if (!n) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(active < 0 ? (step > 0 ? 0 : n - 1) : (active + step + n) % n);
      return;
    }
    if (!isOpen()) return;
    if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  });

  sync();
  return {
    setOptions(next) {
      options = next;
      sync();
      if (isOpen()) open(false);
    },
    close,
  };
}

/** Plain string values as options. */
export function toComboOptions(values: readonly string[]): ComboOption[] {
  return values.map((value) => ({ value }));
}
