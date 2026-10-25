/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyAttention,
  collectAttention,
  refreshAttention,
  resetAttentionForTests,
  setAttentionSource,
  type AttentionInput,
} from './attention';

const NOW = new Date('2026-05-15T12:00:00Z');
const FRESH = '2026-05-01T00:00:00Z';
const OLD = '2026-03-01T00:00:00Z';

function mount(): void {
  document.body.innerHTML = `
    <nav>
      <button id="tab-portfolio">Portfolio</button>
      <button id="tab-settings">Settings</button>
      <button id="tab-log" aria-label="Log data (add snapshot)">Log data</button>
    </nav>
    <button id="tab-holdings">Holdings</button>
    <button id="settings-tab-advanced">Advanced</button>
    <button id="settings-heading-backup"><span class="card-title">Backup &amp; restore</span></button>`;
}

function show(input: AttentionInput): void {
  setAttentionSource(() => ({ now: NOW, ...input }));
  refreshAttention();
}

const el = (id: string) => document.getElementById(id)!;

describe('collectAttention', () => {
  it('reports nothing when drift is within the threshold and the backup is recent', () => {
    expect(
      collectAttention({
        maxDrift: 3,
        driftThresholdPct: 5,
        backup: { lastBackupAt: FRESH, hasData: true },
        now: NOW,
      }),
    ).toEqual([]);
  });

  it('flags moderate drift as a warning and high drift as an alert', () => {
    const [moderate] = collectAttention({ maxDrift: 7, driftThresholdPct: 5 });
    expect(moderate).toMatchObject({ id: 'drift', level: 'warn', chipId: 'tab-holdings' });
    expect(moderate.text).toContain('Moderate drift');
    expect(moderate.text).toContain('(threshold)');
    const [high] = collectAttention({ maxDrift: -12, driftThresholdPct: 5 });
    expect(high).toMatchObject({ level: 'alert' });
    expect(high.text).toContain('(high threshold)');
    expect(collectAttention({ maxDrift: null })).toEqual([]);
  });

  it('flags a missing or old backup only when there is data to back up', () => {
    expect(
      collectAttention({ maxDrift: null, backup: { hasData: true }, now: NOW })[0],
    ).toMatchObject({ id: 'backup', badge: 'Backup due', text: 'No backup yet' });
    expect(
      collectAttention({
        maxDrift: null,
        backup: { lastBackupAt: OLD, hasData: true },
        now: NOW,
      })[0].text,
    ).toBe('Last backup is over 30 days old');
    expect(collectAttention({ maxDrift: null, backup: { hasData: false }, now: NOW })).toEqual([]);
    expect(collectAttention({ maxDrift: null, now: NOW })).toEqual([]);
  });
});

describe('attention trail', () => {
  beforeEach(mount);
  afterEach(resetAttentionForTests);

  it('marks the tab and chip with a dot and an accessible description', () => {
    show({ maxDrift: 7, driftThresholdPct: 5 });
    for (const id of ['tab-portfolio', 'tab-holdings']) {
      expect(el(id).querySelector('.attn-dot.attn-dot--warn')).not.toBeNull();
      expect(el(id).hasAttribute('title')).toBe(false);
      expect(el(id).querySelector<HTMLElement>('.attn-dot')!.dataset.tip).toContain(
        'Moderate drift',
      );
    }
    expect(el('tab-portfolio').getAttribute('aria-label')).toMatch(
      /^Portfolio, needs attention: Moderate drift/,
    );
    expect(el('tab-settings').querySelector('.attn-dot')).toBeNull();
  });

  it('adds a header badge to the backup card and dots on Settings and Advanced', () => {
    show({ maxDrift: null, backup: { hasData: true } });
    expect(el('tab-settings').querySelector('.attn-dot')).not.toBeNull();
    expect(el('settings-tab-advanced').querySelector('.attn-dot')).not.toBeNull();
    const badge = el('settings-heading-backup').querySelector('.card-title .attn-badge');
    expect(badge?.textContent).toBe('Backup due');
  });

  it('clears the trail and restores the original labels once resolved', () => {
    show({ maxDrift: 12, driftThresholdPct: 5, backup: { hasData: true } });
    expect(el('tab-portfolio').querySelector('.attn-dot--alert')).not.toBeNull();
    show({ maxDrift: 1, driftThresholdPct: 5, backup: { lastBackupAt: FRESH, hasData: true } });
    expect(document.querySelectorAll('.attn-dot, .attn-badge')).toHaveLength(0);
    expect(el('tab-portfolio').hasAttribute('aria-label')).toBe(false);
    expect(el('tab-portfolio').hasAttribute('title')).toBe(false);
    expect(el('tab-portfolio').textContent).toBe('Portfolio');
  });

  it('hovering the tab shows the custom popover; tapping the dot does not switch tabs', () => {
    show({ maxDrift: 7, driftThresholdPct: 5 });
    const tab = el('tab-portfolio');
    tab.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.info-tip-pop')?.textContent).toContain('Moderate drift');
    tab.dispatchEvent(new MouseEvent('mouseleave'));
    expect(document.querySelector('.info-tip-pop')).toBeNull();

    let navigated = false;
    tab.addEventListener('click', () => (navigated = true));
    (tab.querySelector('.attn-dot') as HTMLElement).click();
    expect(navigated).toBe(false);
    expect(document.querySelector('.info-tip-pop--warn')).not.toBeNull();
    // The open popover goes away with its dot.
    show({ maxDrift: 1, driftThresholdPct: 5 });
    expect(document.querySelector('.info-tip-pop')).toBeNull();
  });

  it('the backup badge opens the same popover', () => {
    show({ maxDrift: null, backup: { hasData: true } });
    const badge = document.querySelector<HTMLElement>('.attn-badge')!;
    expect(badge.hasAttribute('title')).toBe(false);
    badge.click();
    expect(document.querySelector('.info-tip-pop')?.textContent).toBe('No backup yet');
    document.body.click();
  });

  it('redraws on re-rendered markup without duplicating dots', () => {
    show({ maxDrift: 7, driftThresholdPct: 5 });
    applyAttention();
    expect(el('tab-portfolio').querySelectorAll('.attn-dot')).toHaveLength(1);
    el('tab-holdings').outerHTML = '<button id="tab-holdings">Holdings</button>';
    applyAttention();
    expect(el('tab-holdings').querySelectorAll('.attn-dot')).toHaveLength(1);
    expect(el('tab-holdings').getAttribute('aria-label')).toMatch(/^Holdings, needs attention/);
  });
});
