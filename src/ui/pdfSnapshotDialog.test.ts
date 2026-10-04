/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pdfSnapshotDialog } from './pdfSnapshotDialog';
import { readStatement } from '../import/readPdf';
import type { Statement } from '../import/pdfStatement';

vi.mock('../import/readPdf', () => ({ readStatement: vi.fn() }));
const statement: Statement = {
  valuationDate: '2026-09-30',
  cash: 100,
  brokerage: 200,
  total: 300,
  holdings: [],
};
const opts = {
  accounts: [
    { id: 'cash', label: '<Cash>', moneyType: 'cash' },
    { id: 'broker', label: 'Broker', moneyType: 'investment', isPrimaryInvestment: true },
  ],
  knownIsins: [],
  snapshots: [],
};
function chooseFile() {
  const input = document.querySelector<HTMLInputElement>('#pdf-file')!;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File(['%PDF-'], 'private.pdf')],
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const click = (id: string) => document.querySelector<HTMLButtonElement>(id)!.click();
afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  vi.resetAllMocks();
});
describe('PDF confirmation dialog', () => {
  it('aborts and returns no snapshot on dismissal while loading', async () => {
    vi.mocked(readStatement).mockReturnValue(new Promise(() => {}));
    const result = pdfSnapshotDialog(opts);
    chooseFile();
    const signal = vi.mocked(readStatement).mock.calls[0][1];
    click('#pdf-cancel');
    expect(await result).toBeNull();
    expect(signal.aborted).toBe(true);
    expect(document.querySelector('.pdf-dialog-overlay')).toBeNull();
  });
  it('does not leak errors or enable writes after extraction failure', async () => {
    vi.mocked(readStatement).mockRejectedValue(new Error('secret account number'));
    const result = pdfSnapshotDialog(opts);
    chooseFile();
    await settle();
    expect(document.body.textContent).not.toContain('secret account number');
    expect(document.querySelector<HTMLButtonElement>('#pdf-confirm')!.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#pdf-review')!.disabled).toBe(true);
    click('#pdf-cancel');
    expect(await result).toBeNull();
  });
  it('ignores stale file results and requires mapping, preview and final confirmation', async () => {
    let finish!: (s: Statement) => void;
    vi.mocked(readStatement)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValueOnce(statement);
    const result = pdfSnapshotDialog(opts);
    chooseFile();
    chooseFile();
    await settle();
    finish({ ...statement, cash: 999 });
    await settle();
    expect(document.querySelector('#pdf-status')!.textContent).not.toContain('999');
    expect(document.querySelector<HTMLButtonElement>('#pdf-confirm')!.disabled).toBe(true);
    click('#pdf-review');
    expect(document.querySelector<HTMLButtonElement>('#pdf-confirm')!.disabled).toBe(true);
    const cash = document.querySelector<HTMLSelectElement>('#pdf-cash')!;
    cash.value = 'cash';
    const investment = document.querySelector<HTMLSelectElement>('#pdf-investment')!;
    investment.value = 'broker';
    click('#pdf-review');
    expect(document.querySelector('#pdf-preview')!.textContent).toContain('<Cash>');
    expect(document.querySelector('Cash')).toBeNull();
    expect(document.querySelector<HTMLButtonElement>('#pdf-confirm')!.disabled).toBe(false);
    cash.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.querySelector<HTMLButtonElement>('#pdf-confirm')!.disabled).toBe(true);
    click('#pdf-review');
    click('#pdf-confirm');
    expect(await result).toEqual({ date: '2026-09', cash: 100, broker: 200 });
  });
});
