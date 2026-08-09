/**
 * Shared constants for Account and Holding type/class/region options.
 * Used by both the Settings view and the add/edit dialogs.
 */

export const ACCOUNT_TYPES: { value: string; label: string }[] = [
  { value: 'investment', label: 'Investment' },
  { value: 'savings', label: 'Savings' },
  { value: 'pension', label: 'Pension' },
  { value: 'avd', label: 'AVD (Altersvorsorgedepot)' },
  { value: 'cash', label: 'Cash' },
];

export const ASSET_CLASSES: { value: string; label: string }[] = [
  { value: 'equity', label: 'Equity' },
  { value: 'bond', label: 'Bond' },
  { value: 'reit', label: 'REIT' },
  { value: 'commodity', label: 'Commodity' },
  { value: 'other', label: 'Other' },
];

export const REGIONS: { value: string; label: string }[] = [
  { value: 'developed', label: 'Developed' },
  { value: 'emerging', label: 'Emerging' },
  { value: 'global', label: 'Global' },
  { value: 'europe', label: 'Europe' },
  { value: 'us', label: 'US' },
  { value: 'other', label: 'Other' },
];
