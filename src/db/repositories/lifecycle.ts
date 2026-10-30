import type { Account, Snapshot } from '../../types';
import { atomicFinancialWrite } from '../connection';
import {
  ACCOUNT_INSERT,
  accountValues,
  readFinancialData,
  validateSettingsChange,
} from '../accountData';
import {
  migratePositionSnapshots,
  valuationMigrationFingerprint,
  type LegacyPositionAssignment,
  type LegacyCoverageReview,
} from '../../model/valuationMigration';
import { ETF_VALUATION_SCHEMA } from '../../model/snapshotPositions';

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

export async function convertEtfValuations(
  assignments: LegacyPositionAssignment[],
  expectedFingerprint: string,
  coverage: LegacyCoverageReview[] = [],
): Promise<Snapshot[]> {
  let converted: Snapshot[] = [];
  await atomicFinancialWrite((db) => {
    const { accounts, snapshots, settings } = readFinancialData(db);
    if (settings.etf_valuation_schema === ETF_VALUATION_SCHEMA)
      throw new Error('ETF valuations are already account-linked. Reload before continuing.');
    if (valuationMigrationFingerprint(accounts, snapshots) !== expectedFingerprint)
      throw new Error('Accounts or snapshots changed since Review. Review the migration again.');
    converted = migratePositionSnapshots(snapshots, accounts, assignments, coverage);
    for (const snap of converted) {
      const { date, notes, ...values } = snap;
      db.run('UPDATE snapshots SET values_json = ? WHERE date = ?', [JSON.stringify(values), date]);
    }
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('etf_valuation_schema', ?)", [
      ETF_VALUATION_SCHEMA,
    ]);
    db.run('INSERT INTO config_history (timestamp, source, entity, summary) VALUES (?, ?, ?, ?)', [
      new Date().toISOString(),
      'web',
      'ETF valuations',
      `Assigned ETF valuations in ${converted.length} snapshots to accounts; ${coverage.length} account/month coverage decisions reviewed`,
    ]);
  });
  return converted;
}

export async function reviewEtfCoverage(
  coverage: LegacyCoverageReview[],
  expectedFingerprint: string,
): Promise<Snapshot[]> {
  let reviewed: Snapshot[] = [];
  await atomicFinancialWrite((db) => {
    const { accounts, snapshots, settings } = readFinancialData(db);
    if (settings.etf_valuation_schema !== ETF_VALUATION_SCHEMA)
      throw new Error('Enable account-linked ETF values before reviewing completeness.');
    if (valuationMigrationFingerprint(accounts, snapshots) !== expectedFingerprint)
      throw new Error('Accounts or snapshots changed since Review. Review completeness again.');
    reviewed = migratePositionSnapshots(snapshots, accounts, [], coverage);
    for (const { date, notes, ...values } of reviewed)
      db.run('UPDATE snapshots SET values_json = ? WHERE date = ?', [JSON.stringify(values), date]);
    db.run('INSERT INTO config_history (timestamp, source, entity, summary) VALUES (?, ?, ?, ?)', [
      new Date().toISOString(),
      'web',
      'ETF valuations',
      `Reviewed ${coverage.length} account/month completeness decisions; amounts unchanged`,
    ]);
  });
  return reviewed;
}
