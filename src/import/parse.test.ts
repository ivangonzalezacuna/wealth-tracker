// @ts-nocheck — test fixtures use partial objects; strict typing deferred
import { describe, it, expect } from 'vitest';
import { TxType } from '../model/tx';
import { parseWithProfile, detectProfile, previewSummary, parseNumber, parseDate } from './parse';
import { tradeRepublicProfile } from './profiles/trade_republic';
import { builtInProfiles } from './profiles/index';
import { buildProfileFromMapping } from './profile';
import { parseCSV } from '../csv';

// ── Fixtures ───────────────────────────────────────────────

/** Semicolon-delimited TR CSV with German decimals (real-world format). */
const TR_CSV_SEMI = [
  'transaction_id;date;type;category;name;symbol;shares;price;amount;fee;tax;currency;fx_rate',
  'tx-001;2024-01-15;BUY;TRADING;iShares MSCI World;IE00B4L5Y983;10;75,50;-755,00;-1,50;0;EUR;',
  'tx-002;2024-02-01;BUY;TRADING;iShares EM;IE00BKM4GZ66;5;42,20;-211,00;0;0;EUR;',
  'tx-003;2024-03-01;SELL;TRADING;iShares EM;IE00BKM4GZ66;2;45,00;90,00;-0,50;0;EUR;',
  'tx-004;2024-03-15;DIVIDEND;;iShares MSCI World;IE00B4L5Y983;0;0;12,50;0;-2,00;EUR;',
  'tx-005;2024-04-01;INTEREST_PAYMENT;;Cash Interest;;0;0;3,75;0;0;EUR;',
  'tx-006;2024-04-15;FEE;;Platform Fee;;0;0;-1,00;0;0;EUR;',
  'tx-007;2024-05-01;TAX_OPTIMIZATION;;Tax Refund;;0;0;5,00;0;3,44;EUR;',
  'tx-008;2024-05-15;CUSTOMER_INPAYMENT;;Bank Transfer;;0;0;1000,00;0;0;EUR;',
  'tx-009;2024-06-01;CUSTOMER_OUTPAYMENT;;Cash Out;;0;0;-200,00;0;0;EUR;',
  'tx-010;2024-06-15;TRANSFER_INBOUND;;Portfolio Transfer;;0;0;500,00;0;0;EUR;',
].join('\n');

/** Comma-delimited TR CSV with dot decimals. */
const TR_CSV_COMMA = [
  'transaction_id,date,type,category,name,symbol,shares,price,amount,fee,tax,currency,fx_rate',
  'tx-001,2024-01-15,BUY,TRADING,iShares MSCI World,IE00B4L5Y983,10,75.50,-755.00,-1.50,0,EUR,',
  'tx-002,2024-02-01,BUY,TRADING,iShares EM,IE00BKM4GZ66,5,42.20,-211.00,0,0,EUR,',
].join('\n');

/** CSV with an unmapped type to verify it's reported, not dropped. */
const TR_CSV_WITH_UNMAPPED = [
  'transaction_id;date;type;category;name;symbol;shares;price;amount;fee;tax;currency;fx_rate',
  'tx-100;2024-01-01;BUY;TRADING;Test ETF;IE00TEST;1;100;-100;0;0;EUR;',
  'tx-101;2024-01-02;STOCK_SPLIT;CORPORATE_ACTION;Test ETF;IE00TEST;0;0;0;0;0;EUR;',
  'tx-102;2024-01-03;STOCK_SPLIT;CORPORATE_ACTION;Test ETF 2;IE00TEST2;0;0;0;0;0;EUR;',
  'tx-103;2024-01-04;REBATE;;Cash Rebate;;0;0;5;0;0;EUR;',
].join('\n');

// ── Regression: TR profile parses identically to legacy csv.js ──

