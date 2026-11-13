import { describe, expect, it } from 'vitest';
import { renderSignature, type RenderInputs } from './renderSignature';

function inputs(overrides: Partial<RenderInputs> = {}): RenderInputs {
  return {
    snaps: [{ date: '2026-01', acct1: 1000 }],
    txs: [],
    pd: null,
    importMeta: {},
    accounts: [{ id: 'acct1', label: 'Broker' } as RenderInputs['accounts'][number]],
    holdings: [],
    settings: { costBasisMethod: 'fifo', nw_inflation_rate: '2' },
    readOnly: false,
    ...overrides,
  };
}

describe('renderSignature', () => {
  it('is stable for equal data loaded into fresh objects', () => {
    expect(renderSignature(inputs())).toBe(renderSignature(structuredClone(inputs())));
  });

  it('ignores settings key order', () => {
    const reordered = inputs({ settings: { nw_inflation_rate: '2', costBasisMethod: 'fifo' } });
    expect(renderSignature(reordered)).toBe(renderSignature(inputs()));
  });

  it('ignores UI-only settings such as the collapse state backup', () => {
    const withCollapse = inputs({
      settings: { ...inputs().settings, ui_collapse_state: '{"card:accounts":true}' },
    });
    expect(renderSignature(withCollapse)).toBe(renderSignature(inputs()));
  });

  it('accepts bigint row ids and tells them apart', () => {
    const tx = (id: bigint) => ({ id }) as unknown as RenderInputs['txs'][number];
    expect(renderSignature(inputs({ txs: [tx(1n)] }))).toBe(
      renderSignature(inputs({ txs: [tx(1n)] })),
    );
    expect(renderSignature(inputs({ txs: [tx(1n)] }))).not.toBe(
      renderSignature(inputs({ txs: [tx(2n)] })),
    );
  });

  it.each<[string, Partial<RenderInputs>]>([
    ['a snapshot value', { snaps: [{ date: '2026-01', acct1: 1001 }] }],
    ['a rendered setting', { settings: { costBasisMethod: 'fifo', nw_inflation_rate: '3' } }],
    ['the account list', { accounts: [] }],
    ['the import metadata', { importMeta: { last_import: '2026-01-02' } }],
    ['read-only mode', { readOnly: true }],
  ])('changes when %s changes', (_label, change) => {
    expect(renderSignature(inputs(change))).not.toBe(renderSignature(inputs()));
  });
});
