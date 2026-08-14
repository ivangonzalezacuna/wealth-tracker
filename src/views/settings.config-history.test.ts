/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderConfigHistoryCard } from './settings';
import type { ConfigHistoryEntry } from '../db';

describe('renderConfigHistoryCard', () => {
  it('renders empty-state message when no entries are provided', () => {
    const html = renderConfigHistoryCard([]);
    expect(html).toContain('No changes recorded yet.');
    expect(html).toContain('settings-card-config-history');
    expect(html).toContain('Config history');
  });

  it('renders grouped collapsible entries with newest date expanded by default', () => {
    const entries: ConfigHistoryEntry[] = [
      {
        id: 1,
        timestamp: '2026-01-16T10:30:00.000Z',
        source: 'web',
        entity: 'accounts',
        action: 'update',
        summary: 'Added Main ETF',
      },
      {
        id: 2,
        timestamp: '2026-01-16T11:00:00.000Z',
        source: 'web',
        entity: 'settings',
        action: 'update',
        summary: 'Cost basis changed to fifo',
      },
    ];
    const html = renderConfigHistoryCard(entries);
    expect(html).toContain('Added Main ETF');
    expect(html).toContain('Cost basis changed to fifo');
    expect(html).toContain('16 Jan 2026');
    expect(html).toContain('config-history-group');
    expect(html).toContain('config-history-group-row');
    expect(html).toContain('2 changes');
    expect(html).toContain('<details class="config-history-group" open>');
    expect(html).toContain('config-history-entity is-accounts');
    expect(html).toContain('config-history-entity is-settings');
    expect(html).toContain('Accounts · Update');
    expect(html).toContain('Settings · Update');
    expect(html).toContain('config-history-source');
    expect(html).toContain('Web');
  });

  it('consolidates duplicate and inferred action labels into a single badge', () => {
    const entries: ConfigHistoryEntry[] = [
      {
        id: 1,
        timestamp: '2026-01-15T10:30:00.000Z',
        source: 'web',
        entity: 'settings',
        action: '',
        summary: 'costBasisMethod = fifo',
      },
      {
        id: 2,
        timestamp: '2026-01-16T10:30:00.000Z',
        source: 'web',
        entity: 'restore',
        action: '',
        summary: 'restored from backup',
      },
      {
        id: 3,
        timestamp: '2026-01-17T10:30:00.000Z',
        source: 'web',
        entity: 'migration',
        action: '',
        summary: 'Seeded config from config.js defaults (accounts=true, holdings=true)',
      },
    ];
    const html = renderConfigHistoryCard(entries);
    expect(html).toContain('Settings · Set');
    expect(html).toContain('>Restore<');
    expect(html).toContain('Migration · Seed');
    expect(html).not.toContain('config-history-action');
  });

  it('shows the correct entry count in the footer', () => {
    const entries: ConfigHistoryEntry[] = [
      {
        id: 1,
        timestamp: '2026-01-15T10:00:00.000Z',
        source: 'web',
        entity: 'holdings',
        action: 'update',
        summary: 'Added IWDA',
      },
    ];
    const html = renderConfigHistoryCard(entries);
    expect(html).toContain('Showing the last 1 change.');
    expect(html).toContain('1 change');
  });

  it('renders long structured setting values in a scrollable block while keeping the time', () => {
    const entries: ConfigHistoryEntry[] = [
      {
        id: 1,
        timestamp: '2026-01-15T10:45:00.000Z',
        source: 'web',
        entity: 'settings',
        action: 'set',
        summary:
          'ui_collapse_state = {"card:accounts":true,"card:holdings":false,"card:config-history":true}',
      },
    ];
    const html = renderConfigHistoryCard(entries);
    expect(html).toContain('config-history-summary-block');
    expect(html).toContain('10:45');
    expect(html).toContain('ui_collapse_state =');
    expect(html).toContain('&quot;card:config-history&quot;:true');
  });

  it('escapes HTML-special characters in summary and entity', () => {
    const entries: ConfigHistoryEntry[] = [
      {
        id: 1,
        timestamp: '2026-01-15T10:00:00.000Z',
        source: 'web',
        entity: '<script>',
        action: '',
        summary: '"><img/>',
      },
    ];
    const html = renderConfigHistoryCard(entries);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('"><img/>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a collapsed card by default', () => {
    const html = renderConfigHistoryCard([]);
    expect(html).toContain('collapsed');
  });
});
