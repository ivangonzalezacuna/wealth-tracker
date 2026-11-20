import { esc, fmtEur2, fmtMon } from '../utils';
import {
  estimateMortgagePayoff,
  MAX_MORTGAGE_RATE,
  MAX_PROPERTY_AMOUNT,
  PROPERTY_USES,
  propertyEquity,
  serializeProperties,
  type Property,
  type PropertyUse,
} from '../model/properties';
import {
  createDialogController,
  focusFirstInvalid,
  makeDialogHelpers,
  openDialogShell,
} from './modalShell';
import { attachInfoTips, infoTip } from './infoTip';

const dialog = createDialogController(false, { overlaySelector: '.property-dialog-overlay' });

export function propertyDialog(options: {
  existing?: Property;
  onSave: (property: Property, button: HTMLButtonElement) => Promise<void>;
  onRemove?: () => void;
}): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.begin(resolve);
    const existing = options.existing;
    const id = existing?.id ?? crypto.randomUUID();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay property-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'property-dialog-title');
    overlay.innerHTML = `<form class="dialog-card property-form">
      <div class="dialog-header"><div class="dialog-title" id="property-dialog-title" role="heading" aria-level="2">${existing ? 'Edit property' : 'Add property'}</div></div>
        <div class="dialog-fields">
          <div class="dialog-row">
          <div class="dialog-field dialog-field-wide"><label class="dialog-label" for="property-name">Name</label>
            <input id="property-name" class="form-input dialog-input" maxlength="60" required value="${esc(existing?.label ?? '')}" placeholder="e.g. Our apartment" aria-describedby="property-name-err">
            <span class="dialog-error" id="property-name-err"></span></div>
          <div class="dialog-field"><label class="dialog-label" for="property-use">Property type</label>
            <select id="property-use" class="form-input dialog-input">${PROPERTY_USES.map((use) => `<option ${existing?.use === use ? 'selected' : ''}>${esc(use)}</option>`).join('')}</select></div>
          </div>
          <div class="dialog-subhead">Property value</div>
            <div class="dialog-field"><label class="dialog-label" for="property-value">Whole-property estimate (EUR)${infoTip('Enter the value of the whole property, even if you only own part. If building, count only the land and work already completed, not the finished-house value.')}</label>
              <input id="property-value" class="form-input dialog-input" type="number" inputmode="decimal" min="0" max="${MAX_PROPERTY_AMOUNT}" step="0.01" required value="${existing?.value ?? ''}" placeholder="e.g. 420000" aria-describedby="property-value-err">
              <span class="dialog-error" id="property-value-err"></span></div>
            <div class="dialog-row">
              <div class="dialog-field"><label class="dialog-label" for="property-share">Your ownership (%)${infoTip('Enter 100 if you own all of it, 50 for half, or your agreed ownership share. Your mortgage debt share can be different.')}</label>
                <input id="property-share" class="form-input dialog-input" type="number" inputmode="decimal" min="0.000001" max="100" step="any" required value="${existing?.share ?? 100}" aria-describedby="property-share-err">
                <span class="dialog-error" id="property-share-err"></span></div>
              <div class="dialog-field"><label class="dialog-label" for="property-value-date">Date of this estimate</label>
                <input id="property-value-date" class="form-input dialog-input" type="date" min="1900-01-01" max="${today}" required value="${esc(existing?.valueDate ?? today)}" aria-describedby="property-value-date-err">
                <span class="dialog-error" id="property-value-date-err"></span></div>
            </div>
          <div class="dialog-subhead">Mortgage</div>
            <div class="dialog-field"><label class="dialog-label" for="property-mortgage">Your mortgage situation</label>
              <select id="property-mortgage" class="form-input dialog-input">
                <option value="unknown">I'm not sure of the remaining amount</option>
                <option value="none">I have no mortgage debt on this property</option>
                <option value="known">I know how much mortgage debt I have left</option>
              </select></div>
            <div id="property-debt-fields" class="dialog-row">
              <div class="dialog-field dialog-field-wide"><label class="dialog-label" for="property-debt">My remaining mortgage debt (EUR)${infoTip('Use your share of the outstanding principal, excluding future interest. For example, enter EUR 140,000 for half of a EUR 280,000 balance. This tracking split does not change your liability to the lender.')}</label>
                <input id="property-debt" class="form-input dialog-input" type="number" inputmode="decimal" min="0" max="${MAX_PROPERTY_AMOUNT}" step="0.01" value="${existing?.debt ?? ''}" aria-describedby="property-debt-err">
                <span class="dialog-error" id="property-debt-err"></span></div>
              <div class="dialog-field dialog-field-wide"><label class="dialog-label" for="property-debt-date">Date on the mortgage statement</label>
                <input id="property-debt-date" class="form-input dialog-input" type="date" min="1900-01-01" max="${today}" value="${esc(existing?.debtDate ?? today)}" aria-describedby="property-debt-date-err">
                <span class="dialog-error" id="property-debt-date-err"></span></div>
            </div>
            <details class="dialog-optional" id="property-payoff"><summary>Payoff estimate (optional)</summary>
              <div class="dialog-optional-body">
                <div class="dialog-row">
                  <div class="dialog-field"><label class="dialog-label" for="property-rate">Annual interest (%)${infoTip('Use your loan interest rate, not an APR that includes fees.')}</label>
                    <input id="property-rate" class="form-input dialog-input" type="number" inputmode="decimal" min="0" max="${MAX_MORTGAGE_RATE}" step="any" placeholder="e.g. 3.5" value="${existing?.mortgageTerms?.annualRate ?? ''}" aria-describedby="property-rate-err">
                    <span class="dialog-error" id="property-rate-err"></span></div>
                  <div class="dialog-field"><label class="dialog-label" for="property-payment">My monthly payment (EUR)${infoTip('Enter principal and interest only, without taxes, insurance or fees. Use the same share as for your mortgage debt.')}</label>
                    <input id="property-payment" class="form-input dialog-input" type="number" inputmode="decimal" min="0.01" max="${MAX_PROPERTY_AMOUNT}" step="0.01" placeholder="e.g. 900" value="${existing?.mortgageTerms?.monthlyPayment ?? ''}" aria-describedby="property-payment-err">
                    <span class="dialog-error" id="property-payment-err"></span></div>
                </div>
                <p class="note" id="property-payoff-result" aria-live="polite"></p>
                <p class="note">Assumes the same rate and payment each month.</p>
              </div>
            </details>
          <div class="dialog-subhead">Your property at a glance${infoTip('Equity is what your share is worth minus your remaining mortgage debt, before selling costs and taxes.')}</div>
          <div id="property-preview" class="property-preview" aria-live="polite"></div>
        </div>
        <p id="property-error" class="dialog-error dialog-error-compact" role="alert"></p>
        <div class="dialog-actions"><button type="button" class="btn btn-sm btn-ghost js-property-cancel">Cancel</button><button type="submit" class="btn btn-sm btn-primary js-property-save">${existing ? 'Apply changes' : 'Add to draft'}</button></div>
    </form>`;
    const input = (id: string) => overlay.querySelector<HTMLInputElement>(`#property-${id}`)!;
    const form = overlay.querySelector<HTMLFormElement>('form')!;
    form.noValidate = true;
    const { setErr } = makeDialogHelpers(overlay);
    const mortgage = overlay.querySelector<HTMLSelectElement>('#property-mortgage')!;
    const payoff = overlay.querySelector<HTMLDetailsElement>('#property-payoff')!;
    const payoffResult = overlay.querySelector<HTMLElement>('#property-payoff-result')!;
    const debt = input('debt');
    const debtDate = input('debt-date');
    const rate = input('rate');
    const payment = input('payment');
    mortgage.value = existing?.mortgage ?? 'unknown';
    const mortgageTerms = () =>
      !payoff.hidden && rate.value && payment.value
        ? { annualRate: rate.valueAsNumber, monthlyPayment: payment.valueAsNumber }
        : undefined;
    const read = (): Property => ({
      id,
      label: input('name').value.trim(),
      use: overlay.querySelector<HTMLSelectElement>('#property-use')!.value as PropertyUse,
      value: input('value').valueAsNumber,
      share: input('share').valueAsNumber,
      valueDate: input('value-date').value,
      mortgage: mortgage.value as Property['mortgage'],
      debt: mortgage.value === 'known' ? debt.valueAsNumber : null,
      debtDate: mortgage.value === 'known' ? debtDate.value : null,
      mortgageTerms: mortgageTerms(),
    });
    const update = () => {
      const known = mortgage.value === 'known';
      overlay.querySelector<HTMLElement>('#property-debt-fields')!.hidden = !known;
      for (const field of [debt, debtDate]) {
        field.disabled = !known;
        field.required = known;
      }
      payoff.hidden = !known || debt.valueAsNumber === 0;
      rate.disabled = payment.disabled = payoff.hidden;
      rate.required = !payoff.hidden && (Boolean(payment.value) || payment.validity.badInput);
      payment.required = !payoff.hidden && (Boolean(rate.value) || rate.validity.badInput);
      const terms = mortgageTerms();
      const result =
        terms && [debt, debtDate, rate, payment].every((field) => field.validity.valid)
          ? estimateMortgagePayoff(debt.valueAsNumber, debtDate.value, terms)
          : null;
      payoffResult.textContent = !result
        ? ''
        : 'month' in result
          ? `Estimated payoff: ${fmtMon(result.month)}`
          : result.reason === 'interest'
            ? 'This payment does not reduce your balance.'
            : 'No payoff estimate within 50 years.';
      const preview = overlay.querySelector<HTMLElement>('#property-preview')!;
      const fields = ['value', 'share', ...(known ? ['debt'] : [])];
      if (fields.some((id) => !input(id).value || !input(id).validity.valid)) {
        preview.innerHTML =
          '<p class="note">Enter a property value and your ownership share. Add your remaining debt if known.</p>';
        return;
      }
      const property = read();
      const equity = propertyEquity(property);
      preview.innerHTML = `<dl class="snapd-review-values">
        <div><dt>Value of your share</dt><dd>${fmtEur2((property.value * property.share) / 100)}</dd></div>
        <div><dt>Minus your remaining mortgage debt</dt><dd>${known ? fmtEur2(property.debt!) : property.mortgage === 'none' ? fmtEur2(0) : 'Not known yet'}</dd></div>
        <div><dt>Your share after mortgage (equity)</dt><dd class="${equity !== null && equity < 0 ? 'neg' : ''}">${equity === null ? 'Not calculated yet' : fmtEur2(equity)}</dd></div>
        </dl>
        ${equity !== null && equity < 0 ? '<p class="note">Your remaining debt is higher than the value of your share.</p>' : ''}`;
    };
    let saving = false;
    const dismiss = () => {
      if (!saving) dialog.dismiss(false);
    };
    const onChange = (event: Event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        setErr(event.target.id, '');
        if (
          event.target === rate ||
          event.target === payment ||
          event.target === mortgage ||
          event.target === debt
        ) {
          setErr(rate.id, '');
          setErr(payment.id, '');
        }
      }
      overlay.querySelector<HTMLElement>('#property-error')!.textContent = '';
      update();
    };
    form.addEventListener('input', onChange);
    form.addEventListener('change', onChange);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) return;
      const error = overlay.querySelector<HTMLElement>('#property-error')!;
      error.textContent = '';
      let valid = true;
      form.querySelectorAll('input').forEach((field) => {
        const message = field.disabled || field.checkValidity() ? '' : field.validationMessage;
        setErr(field.id, message);
        if (message) valid = false;
      });
      if (!input('name').value.trim()) {
        setErr('property-name', 'Enter a property name, not just spaces.');
        valid = false;
      }
      if (!valid) {
        focusFirstInvalid(overlay);
        return;
      }
      const property = read();
      try {
        serializeProperties([property]);
        saving = true;
        overlay.querySelector<HTMLButtonElement>('.js-property-cancel')!.disabled = true;
        const remove = overlay.querySelector<HTMLButtonElement>('.dialog-remove');
        if (remove) remove.disabled = true;
        await options.onSave(
          property,
          overlay.querySelector<HTMLButtonElement>('.js-property-save')!,
        );
        dialog.dismiss(true);
      } catch (reason) {
        error.textContent =
          'Could not apply property: ' +
          (reason instanceof Error ? reason.message : String(reason));
      } finally {
        saving = false;
        overlay.querySelector<HTMLButtonElement>('.js-property-cancel')!.disabled = false;
        const remove = overlay.querySelector<HTMLButtonElement>('.dialog-remove');
        if (remove) remove.disabled = false;
      }
    });
    update();
    openDialogShell(dialog, {
      overlay,
      onDismiss: dismiss,
      onCancel: dismiss,
      cancelSelector: '.js-property-cancel',
      initialFocusSelector: '#property-name',
      onRemove: options.onRemove,
      focusablesSelector:
        'input:not([disabled]), select:not([disabled]), button:not([disabled]), summary, .info-tip',
    });
    attachInfoTips(overlay);
  });
}
