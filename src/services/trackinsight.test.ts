import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildFundUrl,
  fetchEtfInfo,
  TI_BASE_URL,
  TiError,
  TiNotFoundError,
  TiOfflineError,
  validateTiEtfInfo,
} from './trackinsight';

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildFundUrl', () => {
  it('builds the ETF_PROFILE URL from symbol + API key', () => {
    expect(buildFundUrl('QQQ', 'demo')).toBe(
      `${TI_BASE_URL}?function=ETF_PROFILE&symbol=QQQ&apikey=demo`,
    );
  });

  it('URL-encodes values', () => {
    expect(buildFundUrl('BRK.B', 'demo key', 'https://example.com/query')).toBe(
      'https://example.com/query?function=ETF_PROFILE&symbol=BRK.B&apikey=demo+key',
    );
  });
});

describe('fetchEtfInfo', () => {
  it('returns validated ETF info on success', async () => {
    mockFetch({
      symbol: 'QQQ',
      currency: 'USD',
      country: 'US',
      net_assets: '300.5B',
      inception_date: '2009-09-25',
      holdings: [
        { symbol: 'AAPL', description: 'Apple Inc', weight: '9.1%' },
        { symbol: 'MSFT', description: 'Microsoft Corp', weight: '8.6%' },
      ],
      sectors: [{ Technology: '58.1%' }],
      exchange: 'NASDAQ',
    });

    await expect(fetchEtfInfo('QQQ', 'demo')).resolves.toMatchObject({
      symbol: 'QQQ',
      fundCurrency: 'USD',
      domicileCountry: 'US',
      aum: 300500000000,
      inceptionDate: '2009-09-25',
      holdingsCount: 2,
      exchange: 'NASDAQ',
      sectors: [{ industry: 'Technology', exposure: '58.1%' }],
      topHoldings: [{ asset: 'Apple Inc', weightPercentage: '9.1%' }],
    });
  });

  it('throws TiError when symbol is missing', async () => {
    await expect(fetchEtfInfo('', 'demo')).rejects.toThrow(TiError);
  });

  it('throws TiError when API key is missing', async () => {
    await expect(fetchEtfInfo('QQQ', '')).rejects.toThrow(TiError);
  });

  it('throws TiNotFoundError on provider symbol error', async () => {
    mockFetch({ 'Error Message': 'Invalid API call.' });
    await expect(fetchEtfInfo('UNKNOWN', 'demo')).rejects.toThrow(TiNotFoundError);
  });

  it('throws TiError on provider informational throttle', async () => {
    mockFetch({ Information: 'Thank you for using Alpha Vantage! Please visit ...' });
    await expect(fetchEtfInfo('QQQ', 'demo')).rejects.toThrow(TiError);
  });

  it('throws TiError on non-404 HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Server Error', { status: 500 }));
    await expect(fetchEtfInfo('QQQ', 'demo')).rejects.toThrow(TiError);
  });

  it('throws TiOfflineError on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchEtfInfo('QQQ', 'demo')).rejects.toThrow(TiOfflineError);
  });

  it('throws TiError on malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(fetchEtfInfo('QQQ', 'demo')).rejects.toThrow(TiError);
  });
});

describe('validateTiEtfInfo', () => {
  it('maps root-level fields correctly', () => {
    const result = validateTiEtfInfo({
      symbol: 'QQQ',
      currency: 'USD',
      domicile: 'US',
      net_assets: '100M',
      inception_date: '2020-01-01',
      holdings: [{ description: 'Apple', weight: '5%' }],
      sectors: [{ Financials: '10%' }],
      exchange: 'NASDAQ',
    });
    expect(result).toEqual({
      symbol: 'QQQ',
      exchange: 'NASDAQ',
      domicileCountry: 'US',
      fundCurrency: 'USD',
      aum: 100000000,
      inceptionDate: '2020-01-01',
      holdingsCount: 1,
      sectors: [{ industry: 'Financials', exposure: '10%' }],
      topHoldings: [{ asset: 'Apple', weightPercentage: '5%' }],
    });
  });

  it('falls back to alternative field names', () => {
    const result = validateTiEtfInfo({
      fund_currency: 'CHF',
      domicile_country: 'CH',
      aum: 500,
      nb_holdings: 300,
      main_exchange: 'SIX',
      ticker: 'SSAC',
    });
    expect(result.fundCurrency).toBe('CHF');
    expect(result.domicileCountry).toBe('CH');
    expect(result.aum).toBe(500);
    expect(result.holdingsCount).toBe(300);
    expect(result.exchange).toBe('SIX');
    expect(result.symbol).toBe('SSAC');
  });

  it('handles missing and null fields gracefully', () => {
    const result = validateTiEtfInfo({ currency: 'USD', total_assets: null, top_holdings: null });
    expect(result.fundCurrency).toBe('USD');
    expect(result.aum).toBeNull();
    expect(result.exchange).toBeUndefined();
    expect(result.sectors).toBeNull();
    expect(result.topHoldings).toBeNull();
  });

  it('returns an empty object for invalid raw values', () => {
    expect(validateTiEtfInfo(null)).toEqual({});
    expect(validateTiEtfInfo(undefined)).toEqual({});
    expect(validateTiEtfInfo('string')).toEqual({});
  });

  it('handles null inception_date', () => {
    const result = validateTiEtfInfo({ inception_date: null });
    expect(result.inceptionDate).toBeNull();
  });

  it('filters out empty sector and holding entries', () => {
    const result = validateTiEtfInfo({
      sectors: [
        { name: '', weight: 0 },
        { name: 'Tech', weight: 30 },
      ],
      holdings: [
        { name: '', weight: '' },
        { name: 'Microsoft', weight: 5 },
      ],
    });
    expect(result.sectors).toEqual([{ industry: 'Tech', exposure: '30' }]);
    expect(result.topHoldings).toEqual([{ asset: 'Microsoft', weightPercentage: '5' }]);
  });
});
