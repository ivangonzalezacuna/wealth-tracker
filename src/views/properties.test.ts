/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROPERTIES_KEY, serializeProperties, type Property } from '../model/properties';
import { propertiesSettingsBody, renderPropertyOverview } from './properties';

const settings = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('../store/config', () => ({ getSettings: () => settings }));
const home: Property = {
  id: 'home',
  label: '<img src=x onerror=alert(1)>',
  use: 'Home',
  value: 420000,
  share: 50,
  valueDate: '2026-01-01',
  mortgage: 'known',
  debt: 140000,
  debtDate: '2026-01-01',
};

describe('informational property views', () => {
  beforeEach(() => {
    for (const key of Object.keys(settings)) delete settings[key];
    document.body.innerHTML = '<div id="nw-properties"></div><div id="financial-total">1000</div>';
  });
  it('hides an empty overview but leaves Settings discoverable', () => {
    renderPropertyOverview();
    expect(document.getElementById('nw-properties')?.hidden).toBe(true);
    expect(propertiesSettingsBody()).toContain('Add property');
  });
  it('escapes labels, preserves open state, and never modifies financial totals', () => {
    settings[PROPERTIES_KEY] = serializeProperties([home]);
    renderPropertyOverview();
    expect(document.querySelector('#nw-properties img')).toBeNull();
    expect(document.getElementById('nw-properties')?.textContent).toContain(home.label);
    expect(document.getElementById('financial-total')?.textContent).toBe('1000');
    document.querySelector('details')!.open = true;
    renderPropertyOverview();
    expect(document.querySelector('details')!.open).toBe(true);
  });
  it('keeps negative equity signed and unknown debt incomplete', () => {
    settings[PROPERTIES_KEY] = serializeProperties([
      { ...home, value: 200000, share: 100, debt: 240000 },
    ]);
    renderPropertyOverview();
    expect(document.querySelector('.property-equity .neg')).not.toBeNull();
    settings[PROPERTIES_KEY] = serializeProperties([
      { ...home, mortgage: 'unknown', debt: null, debtDate: null },
    ]);
    renderPropertyOverview();
    expect(document.querySelector('summary')?.textContent).toContain('Mortgage details missing');
  });
  it('surfaces unreadable data and disables editing rather than replacing it', () => {
    settings[PROPERTIES_KEY] = '{"version":2}';
    renderPropertyOverview();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('unsupported');
    expect(propertiesSettingsBody()).not.toContain('btn-add-property');
    expect(document.getElementById('financial-total')?.textContent).toBe('1000');
  });
});
