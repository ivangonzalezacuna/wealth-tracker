export type ToastVariant = 'success' | 'error' | 'info';

let host: HTMLElement | null = null;

function ensureHost(): HTMLElement {
  if (host?.isConnected) return host;
  host = document.createElement('section');
  host.className = 'toast-host';
  document.body.appendChild(host);
  return host;
}

export function notify(
  message: string,
  { variant = 'info', source }: { variant?: ToastVariant; source?: string } = {},
): void {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.dataset.variant = variant;
  if (source) toast.dataset.source = source;
  toast.setAttribute('role', variant === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', variant === 'error' ? 'assertive' : 'polite');
  toast.setAttribute('aria-atomic', 'true');

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-ghost btn-sm toast-close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.textContent = '\u2715';

  let timer: ReturnType<typeof setTimeout>;
  const dismiss = () => {
    clearTimeout(timer);
    toast.remove();
  };
  close.addEventListener('click', dismiss);
  toast.append(text, close);
  ensureHost().appendChild(toast);
  timer = setTimeout(dismiss, variant === 'error' ? 8000 : 5000);
}
