// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  closeCsvImportPreview,
  isCsvImportPreviewOpen,
  nothingNewNotice,
  openCsvImportPreview,
  type CsvImportHost,
} from './csvImportPanel';
import { builtInProfiles } from '../import/profiles/index';
import type { ImportProfile, Transaction } from '../types';

const tr = builtInProfiles.find((p) => p.id === 'traderepublic') ?? builtInProfiles[0];

const HEADER =
  'transaction_id,date,type,category,name,symbol,shares,price,amount,fee,tax,currency,fx_rate';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');
const BUY_1 = 'b1,2026-01-10,BUY,TRADING,World ETF,IE00B4L5Y983,2,100,-200,0,0,EUR,1';
const SELL_1 = 's1,2026-02-10,SELL,TRADING,World ETF,IE00B4L5Y983,5,100,500,0,0,EUR,1';
const DIV_1 = 'd1,2026-03-10,DIVIDEND,Dividende,World ETF,IE00B4L5Y983,,,3.5,0,0,EUR,1';
const ODD_1 = 'x1,2026-03-11,CRYPTO_REWARD,Reward,Coin,,,,1,0,0,EUR,1';

const storedBuy = {
  id: 'b1',
  date: '2026-01-10',
  type: 'BUY',
  name: 'World ETF',
  isin: 'IE00B4L5Y983',
  shares: 2,
  price: 100,
  amount: -200,
  fee: 0,
  tax: 0,
  currency: 'EUR',
  fxRate: 1,
  source: tr.id,
} as Transaction;

function makeHost(existing: Transaction[] = [], overrides: Partial<CsvImportHost> = {}) {
  return {
    profiles: builtInProfiles as ImportProfile[],
    existing: () => existing,
    blocked: () => '',
    confirm: vi.fn(async () => true),
    onOpenChange: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  } satisfies CsvImportHost;
}

function open(csvText: string, host: CsvImportHost, profile: ImportProfile | null = tr) {
  const container = document.getElementById('import-preview')!;
  openCsvImportPreview(container, { csvText, fileName: 'export.csv', profile }, host);
  return container;
}

const confirmBtn = () => document.getElementById('btn-confirm-import') as HTMLButtonElement;
const dataRows = () => [
  ...document.querySelectorAll<HTMLElement>('#import-preview-list .tx-row:not(.th)'),
];

