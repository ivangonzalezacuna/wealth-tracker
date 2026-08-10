/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import type { KnownSecuritySuggestions } from '../model/securitySuggestions';
import {
  bindSecuritySuggestionAutoFill,
  filterKnownSecuritySuggestions,
  populateSecuritySuggestionLists,
  securitySuggestionPairLooksCoherent,
} from './securitySuggestionFields';

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

function renderFields(): HTMLElement {
  document.body.innerHTML = `
    <div>
      <input id="isin" list="isin-list">
      <datalist id="isin-list"></datalist>
      <input id="name" list="name-list">
      <datalist id="name-list"></datalist>
    </div>`;
  return document.body.firstElementChild as HTMLElement;
}

describe('securitySuggestionFields', () => {
  it('filters excluded ISINs before list population', () => {
    const overlay = renderFields();
    const filtered = filterKnownSecuritySuggestions(suggestions, ['IE00AAA']);

    populateSecuritySuggestionLists(
      overlay,
      {
        isinInputId: 'isin',
        isinListId: 'isin-list',
        nameInputId: 'name',
        nameListId: 'name-list',
      },
      filtered,
    );

    expect(
      Array.from(overlay.querySelectorAll('#isin-list option')).map((el) =>
        el.getAttribute('value'),
      ),
    ).toEqual(['IE00BBB']);
    expect(
      Array.from(overlay.querySelectorAll('#name-list option')).map((el) =>
        el.getAttribute('value'),
      ),
    ).toEqual(['Beta Fund']);
  });

  it('supports overwrite and preserve autofill modes', () => {
    const overlay = renderFields();
    const name = overlay.querySelector('#name') as HTMLInputElement;
    const isin = overlay.querySelector('#isin') as HTMLInputElement;

    bindSecuritySuggestionAutoFill(
      overlay,
      {
        isinInputId: 'isin',
        isinListId: 'isin-list',
        nameInputId: 'name',
        nameListId: 'name-list',
      },
      suggestions,
    );

    name.value = 'Already set';
    isin.value = 'IE00AAA';
    isin.dispatchEvent(new Event('change', { bubbles: true }));
    expect(name.value).toBe('Already set');

    bindSecuritySuggestionAutoFill(
      overlay,
      {
        isinInputId: 'isin',
        isinListId: 'isin-list',
        nameInputId: 'name',
        nameListId: 'name-list',
      },
      suggestions,
      { overwritePeerField: true },
    );

    isin.dispatchEvent(new Event('change', { bubbles: true }));
    expect(name.value).toBe('Alpha Fund');
  });

  it('detects mismatched known name and ISIN pairs', () => {
    expect(securitySuggestionPairLooksCoherent('IE00AAA', 'Alpha Fund', suggestions)).toBe(true);
    expect(securitySuggestionPairLooksCoherent('IE00AAA', 'Beta Fund', suggestions)).toBe(false);
  });
});
