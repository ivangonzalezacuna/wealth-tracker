/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { attachMonthInput, isValidMonth, validateMonthInput } from './monthInput';

function setup(type = 'month', attributes = '') {
  document.body.innerHTML = `<label for="month">Target month</label><div><input id="month" type="${type}" value="2030-06" ${attributes}></div>`;
  const input = document.querySelector('input')!;
  attachMonthInput(input);
  return input;
}

describe('native month input', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it.each(['2026-01', '9999-12', '0001-01'])('accepts %s', (value) => {
    expect(isValidMonth(value)).toBe(true);
  });
  it.each(['0000-01', '2026-00', '2026-13', '2026-1', 'not a month'])('rejects %s', (value) => {
    expect(isValidMonth(value)).toBe(false);
  });
  it('preserves the native type and exposes the actual input', () => {
    const input = setup();
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    delete input.dataset.monthInput;
    attachMonthInput(input);
    expect(input.type).toBe('month');
    expect(input.getAttribute('aria-hidden')).toBeNull();
    expect(input.tabIndex).toBe(0);
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });
  it('adds accessible fallback guidance once without changing its value', () => {
    const input = setup('text', 'aria-describedby="original-help"');
    attachMonthInput(input);
    expect(input.placeholder).toBe('YYYY-MM');
    expect(input.value).toBe('2030-06');
    expect(document.querySelectorAll('.month-input-help')).toHaveLength(1);
    expect(document.querySelector<HTMLElement>('.month-input-help')!.hidden).toBe(false);
    expect(input.getAttribute('aria-describedby')).toContain('original-help');
    expect(input.getAttribute('aria-describedby')).toContain('month-input-');
  });
  it('validates text fallback bounds and clears corrected errors while typing', () => {
    const input = setup('text', 'min="2030-04" max="2030-08"');
    input.value = '2030-09';
    input.dispatchEvent(new Event('change'));
    expect(input.validationMessage).toContain('2030-08');
    input.value = '2030-03';
    expect(validateMonthInput(input)).toBe(false);
    expect(input.validationMessage).toContain('2030-04');
    input.value = '2030-13';
    expect(validateMonthInput(input)).toBe(false);
    expect(input.validationMessage).toContain('YYYY-MM');
    input.value = '2030-07';
    input.dispatchEvent(new Event('input'));
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.validity.valid).toBe(true);
    expect(document.querySelector('.month-input-error')!.textContent).toBe('');
  });
  it('keeps optional clearing and required/disabled states', () => {
    const input = setup('text', 'disabled');
    expect(input.disabled).toBe(true);
    input.value = '';
    expect(validateMonthInput(input)).toBe(true);
    input.required = true;
    expect(validateMonthInput(input)).toBe(false);
  });
  it('reuses an existing error slot', () => {
    document.body.innerHTML =
      '<div><input id="month" type="month"><span class="dialog-error" id="month-err"></span></div>';
    const input = document.querySelector('input')!;
    attachMonthInput(input);
    expect(document.querySelectorAll('.dialog-error')).toHaveLength(1);
    expect(input.getAttribute('aria-describedby')).toContain('month-err');
  });
});
