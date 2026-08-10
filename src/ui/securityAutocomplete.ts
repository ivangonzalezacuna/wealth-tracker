import type { SecuritySuggestionPair } from '../model/securitySuggestions';
import { populateDatalist } from './modalShell';

export interface SecurityAutocompleteOptions {
  overlay: HTMLElement;
  pairs: SecuritySuggestionPair[];
  isinInputId: string;
  isinListId: string;
  nameInputId: string;
  nameListId: string;
}

export function attachSecurityAutocomplete(opts: SecurityAutocompleteOptions): void {
  const isinInput = opts.overlay.querySelector('#' + opts.isinInputId) as HTMLInputElement | null;
  const nameInput = opts.overlay.querySelector('#' + opts.nameInputId) as HTMLInputElement | null;
  const isinList = opts.overlay.querySelector('#' + opts.isinListId);
  const nameList = opts.overlay.querySelector('#' + opts.nameListId);
  if (!isinInput || !nameInput) return;

  const normalizedPairs = opts.pairs.map((pair) => ({
    isin: pair.isin.trim().toUpperCase(),
    name: pair.name.trim(),
  }));
  const byIsin = new Map(normalizedPairs.map((pair) => [pair.isin, pair]));
  const byName = new Map<string, SecuritySuggestionPair>();
  for (const pair of normalizedPairs) {
    if (!byName.has(pair.name)) byName.set(pair.name, pair);
  }

  populateDatalist(
    isinList,
    normalizedPairs.map((pair) => pair.isin),
  );
  populateDatalist(nameList, [...byName.keys()]);

  const applyPair = (pair: SecuritySuggestionPair): void => {
    isinInput.value = pair.isin;
    nameInput.value = pair.name;
  };

  const syncFromIsin = (): void => {
    const pair = byIsin.get(isinInput.value.trim().toUpperCase());
    if (pair) applyPair(pair);
  };

  const syncFromName = (): void => {
    const pair = byName.get(nameInput.value.trim());
    if (pair) applyPair(pair);
  };

  syncFromIsin();
  if (!byIsin.has(isinInput.value.trim().toUpperCase())) syncFromName();

  isinInput.addEventListener('change', syncFromIsin);
  isinInput.addEventListener('input', syncFromIsin);
  nameInput.addEventListener('change', syncFromName);
  nameInput.addEventListener('input', syncFromName);
}
