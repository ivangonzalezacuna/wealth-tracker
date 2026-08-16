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
    { isin: 'IE00B4L5Y983', name: 'Alpha Fund' },
    { isin: 'IE00BKM4GZ66', name: 'Beta Fund' },
  ],
};

const existingHolding: Holding = {
  isin: 'IE00B4L5Y983',
  name: 'Alpha Fund',
  shortName: 'ALPHA',
  color: '#123456',
  acc: true,
  active: true,
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

    expect(getOptions('holdd-isin-list')).toEqual(['IE00B4L5Y983', 'IE00BKM4GZ66']);
    expect(getOptions('holdd-name-list')).toEqual(['Alpha Fund', 'Beta Fund']);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('filters autocomplete options by existing holdings isins', () => {
    holdingDialog({ suggestions, existingIsins: ['IE00B4L5Y983'] });
    expect(getOptions('holdd-isin-list')).toEqual(['IE00BKM4GZ66']);
    expect(getOptions('holdd-name-list')).toEqual(['Beta Fund']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('filters mixed-case suggestion isins by existing holdings isins', () => {
    holdingDialog({
      suggestions: {
        pairs: [
          { isin: 'ie00aaa', name: 'Alpha Fund' },
          { isin: 'IE00BKM4GZ66', name: 'Beta Fund' },
        ],
      },
      existingIsins: ['IE00AAA'],
    });
    expect(getOptions('holdd-isin-list')).toEqual(['IE00BKM4GZ66']);
    expect(getOptions('holdd-name-list')).toEqual(['Beta Fund']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('syncs ISIN/name fields when selecting a known ETF value', () => {
    holdingDialog({ suggestions });
    const isinInput = document.querySelector('#holdd-isin') as HTMLInputElement;
    isinInput.value = 'IE00BKM4GZ66';
    isinInput.dispatchEvent(new Event('change'));
    expect((document.querySelector('#holdd-isin') as HTMLInputElement).value).toBe('IE00BKM4GZ66');
    expect((document.querySelector('#holdd-name') as HTMLInputElement).value).toBe('Beta Fund');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('preserves the edited holding own ISIN/name pair on submit', async () => {
    const p = holdingDialog({
      existing: existingHolding,
      suggestions,
      existingIsins: ['IE00BKM4GZ66'],
    });

    getSubmit()!.click();
    const draft = await p;

    expect(draft?.isin).toBe('IE00B4L5Y983');
    expect(draft?.name).toBe('Alpha Fund');
  });

  it('preserves notes on submit when editing an existing holding with notes', async () => {
    const existingWithNotes: Holding = {
      ...existingHolding,
      notes: 'Switched index to FTSE All-World in Oct 2024',
    };
    const p = holdingDialog({ existing: existingWithNotes });

    const textarea = document.querySelector('#holdd-notes') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Switched index to FTSE All-World in Oct 2024');

    getSubmit()!.click();
    const draft = await p;

    expect(draft?.notes).toBe('Switched index to FTSE All-World in Oct 2024');
  });

  it('includes notes typed by the user in the submitted draft', async () => {
    const p = holdingDialog({ existing: existingHolding });

    (document.querySelector('#holdd-notes') as HTMLTextAreaElement).value =
      'New note about this holding';
    getSubmit()!.click();
    const draft = await p;

    expect(draft?.notes).toBe('New note about this holding');
  });

  it('omits notes from draft when notes field is empty', async () => {
    const p = holdingDialog({ existing: existingHolding });

    (document.querySelector('#holdd-notes') as HTMLTextAreaElement).value = '';
    getSubmit()!.click();
    const draft = await p;

    expect(draft?.notes).toBeUndefined();
  });

  it('blocks submit and shows ISIN format error when ISIN is invalid', async () => {
    const p = holdingDialog();
    (document.querySelector('#holdd-isin') as HTMLInputElement).value = 'IE00B4L5Y98A';
    (document.querySelector('#holdd-short-name') as HTMLInputElement).value = 'IWDA';
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    getSubmit()!.click();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect((document.querySelector('#holdd-isin-err') as HTMLElement).textContent).toContain(
      'Use 12-character ISIN format',
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
  });
});
