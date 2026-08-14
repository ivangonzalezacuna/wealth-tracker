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

  it('renders a row for each entry', () => {
    const entries: ConfigHistoryEntry[] = [
      {
        id: 1,
        timestamp: '2026-01-15T10:30:00.000Z',
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
    expect(html).toContain('accounts');
    expect(html).toContain('settings');
    expect(html).toContain('config-history-entity is-accounts');
    expect(html).toContain('config-history-entity is-settings');
    expect(html).toContain('config-history-action is-update');
    expect(html).toContain('Update');
    expect(html).toContain('config-history-source');
    expect(html).toContain('Web');
  });

  it('infers additional action chips for common summary types', () => {
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
    expect(html).toContain('config-history-action is-set');
    expect(html).toContain('config-history-action is-restore');
    expect(html).toContain('config-history-action is-seed');
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
