import type { SecuritySuggestionPair } from '../model/securitySuggestions';
import { attachCombobox, fillLinkedField, setFieldValue } from './combobox';

export interface SecurityAutocompleteOptions {
  overlay: HTMLElement;
  pairs: SecuritySuggestionPair[];
  isinInputId: string;
  nameInputId: string;
  /** Optional currency field filled with the security's last-used currency. */
  currencyInputId?: string;
}

/**
 * ISIN and name dropdowns that stay paired: picking or typing a known value on one side fills
 * the other, and the currency field when it hasn't been set by the user.
 */
export function attachSecurityAutocomplete(opts: SecurityAutocompleteOptions): void {
  const isinInput = opts.overlay.querySelector<HTMLInputElement>('#' + opts.isinInputId);
  const nameInput = opts.overlay.querySelector<HTMLInputElement>('#' + opts.nameInputId);
  if (!isinInput || !nameInput) return;
  const currencyInput = opts.currencyInputId
    ? opts.overlay.querySelector<HTMLInputElement>('#' + opts.currencyInputId)
    : null;

  const pairs = opts.pairs.map((pair) => ({
    ...pair,
    isin: pair.isin.trim().toUpperCase(),
    name: pair.name.trim(),
  }));
  const byIsin = new Map(pairs.map((pair) => [pair.isin, pair]));
  const byName = new Map<string, SecuritySuggestionPair>();
  for (const pair of pairs) {
    if (!byName.has(pair.name)) byName.set(pair.name, pair);
  }

  attachCombobox(
    isinInput,
    pairs.map((pair) => ({ value: pair.isin, hint: pair.name })),
  );
  attachCombobox(
    nameInput,
    [...byName.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((pair) => ({ value: pair.name, hint: pair.isin })),
  );

  let applying = false;
  const applyPair = (pair: SecuritySuggestionPair): void => {
    if (applying) return;
    applying = true;
    try {
      if (isinInput.value.trim().toUpperCase() !== pair.isin) setFieldValue(isinInput, pair.isin);
      if (nameInput.value.trim() !== pair.name) setFieldValue(nameInput, pair.name);
      if (pair.currency) fillLinkedField(currencyInput, pair.currency);
    } finally {
      applying = false;
    }
  };

  const syncFromIsin = (): void => {
    const pair = byIsin.get(isinInput.value.trim().toUpperCase());
    if (pair) applyPair(pair);
  };
  const syncFromName = (): void => {
    const pair = byName.get(nameInput.value.trim());
    if (pair) applyPair(pair);
  };

  // Opening an existing record only completes a missing half; it never touches the currency.
  const isinPair = byIsin.get(isinInput.value.trim().toUpperCase());
  const namePair = byName.get(nameInput.value.trim());
  if (isinPair && !nameInput.value.trim()) nameInput.value = isinPair.name;
  else if (namePair && !isinInput.value.trim()) isinInput.value = namePair.isin;

  isinInput.addEventListener('change', syncFromIsin);
  isinInput.addEventListener('input', syncFromIsin);
  nameInput.addEventListener('change', syncFromName);
  nameInput.addEventListener('input', syncFromName);
}
