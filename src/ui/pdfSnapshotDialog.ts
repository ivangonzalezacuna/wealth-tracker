import type { Account, Snapshot } from '../types';
import { esc, fmtEur2 } from '../utils';
import { mergeStatement, PDF_ERROR, type Statement } from '../import/pdfStatement';
import { readStatement } from '../import/readPdf';
import { createDialogController, openDialogShell } from './modalShell';

export interface PdfSnapshotOptions {
  accounts: Account[];
  knownIsins: string[];
  snapshots: Snapshot[];
}

let abortActive = () => {};
const dialog = createDialogController<Snapshot | null>(null, {
  reset: () => {
    abortActive();
    abortActive = () => {};
  },
});

export function pdfSnapshotDialog(opts: PdfSnapshotOptions): Promise<Snapshot | null> {
  return new Promise((resolve) => {
    dialog.begin(resolve);
    let controller = new AbortController();
    let generation = 0;
    let statement: Statement | undefined;
    let preview: Snapshot | undefined;
    let closed = false;
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay pdf-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pdf-title');
    const options = (accounts: Account[]) =>
      '<option value="">Select an account</option>' +
      accounts.map((a) => `<option value="${esc(a.id || '')}">${esc(a.label)}</option>`).join('');
    overlay.innerHTML = `<div class="dialog-card snap-dialog-card">
      <div class="dialog-header"><h2 id="pdf-title" class="dialog-title">PDF-assisted snapshot</h2></div>
      <div class="dialog-fields">
        <p class="note">Conservative prototype for German Trade Republic EUR Vermögensübersicht. Support is based on a screenshot, not validated against a real statement PDF. N26, scans, encrypted PDFs and unsupported glyphs/layouts are not supported. Manual entry remains available.</p>
        <p class="note">The PDF and extracted text stay transiently on this device. No document-derived data is sent over the network during extraction. Only the balances you confirm are saved and synced to Drive through the existing snapshot flow.</p>
        <label class="dialog-label" for="pdf-file">Statement PDF (maximum 10 MB)</label>
        <input id="pdf-file" type="file" accept="application/pdf,.pdf" class="form-input">
        <label class="dialog-label" for="pdf-cash">Cash → existing EUR cash account</label>
        <select id="pdf-cash" class="form-input">${options(opts.accounts.filter((a) => (a.currency || 'EUR') === 'EUR' && a.moneyType?.toLowerCase() === 'cash'))}</select>
        <label class="dialog-label" for="pdf-investment">Brokerage → existing EUR primary investment account</label>
        <select id="pdf-investment" class="form-input">${options(opts.accounts.filter((a) => (a.currency || 'EUR') === 'EUR' && a.isPrimaryInvestment && a.moneyType?.toLowerCase() === 'investment'))}</select>
        <div id="pdf-unknown"></div>
        <p id="pdf-status" role="status" aria-live="polite"></p>
        <div id="pdf-preview"></div>
      </div>
      <div class="dialog-actions">
        <button class="btn btn-sm btn-ghost" id="pdf-cancel">Cancel</button>
        <button class="btn btn-sm btn-primary" id="pdf-review" disabled>Review changes</button>
        <button class="btn btn-sm btn-primary" id="pdf-confirm" disabled>Confirm and save snapshot</button>
      </div></div>`;
    const input = overlay.querySelector<HTMLInputElement>('#pdf-file')!;
    const cash = overlay.querySelector<HTMLSelectElement>('#pdf-cash')!;
    const investment = overlay.querySelector<HTMLSelectElement>('#pdf-investment')!;
    const review = overlay.querySelector<HTMLButtonElement>('#pdf-review')!;
    const confirm = overlay.querySelector<HTMLButtonElement>('#pdf-confirm')!;
    const status = overlay.querySelector<HTMLElement>('#pdf-status')!;
    const previewEl = overlay.querySelector<HTMLElement>('#pdf-preview')!;
    const unknownEl = overlay.querySelector<HTMLElement>('#pdf-unknown')!;
    const invalidate = () => {
      preview = undefined;
      confirm.disabled = true;
      previewEl.replaceChildren();
    };
    const dismiss = (result: Snapshot | null) => {
      closed = true;
      generation++;
      controller.abort();
      input.value = '';
      statement = undefined;
      preview = undefined;
      dialog.dismiss(result);
    };
    abortActive = () => {
      closed = true;
      generation++;
      controller.abort();
    };
    openDialogShell(dialog, {
      overlay,
      onDismiss: () => dismiss(null),
      onCancel: () => dismiss(null),
      cancelSelector: '#pdf-cancel',
      initialFocusSelector: '#pdf-file',
    });
    overlay.addEventListener('change', (e) => {
      if (e.target !== input) invalidate();
    });
    input.addEventListener('change', async () => {
      generation++;
      const request = generation;
      controller.abort();
      controller = new AbortController();
      invalidate();
      statement = undefined;
      review.disabled = true;
      unknownEl.replaceChildren();
      const file = input.files?.[0];
      if (!file) {
        status.textContent = '';
        return;
      }
      status.textContent = 'Reading locally…';
      try {
        const parsed = await readStatement(file, controller.signal);
        if (closed || request !== generation || !overlay.isConnected) return;
        statement = parsed;
        status.textContent = `Valuation date ${parsed.valuationDate}. Cash ${fmtEur2(parsed.cash)}; brokerage ${fmtEur2(parsed.brokerage)}; total ${fmtEur2(parsed.total)}.`;
        const unknown = parsed.holdings.filter((h) => !opts.knownIsins.includes(h.isin));
        if (unknown.length) {
          const warning = document.createElement('p');
          warning.textContent =
            'Unknown securities: configure them in Settings and reopen, or explicitly exclude each breakdown value. Their market values remain included in the brokerage balance.';
          unknownEl.appendChild(warning);
          for (const h of unknown) {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.exclude = h.isin;
            label.append(checkbox, ` Exclude ${h.isin} (${fmtEur2(h.value)}) from ETF breakdown`);
            unknownEl.append(label, document.createElement('br'));
          }
        }
        review.disabled = false;
      } catch {
        if (!closed && request === generation) status.textContent = PDF_ERROR;
      } finally {
        if (request === generation) input.value = '';
      }
    });
    review.addEventListener('click', () => {
      invalidate();
      if (!statement) return;
      try {
        const existing = opts.snapshots.find(
          (s) => s.date === statement!.valuationDate.slice(0, 7),
        );
        const excluded = Array.from(
          unknownEl.querySelectorAll<HTMLInputElement>('input:checked'),
        ).map((e) => e.dataset.exclude!);
        preview = mergeStatement(
          statement,
          opts.accounts,
          opts.knownIsins,
          cash.value,
          investment.value,
          excluded,
          existing,
        );
        const title = document.createElement('p');
        title.textContent = `Review ${preview.date}: ${existing ? 'merge into existing month' : 'new partial snapshot'}. No unrelated missing accounts are set to zero. User notes are preserved. Primary investment ETF breakdown is replaced; stale values are removed.`;
        previewEl.appendChild(title);
        const keys = new Set([...Object.keys(existing || {}), ...Object.keys(preview)]);
        for (const key of keys) {
          if (key === 'date' || key === 'notes') continue;
          const old = existing?.[key];
          const value = preview[key];
          if (typeof old !== 'number' && typeof value !== 'number') continue;
          const account = opts.accounts.find((a) => a.id === key);
          const label =
            account?.label ||
            (key.startsWith('etf_') ? key.slice(4) : 'Unrecognized numeric field');
          const p = document.createElement('p');
          p.textContent = `${label}: ${old ?? 'not recorded'} → ${value ?? 'removed'}${old === value ? ' (unchanged)' : ''}${account && (account.currency || 'EUR') !== 'EUR' ? ' (existing stored value, no FX conversion)' : ' EUR'}`;
          previewEl.appendChild(p);
        }
        confirm.disabled = false;
      } catch (error) {
        status.textContent = (error as Error).message;
      }
    });
    confirm.addEventListener('click', () => {
      if (preview && !confirm.disabled) dismiss(preview);
    });
  });
}
