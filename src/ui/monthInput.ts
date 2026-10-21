/** Element that receives the error/hint (the nearest `[data-month-host]`, else the parent). */
function monthHost(input: HTMLInputElement): HTMLElement | null {
  return input.closest<HTMLElement>('[data-month-host]') ?? input.parentElement;
}

export function validateMonthInput(input: HTMLInputElement): boolean {
  let message = '';
  const value = input.value;
  if (value && !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    message = 'Use YYYY-MM, for example 2035-06.';
  } else if (value && input.min && value < input.min) {
    message = `Use ${input.min} or later.`;
  } else if (value && input.max && value > input.max) {
    message = `Use ${input.max} or earlier.`;
  } else if (input.validity.badInput) {
    message = 'Enter a complete month and year.';
  }
  const error = monthHost(input)?.querySelector<HTMLElement>('.month-input-error');
  if (error) error.textContent = input.disabled ? '' : message;
  input.setCustomValidity(input.disabled ? '' : message);
  if (message && !input.disabled) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
  return input.disabled || !message;
}

export function wireMonthInputs(root: HTMLElement): void {
  root.querySelectorAll<HTMLInputElement>('input[data-month-input]').forEach((input) => {
    if (input.dataset.monthBound) return;
    input.dataset.monthBound = 'true';
    const error = document.createElement('span');
    error.className = 'dialog-error month-input-error';
    error.id = `${input.id}-error`;
    error.setAttribute('aria-live', 'polite');
    monthHost(input)?.appendChild(error);
    const describedBy = [input.getAttribute('aria-describedby'), error.id].filter(Boolean);
    if (input.type !== 'month') {
      input.placeholder = 'YYYY-MM';
      const hint = document.createElement('span');
      hint.id = `${input.id}-hint`;
      hint.className = 'month-input-hint';
      hint.textContent = 'Use YYYY-MM, for example 2035-06.';
      monthHost(input)?.appendChild(hint);
      describedBy.push(hint.id);
    }
    input.setAttribute('aria-describedby', describedBy.join(' '));
    for (const event of ['input', 'change', 'blur']) {
      input.addEventListener(event, () => validateMonthInput(input));
    }
  });
}
