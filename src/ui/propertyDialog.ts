import { esc, fmtEur2 } from '../utils';
import {
  PROPERTY_USES,
  propertyEquity,
  serializeProperties,
  type Property,
  type PropertyUse,
} from '../model/properties';
import { createDialogController, openDialogShell } from './modalShell';

const dialog = createDialogController(false, { overlaySelector: '.property-dialog-overlay' });

export function propertyDialog(options: {
  existing?: Property;
  onSave: (property: Property, button: HTMLButtonElement) => Promise<void>;
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
    overlay.innerHTML = `<div class="dialog-card">
      <div class="dialog-header"><h2 class="dialog-title" id="property-dialog-title">${existing ? 'Edit property' : 'Add property'}</h2></div>
      <form class="property-form">
        <div class="dialog-fields">
          <p class="note">An occasional estimate, not a payment tracker. Your account totals, goals and forecasts stay the same. All amounts are in EUR.</p>
          <div class="dialog-field"><label class="dialog-label" for="property-name">Name</label>
            <input id="property-name" class="form-input" maxlength="60" required value="${esc(existing?.label ?? '')}" placeholder="e.g. Our apartment"></div>
          <div class="dialog-field"><label class="dialog-label" for="property-use">Property type</label>
            <select id="property-use" class="form-input">${PROPERTY_USES.map((use) => `<option ${existing?.use === use ? 'selected' : ''}>${esc(use)}</option>`).join('')}</select></div>
          <fieldset class="property-fieldset"><legend>1. What is the property worth?</legend>
            <div class="dialog-field"><label class="dialog-label" for="property-value">Estimated value of the whole property (EUR)</label>
              <input id="property-value" class="form-input" type="number" inputmode="decimal" min="0" max="100000000" step="0.01" required value="${existing?.value ?? ''}" aria-describedby="property-value-help">
              <small id="property-value-help">The whole property, even if you only own part. If building, count only the land and work already completed.</small></div>
            <div class="dialog-row">
              <div class="dialog-field"><label class="dialog-label" for="property-share">How much do you own? (%)</label>
                <input id="property-share" class="form-input" type="number" inputmode="decimal" min="0.000001" max="100" step="any" required value="${existing?.share ?? 100}" aria-describedby="property-share-help">
                <small id="property-share-help">100 for all of it, 50 for half.</small></div>
              <div class="dialog-field"><label class="dialog-label" for="property-value-date">Date of this estimate</label>
                <input id="property-value-date" class="form-input" type="date" min="1900-01-01" max="${today}" required value="${esc(existing?.valueDate ?? today)}"></div>
            </div>
          </fieldset>
          <fieldset class="property-fieldset"><legend>2. What mortgage debt do you still owe?</legend>
            <div class="dialog-field"><label class="dialog-label" for="property-mortgage">Your mortgage situation</label>
              <select id="property-mortgage" class="form-input">
                <option value="unknown">I'm not sure of the remaining amount</option>
                <option value="none">I have no mortgage debt on this property</option>
                <option value="known">I know how much mortgage debt I have left</option>
              </select></div>
            <div id="property-debt-fields">
              <div class="dialog-field"><label class="dialog-label" for="property-debt">My remaining mortgage debt (EUR)</label>
                <input id="property-debt" class="form-input" type="number" inputmode="decimal" min="0" max="100000000" step="0.01" value="${existing?.debt ?? ''}" aria-describedby="property-debt-help">
                <small id="property-debt-help">Your share of the borrowed amount still unpaid, from your latest statement. Exclude future interest and monthly payments.</small></div>
              <div class="dialog-field"><label class="dialog-label" for="property-debt-date">Date on the mortgage statement</label>
                <input id="property-debt-date" class="form-input" type="date" min="1900-01-01" max="${today}" value="${esc(existing?.debtDate ?? today)}"></div>
            </div>
            <details class="property-help"><summary>Sharing a mortgage, or unsure what to enter?</summary>
              <p>If the remaining loan is EUR 280,000 and your agreed split is half, enter EUR 140,000. Your debt split may differ from your ownership share; we do not calculate it automatically.</p>
              <p>We need the borrowed amount still unpaid, not all future payments added together. If unsure, leave it unknown. Your tracking split does not change what the lender can legally require you to repay.</p>
            </details>
          </fieldset>
          <div class="property-preview"><h3>Your property at a glance</h3><div id="property-preview" aria-live="polite"></div>
            <small>This is called equity. It is not profit or available cash, and excludes selling costs and taxes.</small></div>
          <p id="property-error" class="dialog-error" role="alert"></p>
        </div>
        <div class="dialog-actions"><button type="button" class="btn btn-sm btn-ghost js-property-cancel">Cancel</button><button type="submit" class="btn btn-sm btn-primary js-property-save">Save property</button></div>
      </form>
    </div>`;
    const input = (id: string) => overlay.querySelector<HTMLInputElement>(`#property-${id}`)!;
    const form = overlay.querySelector<HTMLFormElement>('form')!;
    const mortgage = overlay.querySelector<HTMLSelectElement>('#property-mortgage')!;
    mortgage.value = existing?.mortgage ?? 'unknown';
    const read = (): Property => ({
      id,
      label: input('name').value.trim(),
      use: overlay.querySelector<HTMLSelectElement>('#property-use')!.value as PropertyUse,
      value: input('value').valueAsNumber,
      share: input('share').valueAsNumber,
      valueDate: input('value-date').value,
      mortgage: mortgage.value as Property['mortgage'],
      debt: mortgage.value === 'known' ? input('debt').valueAsNumber : null,
      debtDate: mortgage.value === 'known' ? input('debt-date').value : null,
    });
    const update = () => {
      const known = mortgage.value === 'known';
      overlay.querySelector<HTMLElement>('#property-debt-fields')!.hidden = !known;
      for (const id of ['debt', 'debt-date']) {
        input(id).disabled = !known;
        input(id).required = known;
      }
      const preview = overlay.querySelector<HTMLElement>('#property-preview')!;
      const fields = ['value', 'share', ...(known ? ['debt'] : [])];
      if (fields.some((id) => !input(id).value || !input(id).validity.valid)) {
        preview.textContent =
          'Enter a property value and your ownership share. Add your remaining debt if known.';
        return;
      }
      const property = read();
      const equity = propertyEquity(property);
      preview.innerHTML = `<div class="property-value-row"><span>Value of your share</span><strong>${fmtEur2((property.value * property.share) / 100)}</strong></div>
        <div class="property-value-row"><span>Minus your remaining mortgage debt</span><strong>${known ? fmtEur2(property.debt!) : property.mortgage === 'none' ? fmtEur2(0) : 'Not known yet'}</strong></div>
        <div class="property-value-row property-equity"><span>Your share after mortgage (equity)</span><strong>${equity === null ? 'Not calculated yet' : fmtEur2(equity)}</strong></div>
        ${equity !== null && equity < 0 ? '<p class="note">Your remaining debt is higher than the value of your share.</p>' : ''}`;
    };
    let saving = false;
    const dismiss = () => {
      if (!saving) dialog.dismiss(false);
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving || !form.reportValidity()) return;
      const error = overlay.querySelector<HTMLElement>('#property-error')!;
      if (!input('name').value.trim()) {
        error.textContent = 'Enter a property name, not just spaces.';
        input('name').focus();
        return;
      }
      const property = read();
      try {
        serializeProperties([property]);
        saving = true;
        overlay.querySelector<HTMLButtonElement>('.js-property-cancel')!.disabled = true;
        await options.onSave(
          property,
          overlay.querySelector<HTMLButtonElement>('.js-property-save')!,
        );
        dialog.dismiss(true);
      } catch (reason) {
        error.textContent =
          'Could not save property: ' + (reason instanceof Error ? reason.message : String(reason));
      } finally {
        saving = false;
        overlay.querySelector<HTMLButtonElement>('.js-property-cancel')!.disabled = false;
      }
    });
    update();
    openDialogShell(dialog, {
      overlay,
      onDismiss: dismiss,
      onCancel: dismiss,
      cancelSelector: '.js-property-cancel',
      initialFocusSelector: '#property-name',
      focusablesSelector:
        'input:not([disabled]), select:not([disabled]), button:not([disabled]), summary',
    });
  });
}
