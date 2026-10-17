let nextId = 0;

export function isValidMonth(value: string): boolean {
  return /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value) && !value.startsWith('0000');
}

export function validateMonthInput(input: HTMLInputElement): boolean {
  const value = input.value.trim();
  const min = input.getAttribute('min') || '';
  const max = input.getAttribute('max') || '';
  const message =
    input.validity.badInput || (!value && input.required)
      ? 'Choose a month.'
      : value && !isValidMonth(value)
        ? 'Use YYYY-MM (for example, 2030-06).'
        : value && isValidMonth(min) && value < min
          ? `Choose ${min} or later.`
          : value && isValidMonth(max) && value > max
            ? `Choose ${max} or earlier.`
            : '';
  input.setCustomValidity(message);
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
  const error = input.parentElement?.querySelector('.month-input-error');
  if (error) error.textContent = message;
  return !message;
}

export function attachMonthInput(input: HTMLInputElement): void {
  if (input.dataset.monthInput) return;
  input.dataset.monthInput = 'true';
  input.classList.add('month-input');
  input.removeAttribute('aria-hidden');
  input.removeAttribute('tabindex');

  // Unsupported browsers expose type=month as text; retain the native picker elsewhere.
  const fallback = input.type !== 'month';
  const help = document.createElement('span');
  help.id = `month-input-${++nextId}-help`;
  help.className = 'month-input-help';
  help.textContent = 'Format: YYYY-MM (for example, 2030-06).';
  help.hidden = !fallback;
  if (fallback) {
    input.placeholder = 'YYYY-MM';
    input.maxLength = 7;
  }
  const existingError = input.parentElement?.querySelector<HTMLElement>('.dialog-error');
  const error = existingError || document.createElement('span');
  error.id ||= `month-input-${nextId}-error`;
  error.classList.add('dialog-error', 'month-input-error');
  error.setAttribute('aria-live', 'polite');
  input.after(help);
  if (!existingError) help.after(error);
  input.setAttribute(
    'aria-describedby',
    [input.getAttribute('aria-describedby'), fallback ? help.id : '', error.id]
      .filter(Boolean)
      .join(' '),
  );
  input.addEventListener('change', () => validateMonthInput(input));
  input.addEventListener('input', () => {
    if (input.hasAttribute('aria-invalid')) validateMonthInput(input);
  });
}
