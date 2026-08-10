export interface ModalShellOptions {
  overlay: HTMLElement;
  onDismiss: () => void;
  onSubmitEnter?: () => void;
  submitWhenActive?: (active: HTMLElement | null) => boolean;
  focusablesSelector?: string;
}

const DEFAULT_FOCUSABLES =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])';

export interface DialogController<Result> {
  begin(resolve: (value: Result) => void): void;
  setCleanup(cleanup: (() => void) | null): void;
  setOverlay(overlay: HTMLElement | null): void;
  overlay(): HTMLElement | null;
  dismiss(result: Result): void;
}

export function activateModalShell(opts: ModalShellOptions): () => void {
  const { overlay, onDismiss } = opts;
  const priorOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const onOverlayClick = (e: MouseEvent): void => {
    if (e.target === overlay) onDismiss();
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss();
      return;
    }
    if (e.key === 'Enter' && opts.onSubmitEnter && opts.submitWhenActive) {
      const active = document.activeElement as HTMLElement | null;
      if (opts.submitWhenActive(active)) {
        e.preventDefault();
        opts.onSubmitEnter();
      }
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = Array.from(
      overlay.querySelectorAll(opts.focusablesSelector || DEFAULT_FOCUSABLES),
    ) as HTMLElement[];
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !active || !overlay.contains(active)) {
        e.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last || !active || !overlay.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  };

  overlay.addEventListener('click', onOverlayClick);
  document.addEventListener('keydown', onKeydown);

  return () => {
    overlay.removeEventListener('click', onOverlayClick);
    document.removeEventListener('keydown', onKeydown);
    document.body.style.overflow = priorOverflow;
  };
}

export function restoreFocus(target: HTMLElement | null): void {
  if (target && document.body.contains(target)) target.focus();
}

/** Returns lightweight field-access helpers scoped to a dialog overlay element. */
export function makeDialogHelpers(overlay: HTMLElement) {
  const get = (id: string): string =>
    (overlay.querySelector('#' + id) as HTMLInputElement | null)?.value.trim() || '';
  const getChecked = (id: string): boolean =>
    !!(overlay.querySelector('#' + id) as HTMLInputElement | null)?.checked;
  const setErr = (id: string, msg: string): void => {
    const el = overlay.querySelector('#' + id + '-err') as HTMLElement | null;
    const field = overlay.querySelector('#' + id) as HTMLElement | null;
    if (el) el.textContent = msg;
    if (!field) return;
    if (msg) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  };
  return { get, getChecked, setErr };
}

export function createDialogController<Result>(
  defaultResult: Result,
  opts: {
    overlaySelector?: string;
    reset?: () => void;
  } = {},
): DialogController<Result> {
  let activeResolve: ((value: Result) => void) | null = null;
  let activeTrigger: HTMLElement | null = null;
  let activeOverlay: HTMLElement | null = null;
  let activeCleanup: (() => void) | null = null;

  const cleanup = (): void => {
    const overlay =
      activeOverlay ||
      (opts.overlaySelector
        ? (document.querySelector(opts.overlaySelector) as HTMLElement | null)
        : null);
    overlay?.remove();
    activeOverlay = null;
    activeCleanup?.();
    activeCleanup = null;
    opts.reset?.();
    restoreFocus(activeTrigger);
    activeTrigger = null;
  };

  return {
    begin(resolve) {
      this.dismiss(defaultResult);
      activeResolve = resolve;
      activeTrigger = document.activeElement as HTMLElement | null;
    },
    setCleanup(cleanupFn) {
      activeCleanup = cleanupFn;
    },
    setOverlay(overlay) {
      activeOverlay = overlay;
    },
    overlay() {
      return activeOverlay;
    },
    dismiss(result) {
      cleanup();
      const resolve = activeResolve;
      activeResolve = null;
      resolve?.(result);
    },
  };
}

export function focusFirstInvalid(overlay: HTMLElement): void {
  (overlay.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus();
}

export function populateDatalist(
  datalist: Element | null,
  values: readonly string[],
  labelForValue?: (value: string) => string,
): void {
  if (!datalist) return;
  datalist.replaceChildren(
    ...values.map((value) => {
      const opt = document.createElement('option');
      opt.value = value;
      if (labelForValue) opt.label = labelForValue(value);
      return opt;
    }),
  );
}

export function bindColorInputs(
  overlay: HTMLElement,
  colorInputId: string,
  colorHexInputId: string,
): void {
  const colorSwatch = overlay.querySelector('#' + colorInputId) as HTMLInputElement | null;
  const colorHex = overlay.querySelector('#' + colorHexInputId) as HTMLInputElement | null;
  colorSwatch?.addEventListener('input', () => {
    if (colorHex) colorHex.value = colorSwatch.value;
  });
  colorHex?.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(colorHex.value) && colorSwatch) {
      colorSwatch.value = colorHex.value;
    }
  });
}
