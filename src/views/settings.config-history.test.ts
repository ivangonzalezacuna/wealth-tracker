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

  it('shows JSON summary titles inline and parsed JSON in expandable details', () => {
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
      '<span class="config-history-summary-text">ui_collapse_state (3 keys)</span>',
    );
    expect(html).toContain('10:45');
    expect(html).toContain('&quot;card:accounts&quot;: true');
    expect(html).toContain('&quot;card:config-history&quot;: true');
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

  it('wraps plain rows in the shared single-line row layout', () => {
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
      '<div class="config-history-row-main" title="last_backup_at = 2026-08-13T16:49:14.925Z">',
    );
    expect(html).toContain(
      '<span class="config-history-summary-text">last_backup_at = 2026-08-13T16:49:14.925Z</span>',
    );
    expect(html).toContain('<span class="config-history-when">10:45</span>');
  });

  it('trims long plain summaries inline and keeps full text in expandable details', () => {
    const entries: ConfigHistoryEntry[] = [
      {
        id: 1,
        timestamp: '2026-01-15T10:45:00.000Z',
        source: 'web',
        entity: 'settings',
        summary:
          'last_backup_at = 2026-08-14T07:26:05.911Z and this is intentionally long to test truncation',
      },
    ];
    const html = renderConfigHistoryCard(entries);
    expect(html).toContain('config-history-row-expandable');
    expect(html).toContain(
      'config-history-summary-text">last_backup_at = 2026-08-14T07:26:05.911Z and this is i…',
    );
    expect(html).toContain(
      'last_backup_at = 2026-08-14T07:26:05.911Z and this is intentionally long to test truncation',
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
