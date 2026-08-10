import {
  normalizeSuggestionName,
  type KnownSecuritySuggestions,
} from '../model/securitySuggestions';
import { populateDatalist } from './modalShell';

interface SecuritySuggestionFieldIds {
  isinInputId: string;
  isinListId: string;
  nameInputId: string;
  nameListId: string;
}

interface SecuritySuggestionAutoFillOptions {
  overwritePeerField?: boolean;
}

export function filterKnownSecuritySuggestions(
  suggestions: KnownSecuritySuggestions | undefined,
  excludedIsins: readonly string[] = [],
): KnownSecuritySuggestions | undefined {
  if (!suggestions || suggestions.pairs.length === 0) return undefined;

  const excluded = new Set(excludedIsins.map((isin) => isin.trim().toUpperCase()));
  const pairs = suggestions.pairs.filter((pair) => !excluded.has(pair.isin.trim().toUpperCase()));
  if (pairs.length === 0) return undefined;

  const byIsin: KnownSecuritySuggestions['byIsin'] = {};
  const byName: KnownSecuritySuggestions['byName'] = {};
  for (const pair of pairs) {
    byIsin[pair.isin] = pair;
    byName[normalizeSuggestionName(pair.name)] = pair;
  }
  return { pairs, byIsin, byName };
}

export function populateSecuritySuggestionLists(
  overlay: HTMLElement,
  ids: SecuritySuggestionFieldIds,
  suggestions: KnownSecuritySuggestions | undefined,
): void {
  const isinList = overlay.querySelector('#' + ids.isinListId);
  const nameList = overlay.querySelector('#' + ids.nameListId);
  if (!suggestions || suggestions.pairs.length === 0) {
    populateDatalist(isinList, []);
    populateDatalist(nameList, []);
    return;
  }

  const sortedByIsin = [...suggestions.pairs].sort((a, b) => a.isin.localeCompare(b.isin));
  const sortedByName = [...suggestions.pairs].sort((a, b) => a.name.localeCompare(b.name));
  const nameByIsin = Object.fromEntries(sortedByIsin.map((pair) => [pair.isin, pair.name]));
  const isinByName = Object.fromEntries(sortedByName.map((pair) => [pair.name, pair.isin]));

  populateDatalist(
    isinList,
    sortedByIsin.map((pair) => pair.isin),
    (isin) => nameByIsin[isin] || '',
  );
  populateDatalist(
    nameList,
    sortedByName.map((pair) => pair.name),
    (name) => isinByName[name] || '',
  );
}

export function bindSecuritySuggestionAutoFill(
  overlay: HTMLElement,
  ids: SecuritySuggestionFieldIds,
  suggestions: KnownSecuritySuggestions | undefined,
  opts: SecuritySuggestionAutoFillOptions = {},
): void {
  if (!suggestions || suggestions.pairs.length === 0) return;

  const isinEl = overlay.querySelector('#' + ids.isinInputId) as HTMLInputElement | null;
  const nameEl = overlay.querySelector('#' + ids.nameInputId) as HTMLInputElement | null;
  if (!isinEl || !nameEl) return;

  const overwrite = !!opts.overwritePeerField;
  const canWrite = (value: string): boolean => overwrite || !value.trim();

  const applyByIsin = (): void => {
    const match = suggestions.byIsin[isinEl.value.trim().toUpperCase()];
    if (match && canWrite(nameEl.value)) nameEl.value = match.name;
  };
  const applyByName = (): void => {
    const match = suggestions.byName[normalizeSuggestionName(nameEl.value)];
    if (match && canWrite(isinEl.value)) isinEl.value = match.isin;
  };

  isinEl.addEventListener('change', applyByIsin);
  isinEl.addEventListener('blur', applyByIsin);
  nameEl.addEventListener('change', applyByName);
  nameEl.addEventListener('blur', applyByName);
}

export function securitySuggestionPairLooksCoherent(
  isin: string,
  name: string,
  suggestions: KnownSecuritySuggestions | undefined,
): boolean {
  if (!suggestions || !isin || !name) return true;
  const isinKey = isin.trim().toUpperCase();
  const nameKey = normalizeSuggestionName(name);
  const byIsin = suggestions.byIsin[isinKey];
  const byName = suggestions.byName[nameKey];
  if (!byIsin && !byName) return true;
  if (byIsin && normalizeSuggestionName(byIsin.name) !== nameKey) return false;
  if (byName && byName.isin !== isinKey) return false;
  return true;
}
