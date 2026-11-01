import type { Account } from '../../types';
import { atomicFinancialWrite } from '../connection';
import {
  ACCOUNT_INSERT,
  accountValues,
  readFinancialData,
  validateSettingsChange,
} from '../accountData';

export async function saveAccountConfiguration(
  accounts: Account[],
  settingsPatch: Record<string, string>,
): Promise<void> {
  await atomicFinancialWrite((db) => {
    const previous = readFinancialData(db);
    validateSettingsChange({ ...previous, accounts }, { ...previous.settings, ...settingsPatch });
    for (const old of previous.accounts) {
      if (accounts.some((a) => (a.id || a.key) === (old.id || old.key))) continue;
      const id = old.id || old.key || '';
      const aliases = new Set([id, old.key].filter(Boolean).map((key) => key!.toLowerCase()));
      if (
        old.closedPeriods?.length ||
        previous.snapshots.some((s) =>
          Object.entries(s).some(
            ([key, value]) =>
              (aliases.has(key.toLowerCase()) || key.startsWith(`position:${id}:`)) && value !== 0,
          ),
        )
      )
        throw new Error(
          `${old.label}: accounts with financial history cannot be removed. Close the account instead.`,
        );
    }
    db.run('DELETE FROM accounts');
    const stmt = db.prepare(ACCOUNT_INSERT);
    try {
      for (const account of accounts) stmt.run(accountValues(account));
    } finally {
      stmt.free();
    }
    for (const [key, value] of Object.entries(settingsPatch))
      db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
    db.run('INSERT INTO config_history (timestamp, source, entity, summary) VALUES (?, ?, ?, ?)', [
      new Date().toISOString(),
      'web',
      'Accounts',
      'Saved account lifecycle and contribution routing',
    ]);
  });
}
