import type { Account, Holding, PortfolioData, Settings, Snapshot, Transaction } from './types';

/** Settings that only mirror UI state; they never change what a section shows. */
export const UI_ONLY_SETTINGS: ReadonlySet<string> = new Set(['ui_collapse_state']);

export interface RenderInputs {
  snaps: Snapshot[];
  txs: Transaction[];
  pd: PortfolioData | null;
  importMeta: { last_import?: string };
  accounts: Account[];
  holdings: Holding[];
  settings: Settings;
  readOnly: boolean;
}

/** 53-bit string hash (cyrb53): keeps a short fingerprint instead of the serialized data. */
function hash53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${str.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/** Fingerprint of everything the sections render from; equal values mean an identical repaint. */
export function renderSignature(inputs: RenderInputs): string {
  const settings = Object.keys(inputs.settings)
    .filter((key) => !UI_ONLY_SETTINGS.has(key))
    .sort()
    .map((key) => [key, inputs.settings[key]]);
  return hash53(
    JSON.stringify(
      [
        inputs.snaps,
        inputs.txs,
        inputs.pd,
        inputs.importMeta,
        inputs.accounts,
        inputs.holdings,
        settings,
        inputs.readOnly,
      ],
      // SQLite row ids can be bigint, which JSON.stringify rejects.
      (_key, value: unknown) => (typeof value === 'bigint' ? `${value}n` : value),
    ),
  );
}
