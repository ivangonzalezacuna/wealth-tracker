/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { holdingDialog } from './holdingDialog';
import type { Holding } from '../types';
import type { KnownSecuritySuggestions } from '../model/securitySuggestions';

function getOverlay() {
  return document.querySelector('.hold-dialog-overlay') as HTMLElement | null;
}

function getOptions(id: string): string[] {
  return Array.from(document.querySelectorAll(`#${id} option`)).map(
    (opt) => (opt as HTMLOptionElement).value,
  );
}

function setField(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el) el.value = value;
}

function getSubmit() {
  return document.querySelector('.js-holdd-submit') as HTMLButtonElement | null;
}

const suggestions: KnownSecuritySuggestions = {
  pairs: [
    { isin: 'IE00AAA', name: 'Alpha Fund' },
    { isin: 'IE00BBB', name: 'Beta Fund' },
  ],
  byIsin: {
    IE00AAA: { isin: 'IE00AAA', name: 'Alpha Fund' },
    IE00BBB: { isin: 'IE00BBB', name: 'Beta Fund' },
  },
  byName: {
    'alpha fund': { isin: 'IE00AAA', name: 'Alpha Fund' },
    'beta fund': { isin: 'IE00BBB', name: 'Beta Fund' },
  },
};

const existingHolding: Holding = {
  isin: 'IE00AAA',
  name: 'Alpha Fund',
  shortName: 'ALPHA',
  color: '#123456',
  acc: true,
  active: true,
  contribAmount: 0,
  contribInterval: 'monthly',
  assetClass: 'equity',
  region: 'developed',
  foldInto: '',
  order: 1,
};

describe('holdingDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    getOverlay()?.remove();
  });

  it('filters out already configured holdings from name and ISIN suggestions and autofill', () => {
    holdingDialog({ suggestions, existingIsins: ['IE00AAA'] });

    expect(getOptions('holdd-isin-list')).toEqual(['IE00BBB']);
    expect(getOptions('holdd-name-list')).toEqual(['Beta Fund']);

    setField('holdd-name', 'Alpha Fund');
    setField('holdd-isin', '');
    (document.getElementById('holdd-name') as HTMLInputElement).dispatchEvent(
      new Event('change', { bubbles: true }),
    );
    expect((document.getElementById('holdd-isin') as HTMLInputElement).value).toBe('');

    setField('holdd-name', 'Beta Fund');
    (document.getElementById('holdd-name') as HTMLInputElement).dispatchEvent(
      new Event('change', { bubbles: true }),
    );
    expect((document.getElementById('holdd-isin') as HTMLInputElement).value).toBe('IE00BBB');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('preserves the edited holding own ISIN/name pair', async () => {
    const p = holdingDialog({
      existing: existingHolding,
      suggestions,
      existingIsins: ['IE00BBB'],
    });

    expect(getOptions('holdd-isin-list')).toEqual(['IE00AAA']);
    expect(getOptions('holdd-name-list')).toEqual(['Alpha Fund']);

    getSubmit()!.click();
    const draft = await p;

    expect(draft?.isin).toBe('IE00AAA');
    expect(draft?.name).toBe('Alpha Fund');
  });
});