describe('TR profile regression (parseWithProfile vs legacy parseCSV)', () => {
  it('semicolon-delimited German CSV produces identical results', () => {
    const legacy = parseCSV(TR_CSV_SEMI);
    const { transactions: engine } = parseWithProfile(TR_CSV_SEMI, tradeRepublicProfile);

    expect(engine).toHaveLength(legacy.length);
    for (let i = 0; i < legacy.length; i++) {
      expect(engine[i].id).toBe(legacy[i].id);
      expect(engine[i].date).toBe(legacy[i].date);
      expect(engine[i].source).toBe(legacy[i].source);
      expect(engine[i].type).toBe(legacy[i].type);
      expect(engine[i].name).toBe(legacy[i].name);
      expect(engine[i].symbol).toBe(legacy[i].symbol);
      expect(engine[i].shares).toBeCloseTo(legacy[i].shares);
      expect(engine[i].price).toBeCloseTo(legacy[i].price);
      expect(engine[i].amount).toBeCloseTo(legacy[i].amount);
      expect(engine[i].fee).toBeCloseTo(legacy[i].fee);
      expect(engine[i].tax).toBeCloseTo(legacy[i].tax);
      expect(engine[i].currency).toBe(legacy[i].currency);
      expect(engine[i].fxRate).toBeCloseTo(legacy[i].fxRate);
    }
  });

  it('comma-delimited dot-decimal CSV produces identical results', () => {
    const legacy = parseCSV(TR_CSV_COMMA);
    const { transactions: engine } = parseWithProfile(TR_CSV_COMMA, tradeRepublicProfile);

    expect(engine).toHaveLength(legacy.length);
    for (let i = 0; i < legacy.length; i++) {
      expect(engine[i].id).toBe(legacy[i].id);
      expect(engine[i].date).toBe(legacy[i].date);
      expect(engine[i].type).toBe(legacy[i].type);
      expect(engine[i].amount).toBeCloseTo(legacy[i].amount);
      expect(engine[i].shares).toBeCloseTo(legacy[i].shares);
    }
  });

  it('all canonical types are mapped correctly from TR', () => {
    const { transactions } = parseWithProfile(TR_CSV_SEMI, tradeRepublicProfile);
    const types = transactions.map((t) => t.type);

    expect(types).toContain(TxType.BUY);
    expect(types).toContain(TxType.SELL);
    expect(types).toContain(TxType.DIVIDEND);
    expect(types).toContain(TxType.INTEREST);
    expect(types).toContain(TxType.FEE);
    expect(types).toContain(TxType.TAX);
    expect(types).toContain(TxType.DEPOSIT);
    expect(types).toContain(TxType.WITHDRAWAL);
  });

  it('source is stamped as trade_republic', () => {
    const { transactions } = parseWithProfile(TR_CSV_SEMI, tradeRepublicProfile);
    for (const tx of transactions) {
      expect(tx.source).toBe('trade_republic');
    }
  });
});

// ── Decimal / date normalization ─────────────────────────────

describe('parseNumber', () => {
  it('handles German format 1.234,56', () => {
    expect(parseNumber('1.234,56', 'auto')).toBeCloseTo(1234.56);
    expect(parseNumber('1.234,56', 'comma')).toBeCloseTo(1234.56);
  });

  it('handles plain comma-decimal 12,34', () => {
    expect(parseNumber('12,34', 'auto')).toBeCloseTo(12.34);
    expect(parseNumber('12,34', 'comma')).toBeCloseTo(12.34);
  });

  it('handles dot-decimal 1234.56', () => {
    expect(parseNumber('1234.56', 'auto')).toBeCloseTo(1234.56);
    expect(parseNumber('1234.56', 'dot')).toBeCloseTo(1234.56);
  });

  it('handles negative German -1.234,56', () => {
    expect(parseNumber('-1.234,56', 'auto')).toBeCloseTo(-1234.56);
  });

  it('handles dot mode with thousands commas', () => {
    expect(parseNumber('1,234.56', 'dot')).toBeCloseTo(1234.56);
  });

  it('returns 0 for empty/null', () => {
    expect(parseNumber('', 'auto')).toBe(0);
    expect(parseNumber(null, 'auto')).toBe(0);
    expect(parseNumber(undefined, 'auto')).toBe(0);
  });
});

describe('parseDate', () => {
  it('YYYY-MM-DD passthrough', () => {
    expect(parseDate('2024-01-15', 'YYYY-MM-DD')).toBe('2024-01-15');
  });

  it('DD.MM.YYYY German format', () => {
    expect(parseDate('15.01.2024', 'DD.MM.YYYY')).toBe('2024-01-15');
  });

  it('DD/MM/YYYY European slash format', () => {
    expect(parseDate('15/01/2024', 'DD/MM/YYYY')).toBe('2024-01-15');
  });

  it('MM/DD/YYYY US format', () => {
    expect(parseDate('01/15/2024', 'MM/DD/YYYY')).toBe('2024-01-15');
  });

  it('ISO datetime strips time part', () => {
    expect(parseDate('2024-01-15T10:30:00Z', 'YYYY-MM-DD')).toBe('2024-01-15');
  });

  it('returns empty for empty input', () => {
    expect(parseDate('', 'YYYY-MM-DD')).toBe('');
  });

  it('pads single-digit day/month', () => {
    expect(parseDate('5.3.2024', 'DD.MM.YYYY')).toBe('2024-03-05');
  });
});

