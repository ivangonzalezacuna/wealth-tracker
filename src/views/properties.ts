import { getSettings } from '../store/config';
import {
  estimateMortgagePayoff,
  parseProperties,
  PROPERTIES_KEY,
  propertyEquity,
  totalPropertyEquity,
  type Property,
} from '../model/properties';
import { esc, fmtDay, fmtEur, fmtEur2, fmtMon } from '../utils';

function propertyRows(properties: Property[]): string {
  return properties
    .map((property) => {
      const equity = propertyEquity(property);
      const payoff =
        property.mortgageTerms && property.debt && property.debtDate
          ? estimateMortgagePayoff(property.debt, property.debtDate, property.mortgageTerms)
          : null;
      return `<article class="property-item">
      <div class="property-heading"><h3 class="property-title">${esc(property.label)}</h3><span class="property-meta">${esc(property.use)} · ${esc(String(Number(property.share.toFixed(4))))}% owned</span></div>
      <div class="row"><span class="row-label">Value of your share</span><span class="row-val">${fmtEur2((property.value * property.share) / 100)}</span></div>
      <div class="row"><span class="row-label">Your remaining mortgage</span><span class="row-val">${property.mortgage === 'unknown' ? 'Not known yet' : fmtEur2(property.debt ?? 0)}</span></div>
      <div class="row property-equity"><span class="row-label">Your equity</span><span class="row-val ${equity !== null && equity < 0 ? 'neg' : ''}">${equity === null ? 'Not calculated yet' : fmtEur2(equity)}</span></div>
      ${equity !== null && equity < 0 ? '<p class="property-meta">Your debt exceeds the value of your share.</p>' : ''}
      <p class="property-meta">Whole property: ${fmtEur(property.value)} · Estimated ${esc(fmtDay(property.valueDate))}${property.mortgage === 'known' ? ` · Mortgage as of ${esc(fmtDay(property.debtDate!))}` : ''}</p>
      ${payoff ? `<p class="property-meta">${'month' in payoff ? `Estimated payoff: ${fmtMon(payoff.month)} if rate and payment stay the same.` : 'No payoff estimate. Check the rate and monthly payment.'}</p>` : ''}
    </article>`;
    })
    .join('');
}

export function renderPropertyOverview(): void {
  const host = document.getElementById('nw-properties');
  if (!host) return;
  const open = host.querySelector('details')?.open ?? false;
  try {
    const properties = parseProperties(getSettings()[PROPERTIES_KEY]);
    host.hidden = properties.length === 0;
    if (!properties.length) {
      host.innerHTML = '';
      return;
    }
    const total = totalPropertyEquity(properties);
    host.innerHTML = `<details class="card card-collapsible property-overview" ${open ? 'open' : ''}>
      <summary class="card-header"><span class="settings-card-label"><span class="card-title">Property overview (${properties.length})</span><span class="settings-card-summary ${total !== null && total < 0 ? 'neg' : ''}">${total === null ? 'Mortgage details missing' : `${fmtEur2(total)} equity`}</span></span><span class="card-chevron" aria-hidden="true"></span></summary>
      <div class="card-body">
      ${propertyRows(properties)}
      <p class="property-meta">Informational only. Equity is your share's value minus your mortgage, before selling costs and taxes. Financial totals are unchanged.</p>
      </div>
    </details>`;
  } catch (error) {
    host.hidden = false;
    host.innerHTML = `<div class="card"><h3 class="card-title">Property overview</h3><p class="form-msg error" role="alert">${esc(error instanceof Error ? error.message : String(error))}</p><p class="note">Financial accounts and calculations are unchanged.</p></div>`;
  }
}
