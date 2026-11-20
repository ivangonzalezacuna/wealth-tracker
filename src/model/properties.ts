export const PROPERTIES_KEY = 'property_register';
export const PROPERTY_USES = [
  'Home',
  'Inherited property',
  'Under construction',
  'Rented property',
  'Other',
] as const;
export type PropertyUse = (typeof PROPERTY_USES)[number];

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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100_000_000;
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01')
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
    (value.mortgage === 'known'
      ? isAmount(value.debt) && isDate(value.debtDate)
      : (value.mortgage === 'none' || value.mortgage === 'unknown') &&
        value.debt === null &&
        value.debtDate === null)
  );
}

/** Absent in older databases/backups. Malformed or future versions must never become an empty register. */
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
