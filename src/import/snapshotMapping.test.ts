import { afterEach, describe, expect, it } from 'vitest';
import { snapshotParsers } from './snapshotParsers';
import { fictionalBalanceParser } from '../../tests/fixtures/snapshot-import/balanceParser';
import {
  getSnapshotMapping,
  updateSnapshotMapping,
  validateSnapshotMapping,
  TRADE_REPUBLIC_VALUATION as type,
} from './snapshotMapping';
import type { Account } from '../types';

const accounts: Account[] = [
  { id: 'broker', label: 'Invented broker', moneyType: 'investment', isPrimaryInvestment: true },
  { id: 'cash', label: 'Invented cash', moneyType: 'cash' },
  { id: 'savings', label: 'Invented savings', moneyType: 'savings' },
  { id: 'pension', label: 'Invented pension', moneyType: 'pension' },
];
const combined = { mode: 'combined' as const, securitiesAccount: 'broker' };
afterEach(() => {
  snapshotParsers.splice(1);
});
describe('provider/document mapping preferences', () => {
  it('validates and persists non-investment destinations without requiring a primary investment account', () => {
    snapshotParsers.push(fictionalBalanceParser);
    const mapping = { mode: 'balances' as const, balanceAccounts: { closing: 'savings' } };
    const raw = updateSnapshotMapping('', fictionalBalanceParser.id, mapping, accounts.slice(1));
    expect(getSnapshotMapping(raw, fictionalBalanceParser.id, accounts.slice(1))).toEqual(mapping);
    expect(() =>
      getSnapshotMapping(
        raw,
        fictionalBalanceParser.id,
        accounts.slice(2).map((a) => ({ ...a, moneyType: 'pension' })),
      ),
    ).toThrow('eligible');
    expect(() => validateSnapshotMapping(combined, accounts, fictionalBalanceParser.id)).toThrow(
      'mapping',
    );
    expect(() => validateSnapshotMapping(mapping, accounts, type)).toThrow('mapping');
  });
  it('rejects duplicate targets for separate balance slots', () => {
    snapshotParsers.push({
      ...fictionalBalanceParser,
      mapping: {
        kind: 'balances',
        slots: [
          { key: 'first', label: 'First', moneyTypes: ['savings'] },
          { key: 'second', label: 'Second', moneyTypes: ['savings'] },
        ],
      },
    });
    expect(() =>
      validateSnapshotMapping(
        { mode: 'balances', balanceAccounts: { first: 'savings', second: 'savings' } },
        accounts,
        fictionalBalanceParser.id,
      ),
    ).toThrow('distinct');
  });
  it('roundtrips only mode and internal IDs, ignoring extra document data', () => {
    const withDocumentData = { ...combined, filename: 'never.pdf' };
    const raw = updateSnapshotMapping(undefined, type, withDocumentData, accounts);
    expect(JSON.parse(raw)).toEqual({ version: 1, mappings: { [type]: combined } });
    expect(getSnapshotMapping(raw, type, accounts)).toEqual(combined);
  });
  it('isolates and preserves other providers when updating or resetting one', () => {
    const original = JSON.stringify({
      version: 1,
      mappings: { 'future:valuation': { opaque: 'preserved' } },
    });
    const raw = updateSnapshotMapping(original, type, combined, accounts);
    expect(getSnapshotMapping(raw, type, accounts)).toEqual(combined);
    expect(JSON.parse(updateSnapshotMapping(raw, type, null, accounts))).toEqual(
      JSON.parse(original),
    );
    expect(getSnapshotMapping('', type, accounts)).toBeUndefined();
  });
  it('survives renames but rejects deleted, retyped or no-longer-primary targets', () => {
    const raw = updateSnapshotMapping('', type, combined, accounts);
    expect(
      getSnapshotMapping(
        raw,
        type,
        accounts.map((a) => ({ ...a, label: 'Renamed' })),
      ),
    ).toEqual(combined);
    for (const changed of [
      accounts.slice(1),
      accounts.map((a) => ({ ...a, isPrimaryInvestment: false })),
      accounts.map((a) => ({ ...a, moneyType: 'cash' })),
    ])
      expect(() => getSnapshotMapping(raw, type, changed)).toThrow('primary');
  });
  it('accepts only distinct cash/savings targets for split mapping', () => {
    for (const cashAccount of ['cash', 'savings'])
      expect(
        validateSnapshotMapping({ ...combined, mode: 'split', cashAccount }, accounts).cashAccount,
      ).toBe(cashAccount);
    for (const cashAccount of ['broker', 'pension', 'deleted', undefined])
      expect(() =>
        validateSnapshotMapping({ ...combined, mode: 'split', cashAccount }, accounts),
      ).toThrow('cash or savings');
  });
  it.each(['{', 'null', '[]', '{"version":2,"mappings":{}}', '{"version":1,"mappings":[]}'])(
    'requires explicit recovery of invalid preferences %s',
    (raw) => {
      expect(() => getSnapshotMapping(raw, type, accounts)).toThrow('Settings');
      expect(() => updateSnapshotMapping(raw, type, combined, accounts)).toThrow();
      expect(() => updateSnapshotMapping(raw, type, null, accounts)).toThrow();
    },
  );
});
