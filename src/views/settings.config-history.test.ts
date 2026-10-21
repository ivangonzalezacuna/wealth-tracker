/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderConfigHistoryCard } from './settings';
import type { ConfigHistoryEntry } from '../db';

const localTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(
  new Date('2026-01-15T10:45:00.000Z'),
);

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
        summary: 'Added Main ETF',
      },
      {
        id: 2,
        timestamp: '2026-01-16T11:00:00.000Z',
        source: 'web',
        entity: 'settings',
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
    expect(html).toContain('config-history-kind');
    expect(html).toContain('>Accounts<');
    expect(html).toContain('>Settings<');
    expect(html).toContain('title="Accounts"');
  });

  it('uses entity labels for badges', () => {
    const entries: ConfigHistoryEntry[] = [
      {
        id: 1,
        timestamp: '2026-01-15T10:30:00.000Z',
        source: 'web',
        entity: 'settings',
        summary: 'costBasisMethod = fifo',
      },
      {
        id: 2,
        timestamp: '2026-01-16T10:30:00.000Z',
        source: 'web',
        entity: 'restore',
        summary: 'restored from backup',
      },
      {
        id: 3,
        timestamp: '2026-01-17T10:30:00.000Z',
        source: 'web',
        entity: 'migration',
        summary: 'Seeded config from config.js defaults (accounts=true, holdings=true)',
      },
    ];
    const html = renderConfigHistoryCard(entries);
    expect(html).toContain('>Settings<');
    expect(html).toContain('>Restore<');
    expect(html).toContain('>Migration<');
    expect(html).toContain('title="Settings"');
  });

  it('shows the correct entry count in the footer', () => {
    const entries: ConfigHistoryEntry[] = [
      {
        id: 1,
        timestamp: '2026-01-15T10:00:00.000Z',
        source: 'web',
        entity: 'holdings',
        summary: 'Added IWDA',
      },
    ];
    const html = renderConfigHistoryCard(entries);
    expect(html).toContain('Showing the last 1 change.');
    expect(html).toContain('1 change');
  });

  it('uses a friendly visibility label and retains complete raw JSON in details', () => {
    const entries: ConfigHistoryEntry[] = [
      {
        id: 1,
        timestamp: '2026-01-15T10:45:00.000Z',
        source: 'web',
        entity: 'settings',
        summary:
          'ui_collapse_state = {"card:accounts":true,"card:holdings":false,"card:config-history":true}',
      },
    ];
    const html = renderConfigHistoryCard(entries);
    expect(html).toContain('config-history-row-expandable');
    expect(html).toContain(
      '<span class="config-history-summary-text">Section visibility changed</span>',
    );
    expect(html).toContain(localTime);
    expect(html).toContain('ui_collapse_state = {&quot;card:accounts&quot;:true');
    expect(html).toContain('&quot;card:config-history&quot;:true');
  });

  it('shows item counts for JSON-array summaries', () => {
    const entries: ConfigHistoryEntry[] = [
      {
        id: 1,
        timestamp: '2026-01-15T10:45:00.000Z',
        source: 'web',
        entity: 'settings',
        summary: 'rebalancing_flags = ["buy","sell"]',
      },
    ];
    const html = renderConfigHistoryCard(entries);
    expect(html).toContain(
      '<span class="config-history-summary-text">rebalancing_flags (2 items)</span>',
    );
    expect(html).toContain('&quot;buy&quot;');
    expect(html).toContain('&quot;sell&quot;');
  });

  it('shows a friendly backup label with the raw timestamp in expandable details', () => {
    const entries: ConfigHistoryEntry[] = [
      {
        id: 1,
        timestamp: '2026-01-15T10:45:00.000Z',
        source: 'web',
        entity: 'settings',
        summary: 'last_backup_at = 2026-08-13T16:49:14.925Z',
      },
    ];
    const html = renderConfigHistoryCard(entries);
    expect(html).toContain(
      '<summary class="config-history-row-main" title="last_backup_at = 2026-08-13T16:49:14.925Z">',
    );
    expect(html).toContain(
      '<span class="config-history-summary-text">Backup export recorded</span>',
    );
    expect(html).toContain(`<span class="config-history-when">${localTime}</span>`);
  });

  it('trims long plain summaries inline and keeps full text in expandable details', () => {
    const entries: ConfigHistoryEntry[] = [
      {
        id: 1,
        timestamp: '2026-01-15T10:45:00.000Z',
        source: 'web',
        entity: 'settings',
        summary:
          'unknown_setting = 2026-08-14T07:26:05.911Z and this is intentionally long to test truncation',
      },
    ];
    const html = renderConfigHistoryCard(entries);
    expect(html).toContain('config-history-row-expandable');
    expect(html).toContain(
      'config-history-summary-text">unknown_setting = 2026-08-14T07:26:05.911Z and this is …',
    );
    expect(html).toContain(
      'unknown_setting = 2026-08-14T07:26:05.911Z and this is intentionally long to test truncation',
    );
  });

  it('escapes HTML-special characters in summary and entity', () => {
    const entries: ConfigHistoryEntry[] = [
      {
        id: 1,
        timestamp: '2026-01-15T10:00:00.000Z',
        source: 'web',
        entity: '<script>',
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
