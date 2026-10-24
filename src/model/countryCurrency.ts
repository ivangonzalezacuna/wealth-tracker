/**
 * Built-in country list with each country's usual currency. Countries are keyed by ISO 3166
 * region code; names are resolved through Intl.DisplayNames, so a country can be typed in
 * English, the browser's languages or a few common European ones ("Suiza", "Schweiz").
 */

const EURO = 'AD AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MC ME MT NL PT SI SK SM VA XK';

const OTHER =
  'AE:AED AL:ALL AM:AMD AR:ARS AU:AUD AZ:AZN BA:BAM BD:BDT BG:BGN BH:BHD BM:BMD BO:BOB ' +
  'BR:BRL BS:BSD BY:BYN CA:CAD CH:CHF CL:CLP CN:CNY CO:COP CR:CRC CZ:CZK DK:DKK DO:DOP ' +
  'DZ:DZD EC:USD EG:EGP FO:DKK GB:GBP GE:GEL GG:GBP GH:GHS GI:GIP GL:DKK GT:GTQ HK:HKD ' +
  'HN:HNL HU:HUF ID:IDR IL:ILS IM:GBP IN:INR IS:ISK JE:GBP JM:JMD JO:JOD JP:JPY KE:KES ' +
  'KH:KHR KR:KRW KW:KWD KY:KYD KZ:KZT LB:LBP LI:CHF LK:LKR MA:MAD MD:MDL MK:MKD MN:MNT ' +
  'MO:MOP MU:MUR MX:MXN MY:MYR NA:NAD NG:NGN NI:NIO NO:NOK NP:NPR NZ:NZD OM:OMR PA:PAB ' +
  'PE:PEN PH:PHP PK:PKR PL:PLN PR:USD PY:PYG QA:QAR RO:RON RS:RSD RU:RUB SA:SAR SE:SEK ' +
  'SG:SGD SV:USD TH:THB TN:TND TR:TRY TT:TTD TW:TWD TZ:TZS UA:UAH UG:UGX US:USD UY:UYU ' +
  'UZ:UZS VN:VND ZA:ZAR ZM:ZMW';

const CURRENCY_BY_CODE: Record<string, string> = Object.fromEntries([
  ...EURO.split(' ').map((code) => [code, 'EUR']),
  ...OTHER.split(' ').map((pair) => pair.split(':')),
]);

/** Short forms and older names that Intl.DisplayNames doesn't produce. */
const ALIASES: Record<string, string> = {
  uk: 'GB',
  'great britain': 'GB',
  britain: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  us: 'US',
  usa: 'US',
  america: 'US',
  'united states of america': 'US',
  uae: 'AE',
  emirates: 'AE',
  holland: 'NL',
  'the netherlands': 'NL',
  'czech republic': 'CZ',
  turkey: 'TR',
  'south korea': 'KR',
  korea: 'KR',
  'hong kong': 'HK',
  macau: 'MO',
  macao: 'MO',
  russia: 'RU',
  vatican: 'VA',
  'vatican city': 'VA',
  'north macedonia': 'MK',
  macedonia: 'MK',
};

/** Display names for codes whose CLDR name is long-winded. */
const DISPLAY_OVERRIDES: Record<string, string> = {
  HK: 'Hong Kong',
  MO: 'Macao',
};

const RECOGNISED_LANGUAGES = ['en', 'de', 'es', 'fr', 'it', 'pt', 'nl'];

export function normalizeCountry(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[.'\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function displayNames(language: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([language], { type: 'region', fallback: 'none' });
  } catch {
    return null;
  }
}

let _codeByName: Map<string, string> | null = null;

function codeByName(): Map<string, string> {
  if (_codeByName) return _codeByName;
  const map = new Map<string, string>();
  const browser = typeof navigator !== 'undefined' ? [...(navigator.languages ?? [])] : [];
  const languages = [...new Set([...RECOGNISED_LANGUAGES, ...browser])];
  for (const language of languages) {
    const names = displayNames(language);
    if (!names) continue;
    for (const code of Object.keys(CURRENCY_BY_CODE)) {
      const name = names.of(code);
      if (name) {
        const key = normalizeCountry(name);
        if (key && !map.has(key)) map.set(key, code);
      }
    }
  }
  for (const [alias, code] of Object.entries(ALIASES)) map.set(normalizeCountry(alias), code);
  for (const [code, name] of Object.entries(DISPLAY_OVERRIDES))
    map.set(normalizeCountry(name), code);
  _codeByName = map;
  return map;
}

/** ISO region code for a typed country name, in any recognised language. */
export function countryCode(country: string): string | undefined {
  const key = normalizeCountry(country);
  if (!key) return undefined;
  return codeByName().get(key);
}

/** Usual currency of a country typed in any recognised language, if known. */
export function defaultCurrencyForCountry(country: string): string | undefined {
  const code = countryCode(country);
  return code ? CURRENCY_BY_CODE[code] : undefined;
}

export interface BuiltInCountry {
  code: string;
  name: string;
  currency: string;
}

let _builtIns: BuiltInCountry[] | null = null;

/** Every built-in country with its English name, sorted by name. */
export function builtInCountries(): BuiltInCountry[] {
  if (_builtIns) return _builtIns;
  const names = displayNames('en');
  _builtIns = Object.entries(CURRENCY_BY_CODE)
    .map(([code, currency]) => ({
      code,
      currency,
      name: DISPLAY_OVERRIDES[code] ?? names?.of(code) ?? code,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return _builtIns;
}
