import { getSettings } from '../store/config';
import {
  parseProperties,
  PROPERTIES_KEY,
  propertyEquity,
  totalPropertyEquity,
  type Property,
} from '../model/properties';
import { esc, fmtDay, fmtEur, fmtEur2 } from '../utils';
import { propertyDialog } from '../ui/propertyDialog';
import { confirmDialog } from '../ui/confirmDialog';
import { notify } from '../ui/toast';

function entries(): Property[] {
  return parseProperties(getSettings()[PROPERTIES_KEY]);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function propertyRows(properties: Property[], management = false): string {
  return properties
    .map((property) => {
      const equity = propertyEquity(property);
      return `<article class="property-item">
      <div class="property-heading"><h3>${esc(property.label)}</h3><span class="note">${esc(property.use)}</span></div>
      <p class="note">You own ${esc(String(Number(property.share.toFixed(4))))}% of a property estimated at ${fmtEur(property.value)}.</p>
      <div class="property-value-row"><span>Value of your share</span><strong>${fmtEur2((property.value * property.share) / 100)}</strong></div>
      <div class="property-value-row"><span>Minus your remaining mortgage debt</span><strong>${property.mortgage === 'unknown' ? 'Not known yet' : fmtEur2(property.debt ?? 0)}</strong></div>
      <div class="property-value-row property-equity"><span>Your share after mortgage (equity)</span><strong class="${equity !== null && equity < 0 ? 'neg' : ''}">${equity === null ? 'Not calculated yet' : fmtEur2(equity)}</strong></div>
      ${equity !== null && equity < 0 ? '<p class="note">Your remaining debt is higher than the value of your share.</p>' : ''}
      <p class="note">Property estimate: ${esc(fmtDay(property.valueDate))}.${property.mortgage === 'known' ? ` Mortgage statement: ${esc(fmtDay(property.debtDate!))}.` : ''}</p>
      ${management ? `<div class="property-actions"><button type="button" class="btn btn-sm btn-ghost" data-property-edit="${esc(property.id)}" aria-label="Edit ${esc(property.label)}">Edit</button><button type="button" class="btn btn-sm btn-ghost" data-property-remove="${esc(property.id)}" aria-label="Remove ${esc(property.label)}">Remove</button></div>` : ''}
    </article>`;
    })
    .join('');
}

export function propertiesSettingsBody(): string {
  try {
    const properties = entries();
    return `<p class="note">Add an estimate of your property's value and any mortgage you still owe. Update it occasionally, not every month. Amounts are in EUR.</p>
      ${propertyRows(properties, true) || '<p class="note">No properties yet. Add your home or another property you own, or leave this section empty.</p>'}
      <div class="form-actions"><button type="button" class="btn btn-outline btn-sm" id="btn-add-property">+ Add property</button></div>
      <p class="note">Informational only. Your account totals, goals, investment returns, forecasts and annual reports stay the same.</p>`;
  } catch (error) {
    return `<p class="form-msg error" role="alert">${esc(errorText(error))}</p>`;
  }
}

export function renderPropertyOverview(): void {
  const host = document.getElementById('nw-properties');
  if (!host) return;
  const open = host.querySelector('details')?.open ?? false;
  try {
    const properties = entries();
    host.hidden = properties.length === 0;
    if (!properties.length) {
      host.innerHTML = '';
      return;
    }
    const total = totalPropertyEquity(properties);
    host.innerHTML = `<details class="card property-overview" ${open ? 'open' : ''}>
      <summary><span>Property overview <span class="note">(${properties.length})</span></span><strong>${total === null ? 'Mortgage details missing' : `${fmtEur2(total)} after mortgage`}</strong></summary>
      <p class="note">What your share is worth, minus your remaining mortgage debt. Shown separately from your accounts, not as money you can spend.</p>
      ${propertyRows(properties)}
      <div class="property-heading"><small class="note">Based on your latest estimates. No automatic value or debt updates.</small><a class="btn btn-sm btn-ghost" href="#settings">Manage properties</a></div>
      <p class="note">Equity is not profit or available cash, and excludes selling costs and taxes. Financial calculations are unchanged.</p>
    </details>`;
  } catch (error) {
    host.hidden = false;
    host.innerHTML = `<div class="card"><h3>Property overview</h3><p role="alert">${esc(errorText(error))}</p><p class="note">Financial accounts and calculations are unchanged.</p></div>`;
  }
}

export function attachPropertySettings(
  root: HTMLElement,
  save: (
    properties: Property[],
    baseline: string | null | undefined,
    button: HTMLButtonElement,
  ) => Promise<void>,
): void {
  const edit = async (id?: string) => {
    try {
      const baseline = getSettings()[PROPERTIES_KEY];
      const properties = entries();
      const existing = id ? properties.find((property) => property.id === id) : undefined;
      if (id && !existing) throw new Error('This property changed. Reopen Settings and try again.');
      const saved = await propertyDialog({
        existing,
        onSave: async (property, button) => {
          await save(
            existing
              ? properties.map((entry) => (entry.id === existing.id ? property : entry))
              : [...properties, property],
            baseline,
            button,
          );
        },
      });
      if (saved) {
        notify('Property saved. Financial calculations are unchanged.', { variant: 'success' });
        document.getElementById('btn-add-property')?.focus();
      }
    } catch (error) {
      notify(errorText(error), { variant: 'error' });
    }
  };
  root.querySelector('#btn-add-property')?.addEventListener('click', () => {
    void edit();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-property-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      void edit(button.dataset.propertyEdit);
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-property-remove]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const baseline = getSettings()[PROPERTIES_KEY];
        const properties = entries();
        const property = properties.find((entry) => entry.id === button.dataset.propertyRemove);
        if (!property) throw new Error('This property changed. Reopen Settings and try again.');
        if (
          !(await confirmDialog({
            title: 'Remove property?',
            body: `Remove "${property.label}" from this overview? No account balance or cash transaction changes.`,
            confirmLabel: 'Remove',
            danger: true,
          }))
        )
          return;
        await save(
          properties.filter((entry) => entry.id !== property.id),
          baseline,
          button,
        );
        notify('Property removed. Financial calculations are unchanged.', { variant: 'success' });
        document.getElementById('btn-add-property')?.focus();
      } catch (error) {
        notify('Could not remove property: ' + errorText(error), { variant: 'error' });
      }
    });
  });
}
