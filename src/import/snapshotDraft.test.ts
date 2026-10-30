import { afterEach, describe, expect, it } from 'vitest';
import { proposeMappedStatement, proposeStatement, validateStatementMonth } from './snapshotDraft';
import { snapshotParsers } from './snapshotParsers';
import {
  fictionalBalanceParser,
  fictionalBalanceLines,
} from '../../tests/fixtures/snapshot-import/balanceParser';
import { parseTradeRepublicStatement } from './snapshotTradeRepublic';
import { FAKE_ISINS, syntheticPages } from '../../tests/fixtures/snapshot-import/synthetic';
import type { Account } from '../types';
import { positionKey } from '../model/snapshotPositions';

const accounts: Account[] = [
  { id: 'broker', label: 'Fictional broker', moneyType: 'investment', isPrimaryInvestment: true },
  { id: 'cash', label: 'Fictional cash', moneyType: 'cash' },
];
const statement = parseTradeRepublicStatement(syntheticPages());
afterEach(() => {
  snapshotParsers.splice(1);
});

describe('snapshot statement mapping', () => {
  it('scopes a historical non-primary destination and rejects all closed-month imports, even zero positions', () => {
    const historical: Account[] = [
      ...accounts,
      {
        id: 'old_broker',
        label: 'Former broker',
        moneyType: 'investment',
        closedPeriods: [{ closedFromMonth: '2024-02', reopenedFromMonth: '2024-05' }],
      },
    ];
    const mapping = { mode: 'positions' as const, securitiesAccount: 'old_broker' };
    const proposals = proposeMappedStatement(statement, historical, mapping, true);
    expect(proposals[0]).toMatchObject({
      key: positionKey('old_broker', statement.positions[0].isin),
      accountId: 'old_broker',
      value: statement.positions[0].value,
    });
    expect(() => proposeMappedStatement(statement, historical, mapping)).toThrow('primary');
    expect(() =>
      proposeMappedStatement(
        {
          ...statement,
          date: '2024-03-31',
          positions: statement.positions.map((p) => ({ ...p, value: 0 })),
        },
        historical,
        mapping,
        true,
      ),
    ).toThrow('closed');
  });
  it('maps verified savings balances independently of ETF accounts and rejects missing values', () => {
    snapshotParsers.push(fictionalBalanceParser);
    const statement = fictionalBalanceParser.parse(syntheticPages([fictionalBalanceLines]));
    const mapping = { mode: 'balances' as const, balanceAccounts: { closing: 'cash' } };
    expect(proposeMappedStatement(statement, accounts.slice(1), mapping)).toEqual([
      { key: 'cash', label: 'Closing balance', value: 1234.56 },
    ]);
    expect(() => proposeMappedStatement({ ...statement, balances: {} }, accounts, mapping)).toThrow(
      'unavailable',
    );
  });
  it('maps combined total without counting positions twice', () => {
    const proposed = proposeStatement(statement, accounts, 'combined', 'broker', '');
    expect(proposed[0]).toMatchObject({ key: 'broker', value: 3707.62 });
    expect(proposed).toHaveLength(8);
  });
  it('maps securities and cash separately without overlap', () => {
    expect(
      proposeStatement(statement, accounts, 'split', 'broker', 'cash').slice(0, 2),
    ).toMatchObject([
      { key: 'broker', value: 2831.08 },
      { key: 'cash', value: 876.54 },
    ]);
    expect(() => proposeStatement(statement, accounts, 'split', 'broker', 'broker')).toThrow(
      'separate',
    );
  });
  it('requires explicit primary mapping and preserves reserved account keys', () => {
    expect(() => proposeStatement(statement, accounts, 'combined', '', '')).toThrow('primary');
    expect(() =>
      proposeStatement(
        statement,
        [...accounts, { id: `etf_${FAKE_ISINS[0]}`, label: 'Legacy key' }],
        'positions',
        'broker',
        '',
      ),
    ).toThrow('conflicts');
  });
  it('allows positions only but never invents missing totals', () => {
    const partial = { ...statement, total: undefined, securities: undefined };
    expect(proposeStatement(partial, accounts, 'positions', 'broker', '')).toHaveLength(7);
    expect(() => proposeStatement(partial, accounts, 'combined', 'broker', '')).toThrow(
      'unavailable',
    );
  });
  it.each([
    ['2024-01-31', '2024-01', null],
    ['2024-01-31', '2024-02', 'does not match'],
    ['2024-01-30', '2024-01', 'month-end'],
    ['2024-02-29', '2024-02', null],
    ['2023-02-29', '2023-02', 'month-end'],
    ['2024-13-31', '2024-13', 'month-end'],
    ['2026-10-31', '2026-10', 'completed'],
  ])('validates source %s against month %s', (date, month, error) => {
    const result = validateStatementMonth(date, month, '2026-10');
    if (error) expect(result).toContain(error);
    else expect(result).toBeNull();
  });
});
