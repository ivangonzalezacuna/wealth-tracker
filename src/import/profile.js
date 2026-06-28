/**
 * ImportProfile schema — a plain data object that tells the generic parser
 * how to interpret a CSV from a specific bank/broker.
 *
 * Built-in profiles live in `./profiles/`; future interactive mapper will
 * produce the exact same shape via `buildProfileFromMapping()`.
 *
 * @typedef {Object} ImportProfile
 * @property {string}  id          - Unique profile identifier (e.g. 'trade_republic')
 * @property {string}  label       - Human-readable name (e.g. 'Trade Republic')
 * @property {'auto'|','|';'|'\t'} delimiter - CSV field separator
 * @property {'auto'|'dot'|'comma'} decimal  - Number format ('comma' = German 1.234,56)
 * @property {string}  dateFormat  - Date pattern: 'YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'ISO'
 * @property {string}  defaultCurrency - Fallback currency code when column is absent
 * @property {Record<string, string|number>} columns - Maps canonical field names to source header names or numeric indices
 *   Canonical fields: id, date, type, category, name, symbol, shares, price, amount, fee, tax, currency, fxRate
 * @property {Record<string, string>} typeMap - Maps source type values (uppercased) to canonical TxType values.
 *   Compound keys like 'BUY|TRADING' match `type|category` before falling back to `type` alone.
 * @property {{ headerIncludes?: string[] }} [match] - Auto-detection hints
 *   headerIncludes: if every listed string appears in the CSV header line, this profile matches.
 */

/**
 * Build an ImportProfile from a user-supplied column mapping.
 * This is the extension point for the future interactive column-mapper UI.
 *
 * The interactive mapper (Phase TBD) will present the user with the CSV headers
 * and let them drag/select which column maps to each canonical field. The result
 * is fed here to produce a valid ImportProfile that the generic parser accepts.
 *
 * @param {string[]} headerList - The CSV header row as an array of strings
 * @param {Object}   userMapping - User-supplied mapping
 * @param {Record<string, string>} userMapping.columns  - canonical field → header name
 * @param {Record<string, string>} userMapping.typeMap   - source type value → TxType
 * @param {string}  [userMapping.label]           - Profile display name
 * @param {string}  [userMapping.delimiter]        - Override delimiter
 * @param {string}  [userMapping.decimal]          - Override decimal format
 * @param {string}  [userMapping.dateFormat]       - Override date format
 * @param {string}  [userMapping.defaultCurrency]  - Override default currency
 * @returns {ImportProfile}
 */
export function buildProfileFromMapping(headerList, userMapping) {
  return {
    id:              'custom_' + Date.now(),
    label:           userMapping.label || 'Custom profile',
    delimiter:       userMapping.delimiter || 'auto',
    decimal:         userMapping.decimal || 'auto',
    dateFormat:      userMapping.dateFormat || 'YYYY-MM-DD',
    defaultCurrency: userMapping.defaultCurrency || 'EUR',
    columns:         { ...userMapping.columns },
    typeMap:         { ...userMapping.typeMap },
    match:           { headerIncludes: headerList.slice(0, 5) },
  };
}
