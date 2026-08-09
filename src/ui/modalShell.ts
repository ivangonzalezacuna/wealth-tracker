export interface ModalShellOptions {
  overlay: HTMLElement;
  onDismiss: () => void;
  onSubmitEnter?: () => void;
  submitWhenActive?: (active: HTMLElement | null) => boolean;
  focusablesSelector?: string;
}

const DEFAULT_FOCUSABLES =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])';

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