// ── detectProfile ──────────────────────────────────────────

describe('detectProfile', () => {
  it('detects Trade Republic from real TR header (semicolon)', () => {
    const header =
      'transaction_id;date;type;category;name;symbol;shares;price;amount;fee;tax;currency;fx_rate';
    const profile = detectProfile(header);
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('trade_republic');
  });

  it('detects Trade Republic from comma-delimited header', () => {
    const header =
      'transaction_id,date,type,category,name,symbol,shares,price,amount,fee,tax,currency,fx_rate';
    const profile = detectProfile(header);
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('trade_republic');
  });

  it('returns null for unknown headers', () => {
    const header = 'Datum;Buchungstext;Betrag;Saldo';
    const profile = detectProfile(header);
    expect(profile).toBeNull();
  });

  it('is case-insensitive for header matching', () => {
    const header =
      'TRANSACTION_ID;DATE;TYPE;CATEGORY;NAME;SYMBOL;SHARES;PRICE;AMOUNT;FEE;TAX;CURRENCY;FX_RATE';
    const profile = detectProfile(header);
    expect(profile).not.toBeNull();
    expect(profile.id).toBe('trade_republic');
  });
});

// ── Unmapped types ─────────────────────────────────────────

describe('unmapped types handling', () => {
  it('reports unmapped types without dropping rows', () => {
    const { transactions, unmapped } = parseWithProfile(TR_CSV_WITH_UNMAPPED, tradeRepublicProfile);

    // Total rows = 4 (1 BUY + 2 STOCK_SPLIT + 1 REBATE)
    expect(transactions).toHaveLength(4);

    // Unmapped: STOCK_SPLIT|CORPORATE_ACTION (2 rows) + REBATE (1 row)
    expect(unmapped.length).toBeGreaterThanOrEqual(2);

    const stockSplit = unmapped.find((u) => u.type.includes('STOCK_SPLIT'));
    expect(stockSplit).toBeDefined();
    expect(stockSplit.count).toBe(2);

    const rebate = unmapped.find((u) => u.type === 'REBATE');
    expect(rebate).toBeDefined();
    expect(rebate.count).toBe(1);
  });

  it('unmapped rows have type preserved uppercased', () => {
    const { transactions } = parseWithProfile(TR_CSV_WITH_UNMAPPED, tradeRepublicProfile);
    const stockSplits = transactions.filter((t) => t.type === 'STOCK_SPLIT');
    expect(stockSplits).toHaveLength(2);
  });
});

// ── Preview summary ────────────────────────────────────────

describe('previewSummary', () => {
  it('counts match actual parsed type tallies', () => {
    const parsed = parseWithProfile(TR_CSV_SEMI, tradeRepublicProfile);
    const summary = previewSummary(parsed);

    // Verify total
    expect(summary.total).toBe(parsed.transactions.length);

    // Verify each type count matches
    const actualCounts = {};
    for (const tx of parsed.transactions) {
      actualCounts[tx.type] = (actualCounts[tx.type] || 0) + 1;
    }
    expect(summary.byCounts).toEqual(actualCounts);
  });

  it('sample contains at most 10 rows', () => {
    const parsed = parseWithProfile(TR_CSV_SEMI, tradeRepublicProfile);
    const summary = previewSummary(parsed);
    expect(summary.sample.length).toBeLessThanOrEqual(10);
    expect(summary.sample.length).toBe(Math.min(10, parsed.transactions.length));
  });

  it('reports unmapped types in summary', () => {
    const parsed = parseWithProfile(TR_CSV_WITH_UNMAPPED, tradeRepublicProfile);
    const summary = previewSummary(parsed);
    expect(summary.unmapped.length).toBeGreaterThan(0);
  });
});

// ── Second bank profile (fictitious, proves no parser change needed) ──

