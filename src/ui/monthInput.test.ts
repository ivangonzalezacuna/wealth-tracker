/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { validateMonthInput, wireMonthInputs } from './monthInput';

describe('month input', () => {
  let input: HTMLInputElement;

  beforeEach(() => {
    document.body.innerHTML = `<div><input id="month" type="text" data-month-input
      min="2025-01" max="2035-06" aria-describedby="existing-hint"></div>`;
    input = document.querySelector('input')!;
    wireMonthInputs(document.body);
  });

  it('provides an associated fallback hint and live error, without duplicate binding', () => {
    wireMonthInputs(document.body);
    expect(input.placeholder).toBe('YYYY-MM');
    expect(input.getAttribute('aria-describedby')).toBe('existing-hint month-error month-hint');
    expect(document.querySelectorAll('.month-input-error')).toHaveLength(1);
    expect(document.getElementById('month-error')?.getAttribute('aria-live')).toBe('polite');
  });

  it.each(['2035-13', '2035-00', '35-06', '0000-01', 'June 2035'])(
    'rejects malformed fallback value %s',
    (value) => {
      input.value = value;
      input.dispatchEvent(new Event('blur'));
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.validationMessage).toContain('YYYY-MM');
      expect(document.getElementById('month-error')?.textContent).toBe(input.validationMessage);
    },
  );

  it('enforces inclusive bounds and clears obsolete errors on correction or clearing', () => {
    input.value = '2024-12';
    expect(validateMonthInput(input)).toBe(false);
    expect(input.validationMessage).toContain('2025-01 or later');
    input.value = '2035-07';
    expect(validateMonthInput(input)).toBe(false);
    expect(input.validationMessage).toContain('2035-06 or earlier');
    for (const value of ['2025-01', '2035-06', '']) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      expect(input.hasAttribute('aria-invalid')).toBe(false);
      expect(input.validationMessage).toBe('');
      expect(document.getElementById('month-error')?.textContent).toBe('');
    }
  });

  it('ignores disabled dates and detects incomplete native input', () => {
    Object.defineProperty(input, 'validity', { value: { badInput: true } });
    expect(validateMonthInput(input)).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    input.disabled = true;
    expect(validateMonthInput(input)).toBe(true);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(document.getElementById('month-error')?.textContent).toBe('');
  });

  it('does not add fallback guidance when native month input is supported', () => {
    document.body.innerHTML = '<div><input id="native" type="month" data-month-input></div>';
    wireMonthInputs(document.body);
    expect(document.querySelector('.month-input-hint')).toBeNull();
    expect(document.getElementById('native')?.getAttribute('aria-describedby')).toBe(
      'native-error',
    );
  });
});
