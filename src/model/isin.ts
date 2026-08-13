/** ISO 6166 shape: 2 uppercase letters + 9 alphanumeric + 1 numeric check digit. */
export const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export const ISIN_HINT = 'Use 12-character ISIN format (e.g. IE00B4L5Y983).';

export function normalizeISIN(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidISIN(value: string): boolean {
  return ISIN_PATTERN.test(value);
}
