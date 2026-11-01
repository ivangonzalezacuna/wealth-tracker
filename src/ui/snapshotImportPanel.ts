import { extractSnapshotPdf } from '../import/snapshotPdf';
import {
  proposeMappedStatement,
  validateStatementMonth,
  type SnapshotProposal,
} from '../import/snapshotDraft';
import type { SnapshotStatement } from '../import/snapshotStatement';
import { getSnapshotParser } from '../import/snapshotParsers';
import { validateSnapshotMapping, type SnapshotMapping } from '../import/snapshotMapping';
import {
  snapshotMappingFields,
  readSnapshotMappingFields,
  wireSnapshotMappingFields,
} from './snapshotMappingFields';
import { currentMonth, fmtEur2 } from '../utils';
import type { Account } from '../types';

export interface SnapshotImportHost {
  scopedValuations?: boolean;
  accounts(): Account[];
  month(): string;
  selectMonth(month: string): void;
  mapping(type: string): SnapshotMapping | undefined;
  saveMapping(type: string, mapping: SnapshotMapping): Promise<void>;
  apply(values: SnapshotProposal[], statement: SnapshotStatement, mapping: SnapshotMapping): void;
  undo(): string;
  busy(value: boolean): void;
}

export function mountSnapshotImport(panel: HTMLElement, host: SnapshotImportHost): () => void {
  let controller: AbortController | undefined;
  let statement: SnapshotStatement | undefined;
  let sequence = 0;
  let disposed = false;
  let applied = false;
  let saving = false;
  panel.innerHTML = `
    <div class="snap-pdf-panel">
      <div class="form-actions">
        <button type="button" class="btn btn-sm btn-outline snap-pdf-choose">Choose statement PDF</button>
        <input id="snapd-pdf-file" type="file" accept=".pdf,application/pdf" hidden aria-label="Statement PDF">
        <button type="button" class="btn btn-sm btn-ghost snap-pdf-cancel" hidden>Cancel import</button>
        <button type="button" class="btn btn-sm btn-ghost snap-pdf-undo" hidden>Undo import</button>
        <button type="button" class="btn btn-sm btn-ghost snap-pdf-change" hidden>Change mapping</button>
      </div>
      <p class="note">Local PDF import · Supported statement reports · Review before saving.</p>
      <p class="note snap-pdf-status" role="status" aria-live="polite"></p>
      <p class="snap-pdf-source note"></p>
      <div class="snap-pdf-error dialog-error" role="alert"></div>
      <button type="button" class="btn btn-sm btn-outline snap-pdf-month" hidden>Select document month</button>
      <div class="snap-pdf-setup" hidden>
        <div class="section-label">Where should these balances go?</div>
        <div class="snap-pdf-mapping-fields"></div>
        <p class="note">Remembered in Settings → Integrations, including backups and sync. Only account mapping preferences are saved, not this snapshot or document.</p>
        <button type="button" class="btn btn-sm btn-primary snap-pdf-save">Save mapping and fill draft</button>
      </div>
    </div>`;
  const get = <T extends HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const file = get<HTMLInputElement>('#snapd-pdf-file');
  const status = get('.snap-pdf-status');
  const error = get('.snap-pdf-error');
  const setup = get('.snap-pdf-setup');
  const fields = get('.snap-pdf-mapping-fields');
  const cancel = get<HTMLButtonElement>('.snap-pdf-cancel');
  const undo = get<HTMLButtonElement>('.snap-pdf-undo');
  const change = get<HTMLButtonElement>('.snap-pdf-change');
  const month = get<HTMLButtonElement>('.snap-pdf-month');
  const save = get<HTMLButtonElement>('.snap-pdf-save');
  const choose = get<HTMLButtonElement>('.snap-pdf-choose');
  const setBusy = (busy: boolean) => {
    host.busy(busy);
    choose.disabled = saving;
    save.disabled = saving;
    undo.disabled = saving;
    change.disabled = saving;
    month.disabled = saving;
    fields.querySelectorAll<HTMLSelectElement>('select').forEach((field) => {
      field.disabled = saving;
    });
  };
  const showSetup = (mapping?: SnapshotMapping) => {
    if (!statement) return;
    fields.innerHTML = snapshotMappingFields(
      host.accounts(),
      'snapd-pdf',
      mapping,
      statement.documentType,
      statement.date.slice(0, 7),
      host.scopedValuations,
    );
    wireSnapshotMappingFields(fields);
    setup.hidden = false;
  };
  const fill = (mapping: SnapshotMapping) => {
    if (!statement || applied) return;
    mapping = validateSnapshotMapping(
      mapping,
      host.accounts(),
      statement.documentType,
      statement.date.slice(0, 7),
    );
    const issue = validateStatementMonth(statement.date, host.month(), currentMonth());
    month.hidden = !issue;
    if (issue) {
      error.textContent = issue;
      return;
    }
    const investment = getSnapshotParser(statement.documentType).mapping.kind === 'investment';
    const partial =
      investment &&
      (statement.securities === undefined ||
        statement.cash === undefined ||
        statement.total === undefined);
    const values = proposeMappedStatement(
      statement,
      host.accounts(),
      mapping,
      host.scopedValuations,
    );
    host.apply(values, statement, mapping);
    applied = true;
    setup.hidden = true;
    cancel.hidden = true;
    undo.hidden = false;
    change.hidden = false;
    error.textContent = '';
    status.textContent = `${investment ? `${statement.positions.length} ETF values` : `${values.length} account balances`} filled automatically. ${partial ? 'Incomplete statement: account balances were kept, not verified. Complete them manually.' : mapping.mode === 'positions' ? 'Account balances kept; complete them manually.' : 'Mapped balances filled.'} Nothing saved; continue with Review.`;
  };
  const resolveMapping = () => {
    if (!statement) return;
    let mapping: SnapshotMapping | undefined;
    try {
      const saved = host.mapping(statement.documentType);
      mapping = saved
        ? validateSnapshotMapping(
            saved,
            host.accounts(),
            statement.documentType,
            statement.date.slice(0, 7),
          )
        : undefined;
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : 'Mapping needs repair.';
      showSetup();
      return;
    }
    if (!mapping) {
      showSetup();
      return;
    }
    try {
      fill(mapping);
    } catch (reason) {
      error.textContent =
        reason instanceof Error ? reason.message : 'The draft could not be filled.';
      status.textContent = 'No values filled. Check the mapping or use manual entry.';
      showSetup(mapping);
    }
  };
  const stop = () => {
    sequence++;
    controller?.abort();
    controller = undefined;
    cancel.hidden = true;
    setBusy(false);
  };
  choose.addEventListener('click', () => file.click());
  cancel.addEventListener('click', () => {
    stop();
    statement = undefined;
    setup.hidden = true;
    change.hidden = true;
    month.hidden = true;
    status.textContent = 'Import cancelled. Existing form values are unchanged.';
    get('.snap-pdf-source').textContent = '';
    error.textContent = '';
    choose.focus();
  });
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    file.value = '';
    if (!selected) return;
    stop();
    statement = undefined;
    applied = false;
    setup.hidden = true;
    month.hidden = true;
    change.hidden = true;
    error.textContent = '';
    get('.snap-pdf-source').textContent = '';
    controller = new AbortController();
    const request = sequence;
    setBusy(true);
    status.textContent = 'Reading PDF locally...';
    cancel.hidden = false;
    void extractSnapshotPdf(selected, controller.signal)
      .then((result) => {
        if (disposed || request !== sequence) return;
        statement = result;
        get('.snap-pdf-source').textContent =
          `${getSnapshotParser(result.documentType).label} · ${result.date}${getSnapshotParser(result.documentType).mapping.kind === 'investment' ? ` · securities ${result.securities === undefined ? 'unverified' : fmtEur2(result.securities)} · cash ${result.cash === undefined ? 'unverified' : fmtEur2(result.cash)}` : ''}. ${result.warnings.join(' ')}`;
        status.textContent =
          getSnapshotParser(result.documentType).mapping.kind === 'investment'
            ? `${result.positions.length} ETF positions recognized.`
            : `${Object.keys(result.balances || {}).length} account balances recognized.`;
        change.hidden = false;
        const issue = validateStatementMonth(result.date, host.month(), currentMonth());
        if (issue) {
          error.textContent = issue;
          month.hidden = false;
          return;
        }
        resolveMapping();
      })
      .catch((reason: unknown) => {
        if (disposed || request !== sequence) return;
        status.textContent = 'No values filled. Manual entry remains available.';
        error.textContent =
          reason instanceof Error ? reason.message : 'Unknown or unreadable statement.';
        cancel.hidden = true;
      })
      .finally(() => {
        if (!disposed && request === sequence) setBusy(false);
      });
  });
  month.addEventListener('click', () => {
    if (!statement) return;
    host.selectMonth(statement.date.slice(0, 7));
    resolveMapping();
  });
  change.addEventListener('click', () => {
    if (!statement || saving) return;
    try {
      showSetup(host.mapping(statement.documentType));
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : 'Mapping needs repair.';
      showSetup();
    }
  });
  save.addEventListener('click', () => {
    if (!statement || saving) return;
    const current = statement;
    const issue = validateStatementMonth(current.date, host.month(), currentMonth());
    if (issue) {
      error.textContent = issue;
      month.hidden = false;
      return;
    }
    const request = sequence;
    let mapping: SnapshotMapping;
    try {
      mapping = readSnapshotMappingFields(
        fields,
        host.accounts(),
        current.documentType,
        current.date.slice(0, 7),
      );
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : 'Invalid mapping.';
      return;
    }
    saving = true;
    setBusy(true);
    let persisted = false;
    void host
      .saveMapping(current.documentType, mapping)
      .then(() => {
        persisted = true;
        if (disposed || request !== sequence) return;
        if (applied) host.undo();
        applied = false;
        fill(mapping);
      })
      .catch((reason: unknown) => {
        if (!disposed && request === sequence)
          error.textContent = `${persisted ? 'Mapping saved, but draft could not be filled' : 'Mapping was not saved'}: ${reason instanceof Error ? reason.message : 'retry in Settings'}`;
      })
      .finally(() => {
        saving = false;
        if (!disposed) setBusy(false);
      });
  });
  undo.addEventListener('click', () => {
    if (saving) return;
    stop();
    status.textContent = host.undo();
    undo.hidden = true;
    applied = false;
    statement = undefined;
    change.hidden = true;
    setup.hidden = true;
    month.hidden = true;
    error.textContent = '';
    get('.snap-pdf-source').textContent = '';
  });
  return () => {
    disposed = true;
    stop();
    statement = undefined;
  };
}
