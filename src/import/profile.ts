import type { ImportProfile, ImportProfileColumns, DecimalMode, DateFormat } from '../types';

export type { ImportProfile };

interface UserMapping {
  columns: Record<string, string | number>;
  typeMap: Record<string, string>;
  label?: string;
  delimiter?: string;
  decimal?: DecimalMode;
  dateFormat?: DateFormat;
  defaultCurrency?: string;
}

/**
 * Build an ImportProfile from a user-supplied column mapping.
 * This is the extension point for the future interactive column-mapper UI.
 */
export function buildProfileFromMapping(
  headerList: string[],
  userMapping: UserMapping,
): ImportProfile {
  return {
    id: 'custom_' + Date.now(),
    label: userMapping.label || 'Custom profile',
    delimiter: userMapping.delimiter || 'auto',
    decimal: userMapping.decimal || 'auto',
    dateFormat: userMapping.dateFormat || 'YYYY-MM-DD',
    defaultCurrency: userMapping.defaultCurrency || 'EUR',
    columns: { ...userMapping.columns } as ImportProfileColumns,
    typeMap: { ...userMapping.typeMap },
    match: { headerIncludes: headerList.slice(0, 5) },
  };
}
