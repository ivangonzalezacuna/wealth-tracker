/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { snapshotDialog, type SnapshotDialogOptions } from './snapshotDialog';
import { extractSnapshotPdf } from '../import/snapshotPdf';
import { parseTradeRepublicStatement } from '../import/snapshotTradeRepublic';
import {
  FAKE_ISINS,
  fakeIsin,
  syntheticPages,
} from '../../tests/fixtures/snapshot-import/synthetic';
import type { Account, Snapshot } from '../types';
import type { SnapshotMapping } from '../import/snapshotMapping';
import { snapshotParsers } from '../import/snapshotParsers';
import {
  fictionalBalanceParser,
  fictionalBalanceLines,
} from '../../tests/fixtures/snapshot-import/balanceParser';
import { positionKey, coverageKey } from '../model/snapshotPositions';

vi.mock('../import/snapshotPdf', () => ({ extractSnapshotPdf: vi.fn() }));
const extract = vi.mocked(extractSnapshotPdf);
const statement = parseTradeRepublicStatement(syntheticPages());
const accounts: Account[] = [
  { id: 'cash', label: 'Fake cash', moneyType: 'cash' },
  {
    id: 'broker',
    label: 'Fake broker',
    moneyType: 'investment',
    isPrimaryInvestment: true,
    currency: 'USD',
  },
];
const combined: SnapshotMapping = { mode: 'combined', securitiesAccount: 'broker' };
function input(selector: string, value: string) {
  const element = document.querySelector<HTMLInputElement>(selector)!;
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
function click(selector: string) {
  document.querySelector<HTMLElement>(selector)!.click();
}
function open(saved?: SnapshotMapping, overrides: Partial<SnapshotDialogOptions> = {}) {
  let mapping = saved;
  const save = vi.fn(async (_type: string, value: SnapshotMapping) => {
    mapping = value;
  });
  const review = vi.fn(async (draft: Snapshot, currencies: Record<string, string>) => {
    const snapshot = { ...draft };
    for (const [key, value] of Object.entries(snapshot)) {
      if (typeof value === 'number' && currencies[key] === 'USD') snapshot[key] = value * 0.5;
    }
    return { snapshot };
  });
  const result = snapshotDialog({
    accounts,
    holdings: {},
    onReview: review,
    importMapping: () => mapping,
    onSaveImportMapping: save,
    ...overrides,
  });
  input('#snapd-date', '2024-01');
  input('#snapd-acc-cash', '25');
  return { result, review, save };
}
function chooseFile() {
  const file = document.querySelector<HTMLInputElement>('#snapd-pdf-file')!;
  Object.defineProperty(file, 'files', {
    configurable: true,
    value: [new File(['fake'], 'fictional.pdf')],
  });
  file.dispatchEvent(new Event('change'));
}
async function upload(value = structuredClone(statement)) {
  extract.mockResolvedValueOnce(value);
  chooseFile();
  await vi.waitFor(() =>
    expect(document.querySelector('.snap-pdf-source')!.textContent).toContain('2024-01-31'),
  );
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLButtonElement>('.js-snapd-submit')!.disabled).toBe(false),
  );
}
async function filled() {
  await vi.waitFor(() =>
    expect(document.querySelector('.snap-pdf-status')!.textContent).toContain(
      'filled automatically',
    ),
  );
}
async function review() {
  click('.js-snapd-submit');
  await vi.waitFor(() =>
    expect(document.querySelector('.js-snapd-submit')!.textContent).toBe('Save snapshot'),
  );
}
afterEach(() => {
  snapshotParsers.splice(1);
  document.querySelector<HTMLElement>('.js-snapd-cancel')?.click();
  document.body.replaceChildren();
  vi.resetAllMocks();
});