describe('csvImportPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="import-preview" hidden></div>';
    localStorage.clear();
  });
  afterEach(() => closeCsvImportPreview());

  it('renders parsed rows in the ledger grid with pagination-ready markup', () => {
    const host = makeHost();
    const el = open(csv(BUY_1, DIV_1), host);
    expect(el.hidden).toBe(false);
    expect(isCsvImportPreviewOpen()).toBe(true);
    expect(host.onOpenChange).toHaveBeenCalledWith(true);
    expect(dataRows()).toHaveLength(2);
    expect(document.getElementById('import-preview-meta')!.textContent).toContain('export.csv');
    expect(document.getElementById('import-preview-meta')!.textContent).toContain('2 new');
    expect(confirmBtn().textContent).toBe('Import 2 transactions');
    expect(confirmBtn().disabled).toBe(false);
    expect(document.getElementById('import-pagination')).not.toBeNull();
  });

  it('shows stored rows without a checkbox and disables Confirm when nothing is new', () => {
    const tx = {
      id: 'b1',
      date: '2026-01-10',
      type: 'BUY',
      name: 'World ETF',
      isin: 'IE00B4L5Y983',
      shares: 2,
      price: 100,
      amount: -200,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 1,
      source: tr.id,
    } as Transaction;
    open(csv(BUY_1), makeHost([tx]));
    const row = dataRows()[0];
    expect(row.querySelector('.js-import-include')).toBeNull();
    expect(row.textContent).toContain('In ledger');
    expect(confirmBtn().disabled).toBe(true);
    expect(document.getElementById('import-preview-hint')!.textContent).toContain('Nothing new');
  });

  it('starts unknown types excluded and toggles them via the checkbox', () => {
    open(csv(DIV_1, ODD_1), makeHost());
    expect(confirmBtn().textContent).toBe('Import 1 transaction');
    const odd = dataRows().find((r) => r.textContent?.includes('Coin'))!;
    const box = odd.querySelector<HTMLInputElement>('.js-import-include')!;
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(confirmBtn().textContent).toBe('Import 2 transactions');
    expect(document.getElementById('import-issues')!.textContent).toContain('unknown types');
  });

  it('blocks Confirm while an included SELL exceeds holdings', () => {
    open(csv(BUY_1, SELL_1), makeHost());
    expect(confirmBtn().disabled).toBe(true);
    expect(document.getElementById('import-issues')!.textContent).toContain(
      'exceeds the shares held',
    );
    (document.getElementById('btn-exclude-oversells') as HTMLButtonElement).click();
    expect(confirmBtn().disabled).toBe(false);
    expect(confirmBtn().textContent).toBe('Import 1 transaction');
  });

  it('asks for a format when none was detected', () => {
    open(csv(BUY_1), makeHost(), null);
    expect(document.getElementById('import-issues')!.textContent).toContain('detect the format');
    expect(document.getElementById('import-preview-body')!.hidden).toBe(true);
    const select = document.getElementById('import-profile-select') as HTMLSelectElement;
    select.value = tr.id;
    select.dispatchEvent(new Event('change'));
    expect(dataRows()).toHaveLength(1);
    expect(confirmBtn().disabled).toBe(false);
  });

  it('keeps a dismissed date warning hidden across re-renders', () => {
    open(csv(DIV_1, 'bad,32.13.2026,DIVIDEND,Dividende,X,IE00B4L5Y983,,,1,0,0,EUR,1'), makeHost());
    expect(document.getElementById('import-date-warn')).not.toBeNull();
    (document.getElementById('btn-dismiss-date-warn') as HTMLButtonElement).click();
    expect(document.getElementById('import-date-warn')).toBeNull();
    const box = dataRows()[0].querySelector<HTMLInputElement>('.js-import-include')!;
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.getElementById('import-date-warn')).toBeNull();
  });

  it('filters by status chip and search', () => {
    open(csv(BUY_1, DIV_1, ODD_1), makeHost());
    (document.querySelector('[data-import-status="review"]') as HTMLButtonElement).click();
    expect(dataRows()).toHaveLength(1);
    expect(document.querySelector('[data-import-status="excluded"]')).toBeNull();
    (document.querySelector('[data-import-status=""]') as HTMLButtonElement).click();
    const search = document.getElementById('import-search') as HTMLInputElement;
    search.value = 'dividend';
    search.dispatchEvent(new Event('input'));
    expect(dataRows()).toHaveLength(1);
  });

  it('opens on the New filter when some rows are already in the ledger', () => {
    open(csv(BUY_1, DIV_1), makeHost([storedBuy]));
    const active = document.querySelector('#import-status-filter [aria-pressed="true"]');
    expect(active?.getAttribute('data-import-status')).toBe('new');
    expect(dataRows()).toHaveLength(1);
    expect(dataRows()[0].textContent).toContain('Dividend');
  });

  it('opens on All when every row is new', () => {
    open(csv(BUY_1, DIV_1), makeHost());
    const active = document.querySelector('#import-status-filter [aria-pressed="true"]');
    expect(active?.getAttribute('data-import-status')).toBe('');
  });

  it('keeps unchecked rows visible in the New and Needs review views', () => {
    open(csv(BUY_1, DIV_1, ODD_1), makeHost());
    (document.querySelector('[data-import-status="new"]') as HTMLButtonElement).click();
    expect(dataRows()).toHaveLength(3);
    const box = dataRows()[0].querySelector<HTMLInputElement>('.js-import-include')!;
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(dataRows()).toHaveLength(3);
    expect(dataRows()[0].classList.contains('import-row-excluded')).toBe(true);
    (document.querySelector('[data-import-status="review"]') as HTMLButtonElement).click();
    const odd = dataRows()[0].querySelector<HTMLInputElement>('.js-import-include')!;
    odd.checked = true;
    odd.dispatchEvent(new Event('change', { bubbles: true }));
    expect(dataRows()).toHaveLength(1);
  });

  it('shows a tri-state header checkbox and a selection line', () => {
    open(csv(BUY_1, DIV_1, ODD_1), makeHost());
    const header = () =>
      document.querySelector<HTMLInputElement>('#import-preview-list .js-import-include-page')!;
    const count = () => document.getElementById('import-selection-count')!.textContent;
    const selectBtn = document.getElementById('btn-import-select') as HTMLButtonElement;
    const clearBtn = document.getElementById('btn-import-clear') as HTMLButtonElement;
    expect(header().indeterminate).toBe(true);
    expect(count()).toBe('2 of 3 new rows selected');
    expect(selectBtn.textContent).toBe('Select all');
    selectBtn.click();
    expect(header().checked).toBe(true);
    expect(header().indeterminate).toBe(false);
    expect(count()).toBe('3 of 3 new rows selected');
    expect(selectBtn.disabled).toBe(true);
    clearBtn.click();
    expect(count()).toBe('0 of 3 new rows selected');
    expect(dataRows()).toHaveLength(3);
    expect(confirmBtn().disabled).toBe(true);
    const search = document.getElementById('import-search') as HTMLInputElement;
    search.value = 'dividend';
    search.dispatchEvent(new Event('input'));
    expect(selectBtn.textContent).toBe('Select 1 shown');
    expect(clearBtn.textContent).toBe('Clear shown');
    selectBtn.click();
    expect(count()).toBe('1 of 3 new rows selected');
  });

  it('confirms with the included new rows and closes', async () => {
    const host = makeHost();
    const el = open(csv(BUY_1, DIV_1, ODD_1), host);
    confirmBtn().click();
    await vi.waitFor(() => expect(isCsvImportPreviewOpen()).toBe(false));
    expect(host.confirm).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(host.confirm).mock.calls[0][0];
    expect(arg.rows.map((t) => t.id)).toEqual(['b1', 'd1']);
    expect(arg.excludedCount).toBe(1);
    expect(el.hidden).toBe(true);
    expect(host.onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('stays open when the host rejects the import', async () => {
    const host = makeHost([], { confirm: vi.fn(async () => false) });
    open(csv(BUY_1), host);
    confirmBtn().click();
    await vi.waitFor(() => expect(host.confirm).toHaveBeenCalled());
    await vi.waitFor(() => expect(confirmBtn().disabled).toBe(false));
    expect(isCsvImportPreviewOpen()).toBe(true);
  });

  it('reports a file whose rows are all stored, so the preview can be skipped', () => {
    const src = (text: string) => ({ csvText: text, fileName: 'export.csv', profile: tr });
    expect(nothingNewNotice(src(csv(BUY_1)), [storedBuy])).toBe(
      'Nothing new in export.csv. Its only row is already in the ledger.',
    );
    expect(nothingNewNotice(src(csv(BUY_1.replace('-200', '-201'))), [storedBuy])).toContain(
      '1 row differs from the stored version',
    );
    expect(nothingNewNotice(src(csv(BUY_1, DIV_1)), [storedBuy])).toBeNull();
    expect(
      nothingNewNotice(
        src(csv(BUY_1, 'bad,32.13.2026,DIVIDEND,Dividende,X,IE00B4L5Y983,,,1,0,0,EUR,1')),
        [storedBuy],
      ),
    ).toBeNull();
    expect(nothingNewNotice({ ...src(csv(BUY_1)), profile: null }, [storedBuy])).toBeNull();
  });

  it('cancels without saving', () => {
    const host = makeHost();
    open(csv(BUY_1), host);
    (document.getElementById('btn-cancel-import') as HTMLButtonElement).click();
    expect(isCsvImportPreviewOpen()).toBe(false);
    expect(host.onCancel).toHaveBeenCalled();
    expect(host.confirm).not.toHaveBeenCalled();
  });
});