describe('adding a second bank requires only a profile object', () => {
  const fakeBankProfile = {
    id: 'fake_bank',
    label: 'Fake Bank DE',
    delimiter: ';',
    decimal: 'comma',
    dateFormat: 'DD.MM.YYYY',
    defaultCurrency: 'EUR',
    columns: {
      id: 'Ref',
      date: 'Datum',
      type: 'Typ',
      name: 'Bezeichnung',
      amount: 'Betrag',
    },
    typeMap: {
      KAUF: TxType.BUY,
      VERKAUF: TxType.SELL,
      DIVIDENDE: TxType.DIVIDEND,
    },
    match: {
      headerIncludes: ['Ref', 'Datum', 'Typ', 'Bezeichnung', 'Betrag'],
    },
  };

  const FAKE_CSV = [
    'Ref;Datum;Typ;Bezeichnung;Betrag',
    'FB-001;15.01.2024;KAUF;iShares Core;-500,00',
    'FB-002;01.03.2024;VERKAUF;iShares Core;250,00',
    'FB-003;15.06.2024;DIVIDENDE;iShares Core;12,50',
    'FB-004;20.06.2024;ZINSEN;Sparkonto;3,75',
  ].join('\n');

  it('parses correctly with a different profile', () => {
    const { transactions, unmapped } = parseWithProfile(FAKE_CSV, fakeBankProfile);

    expect(transactions).toHaveLength(4);
    expect(transactions[0].type).toBe(TxType.BUY);
    expect(transactions[0].date).toBe('2024-01-15');
    expect(transactions[0].amount).toBeCloseTo(-500);
    expect(transactions[0].source).toBe('fake_bank');

    expect(transactions[1].type).toBe(TxType.SELL);
    expect(transactions[2].type).toBe(TxType.DIVIDEND);

    // ZINSEN is unmapped
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0].type).toBe('ZINSEN');
    expect(transactions[3].type).toBe('ZINSEN');
  });

  it('auto-detects the fake bank profile by header', () => {
    const profiles = [...builtInProfiles, fakeBankProfile];
    const header = 'Ref;Datum;Typ;Bezeichnung;Betrag';
    const detected = detectProfile(header, profiles);
    expect(detected).not.toBeNull();
    expect(detected.id).toBe('fake_bank');
  });

  it('does not match TR profile for fake bank header', () => {
    const header = 'Ref;Datum;Typ;Bezeichnung;Betrag';
    const detected = detectProfile(header);
    expect(detected).toBeNull();
  });
});

// ── Column mapping by index ────────────────────────────────

describe('column mapping by numeric index', () => {
  const indexProfile = {
    id: 'index_test',
    label: 'Index Test',
    delimiter: ',',
    decimal: 'dot',
    dateFormat: 'YYYY-MM-DD',
    defaultCurrency: 'USD',
    columns: {
      date: 0,
      type: 1,
      name: 2,
      amount: 3,
    },
    typeMap: { BUY: TxType.BUY },
  };

  it('resolves columns by numeric index', () => {
    const csv = 'Date,Type,Name,Amount\n2024-06-01,BUY,Test Stock,-100.50\n';
    const { transactions } = parseWithProfile(csv, indexProfile);

    expect(transactions).toHaveLength(1);
    expect(transactions[0].date).toBe('2024-06-01');
    expect(transactions[0].type).toBe(TxType.BUY);
    expect(transactions[0].name).toBe('Test Stock');
    expect(transactions[0].amount).toBeCloseTo(-100.5);
    expect(transactions[0].currency).toBe('USD');
  });
});

// ── buildProfileFromMapping extension point ────────────────

describe('buildProfileFromMapping', () => {
  it('produces a valid ImportProfile shape', () => {
    const headers = ['Date', 'Type', 'Name', 'Amount', 'Currency'];
    const mapping = {
      columns: { date: 'Date', type: 'Type', name: 'Name', amount: 'Amount', currency: 'Currency' },
      typeMap: { BUY: TxType.BUY, SELL: TxType.SELL },
      label: 'My Custom Bank',
      decimal: 'dot',
      dateFormat: 'MM/DD/YYYY',
    };

    const profile = buildProfileFromMapping(headers, mapping);

    expect(profile.id).toMatch(/^custom_/);
    expect(profile.label).toBe('My Custom Bank');
    expect(profile.decimal).toBe('dot');
    expect(profile.dateFormat).toBe('MM/DD/YYYY');
    expect(profile.columns.date).toBe('Date');
    expect(profile.typeMap.BUY).toBe(TxType.BUY);

    // Verify it works with the parser
    const csv = 'Date,Type,Name,Amount,Currency\n01/15/2024,BUY,Test,-500,USD\n';
    const { transactions } = parseWithProfile(csv, profile);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].date).toBe('2024-01-15');
    expect(transactions[0].type).toBe(TxType.BUY);
    expect(transactions[0].currency).toBe('USD');
  });
});

// ── Edge cases ─────────────────────────────────────────────

