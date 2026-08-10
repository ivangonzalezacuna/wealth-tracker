/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { holdingDialog } from './holdingDialog';
import type { Holding } from '../types';
import type { SecuritySuggestions } from '../model/securitySuggestions';

function getOverlay() {
  return document.querySelector('.hold-dialog-overlay') as HTMLElement | null;
}

function getOptions(id: string): string[] {
  return Array.from(document.querySelectorAll(`#${id} option`)).map(
    (opt) => (opt as HTMLOptionElement).value,
  );
}

function getSubmit() {
  return document.querySelector('.js-holdd-submit') as HTMLButtonElement | null;
}

const suggestions: SecuritySuggestions = {
  pairs: [
    { isin: 'IE00AAA', name: 'Alpha Fund' },
    { isin: 'IE00BBB', name: 'Beta Fund' },
  ],
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

  it('populates ISIN and name autocomplete lists from suggestions', () => {
    holdingDialog({ suggestions });

    expect(getOptions('holdd-isin-list')).toEqual(['IE00AAA', 'IE00BBB']);
    expect(getOptions('holdd-name-list')).toEqual(['Alpha Fund', 'Beta Fund']);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('filters autocomplete options by existing holdings isins', () => {
    holdingDialog({ suggestions, existingIsins: ['IE00AAA'] });
    expect(getOptions('holdd-isin-list')).toEqual(['IE00BBB']);
    expect(getOptions('holdd-name-list')).toEqual(['Beta Fund']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('filters mixed-case suggestion isins by existing holdings isins', () => {
    holdingDialog({
      suggestions: {
        pairs: [
          { isin: 'ie00aaa', name: 'Alpha Fund' },
          { isin: 'IE00BBB', name: 'Beta Fund' },
        ],
      },
      existingIsins: ['IE00AAA'],
    });
    expect(getOptions('holdd-isin-list')).toEqual(['IE00BBB']);
    expect(getOptions('holdd-name-list')).toEqual(['Beta Fund']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('syncs ISIN/name fields when selecting a known ETF value', () => {
    holdingDialog({ suggestions });
    const isinInput = document.querySelector('#holdd-isin') as HTMLInputElement;
    isinInput.value = 'IE00BBB';
    isinInput.dispatchEvent(new Event('change'));
    expect((document.querySelector('#holdd-isin') as HTMLInputElement).value).toBe('IE00BBB');
    expect((document.querySelector('#holdd-name') as HTMLInputElement).value).toBe('Beta Fund');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('preserves the edited holding own ISIN/name pair on submit', async () => {
    const p = holdingDialog({
      existing: existingHolding,
      suggestions,
      existingIsins: ['IE00BBB'],
    });

    getSubmit()!.click();
    const draft = await p;

    expect(draft?.isin).toBe('IE00AAA');
    expect(draft?.name).toBe('Alpha Fund');
  });
});
