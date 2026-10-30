import type { SnapshotProposal } from '../import/snapshotDraft';
import type { SnapshotStatement } from '../import/snapshotStatement';
import { getSnapshotParser } from '../import/snapshotParsers';
import type { SnapshotMapping } from '../import/snapshotMapping';
import { isValidISIN, normalizeISIN } from '../model/isin';
import { esc } from '../utils';
import { positionKey } from '../model/snapshotPositions';

export interface ImportedField {
  name: string;
  before: string;
  beforeCurrency: string;
  value: number;
}
export interface ImportReview {
  label: string;
  date: string;
  destination: string;
  warnings: string[];
  fields: Map<string, ImportedField>;
}
export const importReviews = new WeakMap<HTMLElement, ImportReview>();

export function createSnapshotImportDraft(
  overlay: HTMLElement,
  primaryKey: string | undefined,
  currency: (input: HTMLInputElement) => string,
  refresh: () => void,
  renderRow: (isin: string, accountId?: string) => HTMLElement,
  accountLabel: (key: string) => string,
) {
  interface UndoField {
    input: HTMLInputElement;
    before: string;
    currency?: string;
    date?: string;
    created: boolean;
    applied: string;
    isin: string;
    oldDescription: string | null;
  }
  let undoFields: UndoField[] = [];
  let undoCoverage: { field: HTMLSelectElement; before: string } | undefined;
  let previousReview: ImportReview | undefined;
  const indexInputs = () =>
    new Map(
      Array.from(
        overlay.querySelectorAll<HTMLInputElement>('[data-account-key], [data-etf-isin]'),
      ).map((input) => {
        const extra = input.parentElement?.querySelector<HTMLInputElement>('[data-extra-isin]');
        const isin = normalizeISIN(extra?.value || input.dataset.etfIsin || '');
        return [
          input.dataset.accountKey ||
            (input.dataset.positionAccount
              ? isValidISIN(isin)
                ? positionKey(input.dataset.positionAccount, isin)
                : `position:${input.dataset.positionAccount}:${isin}`
              : `etf_${isin}`),
          input,
        ];
      }),
    );
  return {
    apply(
      values: SnapshotProposal[],
      statement: SnapshotStatement,
      mapping: SnapshotMapping,
    ): void {
      const inputs = indexInputs();
      for (const value of values) {
        if (
          !inputs.has(value.key) &&
          (!value.isin ||
            !(value.accountId || primaryKey) ||
            !overlay.querySelector(
              `.js-snapd-extra[data-acct-key="${value.accountId || primaryKey}"]`,
            ))
        )
          throw new Error('The mapped account is no longer available.');
      }
      previousReview = importReviews.get(overlay);
      undoFields = [];
      undoCoverage = undefined;
      if (mapping.mode !== 'balances') {
        const coverage = overlay.querySelector<HTMLSelectElement>(
          `[data-coverage-account="${mapping.securitiesAccount}"]`,
        );
        if (coverage) {
          undoCoverage = { field: coverage, before: coverage.value };
          coverage.value = '0';
        }
      }
      const review: ImportReview = {
        label: getSnapshotParser(statement.documentType).label,
        date: statement.date,
        destination:
          mapping.mode === 'balances'
            ? Object.values(mapping.balanceAccounts).map(accountLabel).join(' + ')
            : `${mapping.mode} · ${accountLabel(mapping.securitiesAccount)}${mapping.cashAccount ? ` + ${accountLabel(mapping.cashAccount)}` : ''}`,
        warnings: [...statement.warnings],
        fields: new Map(previousReview?.fields),
      };
      if (
        getSnapshotParser(statement.documentType).mapping.kind === 'investment' &&
        (statement.total === undefined || mapping.mode === 'positions')
      )
        review.warnings.push(
          'Account balances were retained, not verified by this statement. Check or complete them manually.',
        );
      if (mapping.mode !== 'balances' && undoCoverage)
        review.warnings.push(
          'Untouched ETF positions were retained, not verified by this statement. Breakdown coverage is partial until explicitly reviewed.',
        );
      const additions = new Map<string, DocumentFragment>();
      for (const value of values) {
        let input = inputs.get(value.key);
        let created = false;
        if (!input && value.isin && (value.accountId || primaryKey)) {
          const row = renderRow(value.isin, value.accountId);
          const accountId = (value.accountId || primaryKey)!;
          let fragment = additions.get(accountId);
          if (!fragment) {
            fragment = document.createDocumentFragment();
            additions.set(accountId, fragment);
          }
          fragment.append(row);
          input = row.querySelector<HTMLInputElement>('[data-etf-isin]')!;
          inputs.set(value.key, input);
          created = true;
        }
        if (!input) throw new Error('The mapped field is unavailable.');
        undoFields.push({
          input,
          before: input.value,
          currency: input.dataset.pdfCurrency,
          date: input.dataset.pdfDate,
          created,
          applied: String(value.value),
          isin: value.isin || '',
          oldDescription: input.getAttribute('aria-description'),
        });
        const prior = previousReview?.fields.get(value.key);
        review.fields.set(value.key, {
          name: value.label,
          before: prior?.before ?? input.value,
          beforeCurrency: prior?.beforeCurrency ?? currency(input),
          value: value.value,
        });
        input.value = String(value.value);
        input.dataset.pdfCurrency = 'EUR';
        input.dataset.pdfDate = statement.date;
        input.setAttribute(
          'aria-description',
          `Imported EUR value as of ${statement.date}. This field remains explicitly EUR.`,
        );
      }
      for (const [accountId, fragment] of additions)
        overlay.querySelector(`.js-snapd-extra[data-acct-key="${accountId}"]`)!.before(fragment);
      importReviews.set(overlay, review);
      refresh();
    },
    undo(): string {
      let kept = 0;
      for (const field of undoFields) {
        const extra =
          field.input.parentElement?.querySelector<HTMLInputElement>('[data-extra-isin]');
        if (
          !field.input.isConnected ||
          field.input.value !== field.applied ||
          (extra && normalizeISIN(extra.value) !== field.isin)
        ) {
          kept++;
          continue;
        }
        if (field.created) field.input.closest('.snap-etf-extra')?.remove();
        else {
          field.input.value = field.before;
          if (field.currency) field.input.dataset.pdfCurrency = field.currency;
          else delete field.input.dataset.pdfCurrency;
          if (field.date) field.input.dataset.pdfDate = field.date;
          else delete field.input.dataset.pdfDate;
          if (field.oldDescription)
            field.input.setAttribute('aria-description', field.oldDescription);
          else field.input.removeAttribute('aria-description');
        }
      }
      if (previousReview) importReviews.set(overlay, previousReview);
      else importReviews.delete(overlay);
      if (!kept && undoCoverage?.field.value === '0')
        undoCoverage.field.value = undoCoverage.before;
      undoCoverage = undefined;
      undoFields = [];
      refresh();
      return `Import undone.${kept ? ` ${kept} later edited or removed fields were kept.` : ''} Nothing saved.`;
    },
  };
}

export function importReviewSummary(review: ImportReview, retained: number): string {
  const added = [...review.fields.values()].filter((field) => !field.before.trim()).length;
  return `<div class="snapd-review-summary" role="status">
    <strong>${esc(review.label)} · ${esc(review.date)}</strong>
    <p class="note">${esc(review.destination)} · ${review.fields.size} imported fields (${added} added, ${review.fields.size - added} replaced) · ${retained} retained fields (not verified by this statement).</p>
    ${review.warnings.map((warning) => `<p class="snapd-review-warning">${esc(warning)}</p>`).join('')}
  </div>`;
}
