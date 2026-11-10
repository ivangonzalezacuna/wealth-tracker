interface OverlayEntry {
  dismiss: () => void;
  active: boolean;
}
const entries: OverlayEntry[] = [];
let consuming = false;
let traversalFocus: HTMLElement | null = null;
let routeURL = location.href;
let routeState: unknown = history.state;
export function replaceRoute(url: string): void {
  history.replaceState(history.state, '', url);
  routeURL = location.href;
  routeState = history.state;
}
const waiting: OverlayEntry[] = [];
const settled: (() => void)[] = [];
export function whenOverlayHistorySettled(): Promise<void> {
  return consuming ? new Promise((resolve) => settled.push(resolve)) : Promise.resolve();
}
const notify = () => window.dispatchEvent(new Event('overlaychange'));

function push(entry: OverlayEntry): void {
  entries.push(entry);
  routeURL = location.href;
  routeState = history.state;
  history.pushState(routeState, '', routeURL);
}
function reconcile(): void {
  if (consuming) return;
  if (entries.length && !entries.at(-1)!.active) {
    entries.pop();
    consuming = true;
    queueMicrotask(() => {
      routeURL = location.href;
      routeState = history.state;
      traversalFocus = document.activeElement as HTMLElement | null;
      history.back();
    });
    return;
  }
  for (const entry of waiting.splice(0)) if (entry.active) push(entry);
  for (const resolve of settled.splice(0)) resolve();
}

document.addEventListener('focusin', (event) => {
  if (consuming) traversalFocus = event.target as HTMLElement;
});

window.addEventListener('popstate', () => {
  const consumed = consuming;
  if (consumed) {
    if (location.href !== routeURL) history.replaceState(routeState, '', routeURL);
  } else {
    const top = entries.at(-1);
    if (!top) return;
    // Restore before dismissal: an unsaved editor can synchronously open a confirmation.
    history.pushState(routeState, '', routeURL);
    top.dismiss();
  }
  const focused = consumed ? traversalFocus : (document.activeElement as HTMLElement | null);
  // Browsers reset focus around popstate; finish reconciliation after native traversal.
  setTimeout(() => {
    if (typeof document === 'undefined') return;
    if (
      document.activeElement === document.body &&
      focused?.isConnected &&
      !focused.closest('[hidden]')
    ) {
      focused.focus({ preventScroll: true });
    }
    if (consumed) {
      consuming = false;
      reconcile();
    }
  }, 0);
});

export function trackOverlay(dismiss: () => void): () => void {
  const entry = { dismiss, active: true };
  if (consuming) waiting.push(entry);
  else push(entry);
  notify();
  return () => {
    if (!entry.active) return;
    entry.active = false;
    reconcile();
    notify();
  };
}