describe('single-review PDF import', () => {
  it('isolates scoped shared-ISIN imports, repeated replacement, coverage and Undo by account', async () => {
    let destination: SnapshotMapping = { mode: 'positions', securitiesAccount: 'broker' };
    const host = open(undefined, {
      scopedValuations: true,
      accounts: [...accounts, { id: 'france', label: 'France', moneyType: 'investment' }],
      importMapping: () => destination,
      prefill: {
        date: '2024-01',
        cash: 25,
        broker: 10000,
        france: 10000,
        [positionKey('broker', FAKE_ISINS[0])]: 10,
        [positionKey('france', FAKE_ISINS[0])]: 20,
        [coverageKey('broker')]: 1,
        [coverageKey('france')]: 1,
      },
    });
    const value = (accountId: string, isin = FAKE_ISINS[0]) =>
      document.querySelector<HTMLInputElement>(
        `[data-position-account="${accountId}"][data-etf-isin="${isin}"]`,
      )!;
    await upload();
    await filled();
    expect(value('broker').value).toBe(String(statement.positions[0].value));
    expect(value('france').value).toBe('20');
    expect(
      document.querySelector<HTMLSelectElement>('[data-coverage-account="broker"]')!.value,
    ).toBe('0');
    destination = { mode: 'positions', securitiesAccount: 'france' };
    await upload();
    await filled();
    expect(value('broker').value).toBe(String(statement.positions[0].value));
    expect(value('france').value).toBe(String(statement.positions[0].value));
    input('[data-position-account="france"][data-etf-isin="' + FAKE_ISINS[0] + '"]', '30');
    click('.snap-pdf-undo');
    expect(value('france').value).toBe('30');
    expect(value('broker').value).toBe(String(statement.positions[0].value));
    expect(document.querySelectorAll('[data-position-account="france"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-position-account="broker"]')).toHaveLength(
      statement.positions.length,
    );
    expect(
      document.querySelector<HTMLSelectElement>('[data-coverage-account="france"]')!.value,
    ).toBe('0');
    await upload();
    await filled();
    expect(document.querySelectorAll('[data-position-account="france"]')).toHaveLength(
      statement.positions.length,
    );
    await upload();
    await filled();
    expect(document.querySelectorAll('[data-position-account="france"]')).toHaveLength(
      statement.positions.length,
    );
    await review();
    expect(host.review.mock.calls[0][0]).toMatchObject({
      [positionKey('broker', FAKE_ISINS[0])]: statement.positions[0].value,
      [positionKey('france', FAKE_ISINS[0])]: statement.positions[0].value,
    });
    expect(host.review.mock.calls[0][1]).toMatchObject({
      [positionKey('broker', FAKE_ISINS[0])]: 'EUR',
      [positionKey('france', FAKE_ISINS[0])]: 'EUR',
    });
  });

  it('offers historical non-primary investment destinations', async () => {
    const historical: Account = {
      id: 'former',
      label: 'Former account',
      moneyType: 'investment',
      closedPeriods: [{ closedFromMonth: '2024-02' }],
    };
    open(undefined, { scopedValuations: true, accounts: [...accounts, historical] });
    await upload();
    expect(document.querySelector('[data-mapping-primary] option[value="former"]')).not.toBeNull();
    input('[data-mapping-primary]', 'former');
    input('[data-mapping-mode]', 'positions');
    click('.snap-pdf-save');
    await filled();
    expect(document.querySelectorAll('[data-position-account="former"]')).toHaveLength(
      statement.positions.length,
    );
  });
  it('rejects closed-month positions-only imports even when all imported values are zero', async () => {
    const former: Account = {
      id: 'former',
      label: 'Former account',
      moneyType: 'investment',
      closedPeriods: [{ closedFromMonth: '2024-01' }],
    };
    open(
      { mode: 'positions', securitiesAccount: 'former' },
      {
        scopedValuations: true,
        accounts: [...accounts, former],
      },
    );
    await upload({
      ...statement,
      positions: statement.positions.map((p) => ({ ...p, value: 0 })),
    });
    expect(document.querySelector('.snap-pdf-error')!.textContent).toContain('closed');
    expect(document.querySelectorAll('[data-position-account="former"]')).toHaveLength(0);
    expect(document.querySelector('[data-mapping-primary] option[value="former"]')).toBeNull();
  });

  it('rechecks imported zero positions against a lifecycle change before Review', async () => {
    let live: Account[] = [...accounts];
    open(
      { mode: 'positions', securitiesAccount: 'broker' },
      {
        scopedValuations: true,
        importAccounts: () => live,
        prefill: { date: '2024-01', cash: 25, broker: 0 },
      },
    );
    await upload({
      ...statement,
      positions: statement.positions.map((p) => ({ ...p, value: 0 })),
    });
    await filled();
    live = live.map((a) =>
      a.id === 'broker'
        ? {
            ...a,
            closedPeriods: [{ closedFromMonth: '2024-01' }],
          }
        : a,
    );
    click('.js-snapd-submit');
    await vi.waitFor(() =>
      expect(document.querySelector('#snapd-review-err')!.textContent).toContain(
        'closed in the statement month',
      ),
    );
  });
  it('connects a registered savings report to setup, remembered mapping, review and Undo without a primary investment account', async () => {
    snapshotParsers.push(fictionalBalanceParser);
    const host = open(undefined, {
      accounts: [accounts[0]],
      prefill: { date: '2024-01', cash: 25 },
      copiedFromMonth: '2023-12',
    });
    const value = fictionalBalanceParser.parse(syntheticPages([fictionalBalanceLines]));
    await upload(value);
    expect(document.querySelector('[data-mapping-primary]')).toBeNull();
    input('[data-mapping-balance="closing"]', 'cash');
    click('.snap-pdf-save');
    await filled();
    expect(host.save).toHaveBeenCalledWith(fictionalBalanceParser.id, {
      mode: 'balances',
      balanceAccounts: { closing: 'cash' },
    });
    expect(document.querySelector<HTMLInputElement>('#snapd-acc-cash')!.value).toBe('1234.56');
    expect(document.querySelectorAll('[data-etf-isin]')).toHaveLength(0);
    expect(document.querySelector('.snap-pdf-status')!.textContent).toContain('1 account balances');
    await review();
    expect(host.review.mock.calls[0][1]).toEqual({ cash: 'EUR' });
    expect(document.querySelector('.snapd-review')!.textContent).toContain(
      'Fictional savings report',
    );
    expect(document.querySelector('.snapd-review')!.textContent).not.toContain('Trade Republic');
    expect(document.querySelector('.snapd-review')!.textContent).not.toContain(
      'Account balances were retained',
    );
    click('.js-snapd-back');
    click('.snap-pdf-undo');
    expect(document.querySelector<HTMLInputElement>('#snapd-acc-cash')!.value).toBe('25');
    await upload(value);
    expect(host.save).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLInputElement>('#snapd-acc-cash')!.value).toBe('1234.56');
    await review();
    click('.js-snapd-submit');
    expect(await host.result).toMatchObject({ cash: 1234.56 });
  });
  it('marks a refreshed equal PDF value as Updated and restores Copied on Undo', async () => {
    open(combined, {
      prefill: { date: '2024-01', broker: 3707.62, cash: 25 },
      copiedFromMonth: '2023-12',
    });
    const badge = () =>
      document
        .querySelector('#snapd-acc-broker')!
        .parentElement!.querySelector('.snap-field-status')!.textContent;
    expect(badge()).toBe('Copied');
    await upload();
    expect(badge()).toBe('Updated');
    const broker = document.querySelector<HTMLInputElement>('#snapd-acc-broker')!;
    expect(document.body.textContent).not.toContain('PDF value: EUR');
    expect(document.querySelector('.snap-pdf-currency')).toBeNull();
    expect(broker.title).toContain('This field remains in EUR');
    expect(broker.getAttribute('aria-description')).toContain('Imported EUR value');
    expect(broker.dataset.pdfCurrency).toBe('EUR');
    click('.snap-pdf-undo');
    expect(badge()).toBe('Copied');
    expect(broker.title).not.toContain('This field remains in EUR');
    expect(broker.hasAttribute('aria-description')).toBe(false);
  });

  it('sets up once, replaces typed values automatically, reimports without duplicates and saves only after Review', async () => {
    const host = open();
    input('#snapd-acc-broker', '9000');
    await upload();
    expect(document.querySelectorAll('[data-pdf-select]')).toHaveLength(0);
    click('.snap-pdf-save');
    await filled();
    expect(host.save).toHaveBeenCalledWith('trade-republic:valuation', combined);
    expect(host.review).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>('#snapd-acc-broker')!.value).toBe('3707.62');
    expect(
      document
        .querySelector('#snapd-acc-broker')!
        .parentElement!.querySelector('.snap-field-status')!.textContent,
    ).toBe('Updated');
    await upload();
    expect(host.save).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.snap-etf-extra')).toHaveLength(7);
    await review();
    expect(host.review.mock.calls[0][1]).toMatchObject({
      broker: 'EUR',
      cash: 'EUR',
      [`etf_${FAKE_ISINS[0]}`]: 'EUR',
    });
    expect(document.querySelector('.snapd-review')!.textContent).toContain('Previously 9000 USD');
    expect(document.querySelector('.snapd-review')!.textContent).toContain('Fictional fund');
    expect(document.querySelectorAll('.snapd-review [data-field-status="imported"]')).toHaveLength(
      8,
    );
    click('.js-snapd-back');
    expect(document.querySelector<HTMLInputElement>('#snapd-acc-cash')!.value).toBe('25');
    await review();
    click('.js-snapd-submit');
    expect(await host.result).toMatchObject({
      date: '2024-01',
      broker: 3707.62,
      cash: 25,
      [`etf_${FAKE_ISINS[0]}`]: 101.11,
    });
  });
  it('undoes only untouched imported fields and preserves subsequent edits', async () => {
    open(combined);
    input('#snapd-acc-broker', '9000');
    await upload();
    input(`[data-etf-isin="${FAKE_ISINS[0]}"]`, '22');
    input('#snapd-acc-cash', '50');
    click('.snap-pdf-undo');
    expect(document.querySelector<HTMLInputElement>('#snapd-acc-broker')!.value).toBe('9000');
    expect(
      document.querySelector<HTMLInputElement>('#snapd-acc-broker')!.dataset.pdfCurrency,
    ).toBeUndefined();
    expect(document.querySelectorAll('.snap-etf-extra')).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>('[data-etf-isin]')!.value).toBe('22');
    expect(document.querySelector<HTMLInputElement>('#snapd-acc-cash')!.value).toBe('50');
    expect(document.querySelector('.snap-pdf-status')!.textContent).toContain('later edited');
    expect(document.querySelector('.snap-pdf-source')!.textContent).toBe('');
  });
  it('blocks date mismatch, explicitly selects source month, then prevents relabelling', async () => {
    const host = open(combined);
    input('#snapd-date', '2024-02');
    await upload();
    expect(document.querySelector('.snap-pdf-error')!.textContent).toContain('does not match');
    expect(document.querySelectorAll('.snap-etf-extra')).toHaveLength(0);
    click('.snap-pdf-month');
    await filled();
    input('#snapd-date', '2024-02');
    click('.js-snapd-submit');
    expect(document.querySelector('#snapd-date-err')!.textContent).toContain('does not match');
    expect(host.review).not.toHaveBeenCalled();
  });
  it('cancels pending extraction, prevents Review during extraction and ignores stale completion', async () => {
    open(combined);
    input('#snapd-acc-broker', '1234');
    let resolve!: (value: typeof statement) => void;
    extract.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    chooseFile();
    expect(document.querySelector<HTMLButtonElement>('.js-snapd-submit')!.disabled).toBe(true);
    click('.snap-pdf-cancel');
    resolve(statement);
    await Promise.resolve();
    expect(document.querySelector<HTMLInputElement>('#snapd-acc-broker')!.value).toBe('1234');
    expect(document.querySelectorAll('.snap-etf-extra')).toHaveLength(0);
  });
  it('does not fill if preference persistence fails', async () => {
    const host = open();
    host.save.mockRejectedValueOnce(new Error('Database is busy'));
    await upload();
    click('.snap-pdf-save');
    await vi.waitFor(() =>
      expect(document.querySelector('.snap-pdf-error')!.textContent).toContain('Database is busy'),
    );
    expect(document.querySelectorAll('.snap-etf-extra')).toHaveLength(0);
  });
  it('clears source and mapping actions when a recognized import setup is cancelled', async () => {
    open();
    await upload();
    click('.snap-pdf-cancel');
    expect(document.querySelector<HTMLElement>('.snap-pdf-change')!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.snap-pdf-setup')!.hidden).toBe(true);
    expect(document.querySelector('.snap-pdf-source')!.textContent).toBe('');
  });
  it('does not fill when a pending mapping save completes after cancellation', async () => {
    const host = open();
    let resolve!: () => void;
    host.save.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    await upload();
    click('.snap-pdf-save');
    expect(document.querySelector<HTMLButtonElement>('.js-snapd-submit')!.disabled).toBe(true);
    expect(document.querySelector<HTMLSelectElement>('#snapd-pdf-mode')!.disabled).toBe(true);
    click('.snap-pdf-cancel');
    resolve();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLButtonElement>('.snap-pdf-choose')!.disabled).toBe(false),
    );
    expect(document.querySelectorAll('.snap-etf-extra')).toHaveLength(0);
  });
  it('revalidates live account eligibility and requests repair instead of applying stale mapping', async () => {
    open(combined, { importAccounts: () => accounts.filter((account) => account.id !== 'broker') });
    await upload();
    expect(document.querySelector('.snap-pdf-error')!.textContent).toContain('investment account');
    expect(document.querySelectorAll('.snap-etf-extra')).toHaveLength(0);
  });
  it('exposes invalid stored preferences and offers mapping repair', async () => {
    open(undefined, {
      importMapping: () => {
        throw new Error('Reset the invalid preferences in Settings.');
      },
    });
    await upload();
    expect(document.querySelector('.snap-pdf-error')!.textContent).toContain('Settings');
    expect(document.querySelector<HTMLElement>('.snap-pdf-setup')!.hidden).toBe(false);
    expect(document.querySelectorAll('.snap-etf-extra')).toHaveLength(0);
  });
  it('fills partial verified positions, retains native balances and warns in final Review', async () => {
    const host = open(combined);
    input('#snapd-acc-broker', '9000');
    await upload({ ...statement, total: undefined, cash: undefined, securities: undefined });
    await review();
    expect(host.review.mock.calls[0][1]).toMatchObject({
      broker: 'USD',
      [`etf_${FAKE_ISINS[0]}`]: 'EUR',
    });
    expect(document.querySelector('.snapd-review')!.textContent).toContain('not verified');
  });
  it.each([200, 1000])(
    'bulk-fills %i positions without approval controls and bounds initial review',
    async (count) => {
      open(combined);
      const positions = Array.from({ length: count }, (_, i) => ({
        isin: fakeIsin(i + 1),
        name: `Invented ETF ${i}`,
        value: 1,
        page: 1,
      }));
      await upload({ ...statement, positions, securities: count, cash: 10, total: count + 10 });
      expect(document.querySelectorAll('.snap-etf-extra')).toHaveLength(count);
      expect(document.querySelectorAll('[data-pdf-select]')).toHaveLength(0);
      await review();
      expect(document.querySelectorAll('[aria-label="ETF values"] > dl > div')).toHaveLength(10);
      const details = document.querySelector<HTMLDetailsElement>('.snapd-review-more')!;
      expect(details.open).toBe(false);
      input('#snapd-review-search', `Invented ETF ${count - 1}`);
      expect(details.querySelectorAll('[data-review-search]:not([hidden])')).toHaveLength(1);
    },
    15_000,
  );
});
