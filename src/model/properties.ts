export const PROPERTIES_KEY = 'property_register';
export const PROPERTY_USES = [
  'Home',
  'Inherited property',
  'Under construction',
  'Rented property',
  'Other',
] as const;
export type PropertyUse = (typeof PROPERTY_USES)[number];

interface MortgageTerms {
  annualRate: number;
  monthlyPayment: number;
}

export const MAX_MORTGAGE_RATE = 100;
export const MAX_PROPERTY_AMOUNT = 100_000_000;

export interface Property {
  id: string;
  label: string;
  use: PropertyUse;
  value: number;
  share: number;
  valueDate: string;
  mortgage: 'unknown' | 'none' | 'known';
  debt: number | null;
  debtDate: string | null;
  mortgageTerms?: MortgageTerms;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_PROPERTY_AMOUNT
  );
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01')
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isMortgageTerms(value: unknown): value is MortgageTerms {
  return (
    isRecord(value) &&
    isAmount(value.annualRate) &&
    value.annualRate <= MAX_MORTGAGE_RATE &&
    isAmount(value.monthlyPayment) &&
    value.monthlyPayment >= 0.01
  );
}

function isProperty(value: unknown): value is Property {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.label === 'string' &&
    value.label === value.label.trim() &&
    value.label.length > 0 &&
    value.label.length <= 60 &&
    PROPERTY_USES.some((use) => use === value.use) &&
    isAmount(value.value) &&
    typeof value.share === 'number' &&
    Number.isFinite(value.share) &&
    value.share > 0 &&
    value.share <= 100 &&
    isDate(value.valueDate) &&
    (value.mortgageTerms === undefined ||
      (value.mortgage === 'known' &&
        isAmount(value.debt) &&
        value.debt > 0 &&
        isMortgageTerms(value.mortgageTerms))) &&
    (value.mortgage === 'known'
      ? isAmount(value.debt) && isDate(value.debtDate)
      : (value.mortgage === 'none' || value.mortgage === 'unknown') &&
        value.debt === null &&
        value.debtDate === null)
  );
}

export function parseProperties(raw: string | null | undefined): Property[] {
  if (raw == null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'The property register cannot be read. Restore a valid backup before editing properties.',
    );
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.properties) ||
    !parsed.properties.every(isProperty) ||
    new Set(parsed.properties.map((property: Property) => property.id)).size !==
      parsed.properties.length
  ) {
    throw new Error(
      'The property register is invalid or uses an unsupported version. Update the app or restore a valid backup.',
    );
  }
  return parsed.properties;
}

export function serializeProperties(properties: Property[]): string {
  const raw = JSON.stringify({ version: 1, properties });
  parseProperties(raw);
  return raw;
}

export function propertyEquity(property: Property): number | null {
  if (property.mortgage === 'unknown') return null;
  return (
    (property.value * property.share) / 100 - (property.mortgage === 'known' ? property.debt! : 0)
  );
}

export function totalPropertyEquity(properties: Property[]): number | null {
  if (properties.some((property) => propertyEquity(property) === null)) return null;
  return properties.reduce((sum, property) => sum + propertyEquity(property)!, 0);
}

export function estimateMortgagePayoff(
  balance: number,
  statementDate: string,
  { annualRate, monthlyPayment }: MortgageTerms,
): { month: string } | { reason: 'interest' | 'limit' } {
  let remaining = Math.round(balance * 100);
  const payment = Math.round(monthlyPayment * 100);
  const monthlyRate = annualRate / 1200;
  const [year, month] = statementDate.split('-').map(Number);
  // Use cents and start with the first payment in the month after the statement.
  for (let elapsed = 1; elapsed <= 600; elapsed++) {
    const principal = payment - Math.round(remaining * monthlyRate);
    if (principal <= 0) return { reason: 'interest' };
    remaining -= principal;
    if (remaining <= 0) {
      const index = year * 12 + month - 1 + elapsed;
      const payoffYear = Math.floor(index / 12);
      if (payoffYear > 9999) break;
      return { month: `${payoffYear}-${String((index % 12) + 1).padStart(2, '0')}` };
    }
  }
  return { reason: 'limit' };
}
