import type { Account } from '../types';
import {
  validateSnapshotMapping,
  TRADE_REPUBLIC_VALUATION,
  type SnapshotMapping,
} from '../import/snapshotMapping';
import { getSnapshotParser } from '../import/snapshotParsers';
import { esc } from '../utils';

export function snapshotMappingFields(
  accounts: Account[],
  prefix: string,
  mapping?: SnapshotMapping,
  type = TRADE_REPUBLIC_VALUATION,
): string {
  const schema = getSnapshotParser(type).mapping;
  if (schema.kind === 'balances')
    return schema.slots
      .map(
        (slot, index) => `
      <div class="dialog-field">
        <label class="dialog-label" for="${prefix}-balance-${index}">${esc(slot.label)} account</label>
        <select id="${prefix}-balance-${index}" class="form-input dialog-input" data-mapping-balance="${esc(slot.key)}">
          <option value="">Choose account</option>
          ${accounts
            .filter((a) => slot.moneyTypes.includes((a.moneyType || '').toLowerCase()))
            .map((a) => {
              const key = a.id || a.key || '';
              return `<option value="${esc(key)}" ${mapping?.mode === 'balances' && mapping.balanceAccounts[slot.key] === key ? 'selected' : ''}>${esc(a.label)}</option>`;
            })
            .join('')}
        </select>
      </div>`,
      )
      .join('');
  const primary = accounts.find(
    (a) => a.isPrimaryInvestment && a.moneyType?.toLowerCase() === 'investment',
  );
  const key = primary?.id || primary?.key || '';
  return `
    <p class="note">Securities account: <strong>${esc(primary?.label || 'Configure a primary investment account first')}</strong></p>
    <input type="hidden" data-mapping-primary value="${esc(key)}">
    <div class="dialog-field">
      <label class="dialog-label" for="${prefix}-mode">Balance mapping</label>
      <select id="${prefix}-mode" class="form-input dialog-input" data-mapping-mode>
        ${[
          ['combined', 'Combined: securities + cash'],
          ['split', 'Separate securities and cash accounts'],
          ['positions', 'ETF positions only'],
        ]
          .map(
            ([value, label]) =>
              `<option value="${value}" ${value === (mapping?.mode || 'combined') ? 'selected' : ''}>${label}</option>`,
          )
          .join('')}
      </select>
    </div>
    <div class="dialog-field" data-mapping-cash-field ${mapping?.mode === 'split' ? '' : 'hidden'}>
      <label class="dialog-label" for="${prefix}-cash">Cash account</label>
      <select id="${prefix}-cash" class="form-input dialog-input" data-mapping-cash>
        <option value="">Choose cash account</option>
        ${accounts
          .filter(
            (a) =>
              (a.id || a.key) !== key &&
              ['cash', 'savings'].includes((a.moneyType || '').toLowerCase()),
          )
          .map(
            (a) =>
              `<option value="${esc(a.id || a.key || '')}" ${(a.id || a.key) === mapping?.cashAccount ? 'selected' : ''}>${esc(a.label)}</option>`,
          )
          .join('')}
      </select>
    </div>`;
}

export function wireSnapshotMappingFields(root: HTMLElement): void {
  root.querySelector('[data-mapping-mode]')?.addEventListener('change', () => {
    root.querySelector<HTMLElement>('[data-mapping-cash-field]')!.hidden =
      root.querySelector<HTMLSelectElement>('[data-mapping-mode]')!.value !== 'split';
  });
}

export function readSnapshotMappingFields(
  root: HTMLElement,
  accounts: Account[],
  type = TRADE_REPUBLIC_VALUATION,
): SnapshotMapping {
  if (getSnapshotParser(type).mapping.kind === 'balances')
    return validateSnapshotMapping(
      {
        mode: 'balances',
        balanceAccounts: Object.fromEntries(
          Array.from(
            root.querySelectorAll<HTMLSelectElement>('[data-mapping-balance]'),
            (field) => [field.dataset.mappingBalance, field.value],
          ),
        ),
      },
      accounts,
      type,
    );
  return validateSnapshotMapping(
    {
      mode: root.querySelector<HTMLSelectElement>('[data-mapping-mode]')?.value,
      securitiesAccount: root.querySelector<HTMLInputElement>('[data-mapping-primary]')?.value,
      cashAccount: root.querySelector<HTMLSelectElement>('[data-mapping-cash]')?.value,
    },
    accounts,
    type,
  );
}
