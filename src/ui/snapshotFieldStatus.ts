import type { Snapshot } from '../types';
import { isValidISIN, normalizeISIN } from '../model/isin';
import { esc } from '../utils';
import { positionKey } from '../model/snapshotPositions';

export interface SnapshotFieldStatus {
  kind: 'copied' | 'unchanged' | 'modified' | 'new' | 'missing' | 'imported';
  label: string;
  description: string;
}

export function snapshotStatusBadge(status: SnapshotFieldStatus): string {
  return `<span class="snap-field-status" data-field-status="${status.kind}" title="${esc(`${status.label}: ${status.description}`)}"><span class="sr-only">${status.label}: ${esc(status.description)}</span></span>`;
}

export function trackSnapshotFieldStatus(
  overlay: HTMLElement,
  baseline: Snapshot | undefined,
  copiedFrom: string | undefined,
  currency: (input: HTMLInputElement) => string,
  parse: (value: string) => number,
) {
  const markers = new WeakMap<HTMLInputElement, HTMLElement>();
  const keyFor = (input: HTMLInputElement) => {
    const extra = input.parentElement?.querySelector<HTMLInputElement>('[data-extra-isin]');
    const isin = normalizeISIN(extra?.value || input.dataset.etfIsin || '');
    return (
      input.dataset.accountKey ||
      (input.dataset.positionAccount
        ? isValidISIN(isin)
          ? positionKey(input.dataset.positionAccount, isin)
          : `position:${input.dataset.positionAccount}:${isin}`
        : `etf_${isin}`)
    );
  };
  const statusFor = (input: HTMLInputElement): SnapshotFieldStatus => {
    const raw = input.value.trim();
    const previous = baseline?.[keyFor(input)];
    const hasPrevious = typeof previous === 'number' && Number.isFinite(previous);
    if (!raw)
      return {
        kind: 'missing',
        label: 'Missing',
        description: 'No current value entered. Blank ETF values are omitted, not zero.',
      };
    const value = parse(raw);
    if (!Number.isFinite(value))
      return {
        kind: 'missing',
        label: 'Check value',
        description: 'Enter a valid finite number before saving.',
      };
    const source = copiedFrom ? `the ${copiedFrom} snapshot` : 'the saved snapshot';
    if (input.dataset.pdfCurrency) {
      return {
        kind: 'imported',
        label: 'Updated',
        description:
          'Filled from a statement or edited after import. This field remains in EUR. Check the import details in Review.',
      };
    }
    if (!hasPrevious)
      return {
        kind: 'new',
        label: 'New',
        description: 'No value for this field in the starting snapshot.',
      };
    if (Number.isFinite(value) && value === previous && currency(input) === 'EUR') {
      return copiedFrom
        ? {
            kind: 'copied',
            label: 'Copied',
            description: `Unchanged from ${source}; check this month's valuation.`,
          }
        : { kind: 'unchanged', label: 'Unchanged', description: `Unchanged from ${source}.` };
    }
    return {
      kind: 'modified',
      label: 'Modified',
      description: `Different from ${source} (value or currency).`,
    };
  };
  const inputs = () =>
    overlay.querySelectorAll<HTMLInputElement>('[data-account-key], [data-etf-isin]');
  const refresh = (input?: HTMLInputElement) => {
    const fields = input
      ? input.matches('[data-extra-isin]')
        ? input.parentElement?.querySelectorAll<HTMLInputElement>('[data-etf-isin]') || []
        : input.matches('[data-account-key], [data-etf-isin]')
          ? [input]
          : []
      : inputs();
    for (const field of fields) {
      let marker = markers.get(field);
      if (!marker) {
        marker = document.createElement('span');
        marker.className = 'snap-field-status sr-only';
        marker.id = `${field.id || `snapd-value-${markersCreated++}`}-status`;
        field.parentElement?.append(marker);
        field.setAttribute(
          'aria-describedby',
          [field.getAttribute('aria-describedby'), marker.id].filter(Boolean).join(' '),
        );
        markers.set(field, marker);
      }
      const status = statusFor(field);
      field.dataset.fieldStatus = status.kind;
      field.title = `${status.label}: ${status.description}`;
      marker.dataset.fieldStatus = status.kind;
      marker.textContent = status.label;
      marker.title = status.description;
      marker.setAttribute('aria-label', `${status.label}: ${status.description}`);
    }
  };
  let markersCreated = 0;
  return {
    refresh,
    statuses: () => new Map(Array.from(inputs(), (input) => [keyFor(input), statusFor(input)])),
  };
}