describe('edge cases', () => {
  it('skips rows with no date', () => {
    const csv = [
      'transaction_id;date;type;category;name;symbol;shares;price;amount;fee;tax;currency;fx_rate',
      'tx-001;2024-01-15;BUY;TRADING;Test;IE00TEST;1;100;-100;0;0;EUR;',
      'tx-002;;BUY;TRADING;No Date;IE00TEST;1;100;-100;0;0;EUR;',
    ].join('\n');
    const { transactions } = parseWithProfile(csv, tradeRepublicProfile);
    expect(transactions).toHaveLength(1);
  });

  it('handles empty CSV gracefully', () => {
    const { transactions, unmapped } = parseWithProfile('', tradeRepublicProfile);
    expect(transactions).toHaveLength(0);
    expect(unmapped).toHaveLength(0);
  });

  it('handles header-only CSV', () => {
    const csv =
      'transaction_id;date;type;category;name;symbol;shares;price;amount;fee;tax;currency;fx_rate\n';
    const { transactions } = parseWithProfile(csv, tradeRepublicProfile);
    expect(transactions).toHaveLength(0);
  });

  it('fills defaultCurrency when column is missing', () => {
    const profile = {
      ...tradeRepublicProfile,
      id: 'test_no_currency',
      columns: { ...tradeRepublicProfile.columns },
    };
    delete profile.columns.currency;

    const csv = [
      'transaction_id;date;type;category;name;symbol;shares;price;amount;fee;tax;fx_rate',
      'tx-001;2024-01-15;BUY;TRADING;Test;IE00TEST;1;100;-100;0;0;',
    ].join('\n');
    const { transactions } = parseWithProfile(csv, profile);
    expect(transactions[0].currency).toBe('EUR');
  });

  it('handles quoted fields with separator inside', () => {
    const csv = [
      'transaction_id,date,type,category,name,symbol,shares,price,amount,fee,tax,currency,fx_rate',
      'tx-001,2024-01-15,BUY,TRADING,"iShares MSCI World, Acc",IE00B4L5Y983,10,75.50,-755.00,-1.50,0,EUR,',
    ].join('\n');
    const { transactions } = parseWithProfile(csv, tradeRepublicProfile);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].name).toBe('iShares MSCI World, Acc');
  });
});

// ── TR real deposit/tax type mappings (Commit 1C) ────────

describe('TR real deposit/tax/withdrawal type mappings', () => {
  const mkCsv = (type: string) =>
    [
      'transaction_id;date;type;category;name;symbol;shares;price;amount;fee;tax;currency;fx_rate',
      `tx-new;2024-07-01;${type};;Test Row;;0;0;100;0;0;EUR;`,
    ].join('\n');

  it('CUSTOMER_INPAYMENT maps to DEPOSIT (mapped, not unmapped)', () => {
    const { transactions, unmapped } = parseWithProfile(
      mkCsv('CUSTOMER_INPAYMENT'),
      tradeRepublicProfile,
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe(TxType.DEPOSIT);
    expect(unmapped).toHaveLength(0);
  });

  it('TRANSFER_INBOUND maps to DEPOSIT (mapped, not unmapped)', () => {
    const { transactions, unmapped } = parseWithProfile(
      mkCsv('TRANSFER_INBOUND'),
      tradeRepublicProfile,
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe(TxType.DEPOSIT);
    expect(unmapped).toHaveLength(0);
  });

  it('TRANSFER_INSTANT_INBOUND maps to DEPOSIT (mapped, not unmapped)', () => {
    const { transactions, unmapped } = parseWithProfile(
      mkCsv('TRANSFER_INSTANT_INBOUND'),
      tradeRepublicProfile,
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe(TxType.DEPOSIT);
    expect(unmapped).toHaveLength(0);
  });

  it('TAX_OPTIMIZATION maps to TAX (mapped, not unmapped)', () => {
    const { transactions, unmapped } = parseWithProfile(
      mkCsv('TAX_OPTIMIZATION'),
      tradeRepublicProfile,
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe(TxType.TAX);
    expect(unmapped).toHaveLength(0);
  });

  it('CUSTOMER_OUTPAYMENT maps to WITHDRAWAL', () => {
    const { transactions, unmapped } = parseWithProfile(
      mkCsv('CUSTOMER_OUTPAYMENT'),
      tradeRepublicProfile,
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe(TxType.WITHDRAWAL);
    expect(unmapped).toHaveLength(0);
  });

  it('TRANSFER_OUTBOUND maps to WITHDRAWAL', () => {
    const { transactions, unmapped } = parseWithProfile(
      mkCsv('TRANSFER_OUTBOUND'),
      tradeRepublicProfile,
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe(TxType.WITHDRAWAL);
    expect(unmapped).toHaveLength(0);
  });
});
