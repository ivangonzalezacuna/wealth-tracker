/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Tests for ARIA tab semantics added in Phase 63.
 *
 * main.ts has heavy module-level side effects that prevent direct import,
 * so we reproduce the exact DOM-manipulation logic from showSection and
 * showPortfolioSubview against a hand-built fixture, matching the pattern
 * established in main.test.ts.
 */

describe('showSection aria-selected sync', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav class="nav" role="tablist" aria-label="Main sections">
        <button class="active" data-section="networth" role="tab" aria-selected="true" aria-controls="networth">Net worth</button>
        <button data-section="portfolio" role="tab" aria-selected="false" aria-controls="portfolio">Portfolio</button>
        <button data-section="settings" role="tab" aria-selected="false" aria-controls="settings">Settings</button>
        <button data-section="log" class="log-btn" role="tab" aria-selected="false" aria-controls="log">+ Update</button>
      </nav>
      <div id="networth" class="section active" role="tabpanel"></div>
      <div id="portfolio" class="section" role="tabpanel"></div>
      <div id="settings" class="section" role="tabpanel"></div>
      <div id="log" class="section" role="tabpanel"></div>
    `;
  });

  /** Reproduces the exact logic from showSection in main.ts */
  function showSection(id: string, btn: HTMLElement | null): void {
    document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
    document.querySelectorAll('.nav button').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    document.getElementById(id)?.classList.add('active');
    btn?.classList.add('active');
    btn?.setAttribute('aria-selected', 'true');
  }

  it('switches aria-selected from networth to portfolio', () => {
    const portfolioBtn = document.querySelector('[data-section="portfolio"]') as HTMLElement;
    showSection('portfolio', portfolioBtn);

    // The newly active button has aria-selected="true"
    expect(portfolioBtn.getAttribute('aria-selected')).toBe('true');
    // The previously active button has aria-selected="false"
    const networthBtn = document.querySelector('[data-section="networth"]') as HTMLElement;
    expect(networthBtn.getAttribute('aria-selected')).toBe('false');
  });

  it('only one button has aria-selected="true" after switching', () => {
    const settingsBtn = document.querySelector('[data-section="settings"]') as HTMLElement;
    showSection('settings', settingsBtn);

    const allButtons = document.querySelectorAll('.nav button[role="tab"]');
    const selectedButtons = Array.from(allButtons).filter(
      (b) => b.getAttribute('aria-selected') === 'true',
    );
    expect(selectedButtons).toHaveLength(1);
    expect(selectedButtons[0]).toBe(settingsBtn);
  });

  it('handles null btn gracefully (no aria-selected="true" set)', () => {
    showSection('log', null);

    const allButtons = document.querySelectorAll('.nav button[role="tab"]');
    const selectedButtons = Array.from(allButtons).filter(
      (b) => b.getAttribute('aria-selected') === 'true',
    );
    expect(selectedButtons).toHaveLength(0);
  });
});

describe('showPortfolioSubview aria-selected sync', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="subnav range-toggle" id="portfolio-subnav" role="tablist" aria-label="Portfolio views">
        <button class="btn btn-sm btn-ghost active" data-subview="holdings" role="tab" aria-selected="true" aria-controls="subview-holdings">Holdings</button>
        <button class="btn btn-sm btn-ghost" data-subview="contributions" role="tab" aria-selected="false" aria-controls="subview-contributions">Contributions</button>
        <button class="btn btn-sm btn-ghost" data-subview="dividends" role="tab" aria-selected="false" aria-controls="subview-dividends">Dividends</button>
      </div>
      <div class="subview" id="subview-holdings" role="tabpanel" style="display:block"></div>
      <div class="subview" id="subview-contributions" role="tabpanel" style="display:none"></div>
      <div class="subview" id="subview-dividends" role="tabpanel" style="display:none"></div>
    `;
  });

  /** Reproduces the exact logic from showPortfolioSubview in main.ts */
  function showPortfolioSubview(sub: string): void {
    ['holdings', 'contributions', 'dividends'].forEach((s) => {
      const el = document.getElementById(`subview-${s}`);
      if (el) el.style.display = s === sub ? 'block' : 'none';
    });
    document.querySelectorAll('#portfolio-subnav [data-subview]').forEach((b) => {
      const isActive = (b as HTMLElement).dataset.subview === sub;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', String(isActive));
    });
  }

  it('switches aria-selected from holdings to contributions', () => {
    showPortfolioSubview('contributions');

    const holdingsBtn = document.querySelector('[data-subview="holdings"]') as HTMLElement;
    const contribBtn = document.querySelector('[data-subview="contributions"]') as HTMLElement;

    expect(holdingsBtn.getAttribute('aria-selected')).toBe('false');
    expect(contribBtn.getAttribute('aria-selected')).toBe('true');
  });

  it('switches aria-selected from holdings to dividends', () => {
    showPortfolioSubview('dividends');

    const holdingsBtn = document.querySelector('[data-subview="holdings"]') as HTMLElement;
    const dividendsBtn = document.querySelector('[data-subview="dividends"]') as HTMLElement;

    expect(holdingsBtn.getAttribute('aria-selected')).toBe('false');
    expect(dividendsBtn.getAttribute('aria-selected')).toBe('true');
  });

  it('only one sub-nav button has aria-selected="true" after switching', () => {
    showPortfolioSubview('dividends');

    const allButtons = document.querySelectorAll('#portfolio-subnav [data-subview]');
    const selectedButtons = Array.from(allButtons).filter(
      (b) => b.getAttribute('aria-selected') === 'true',
    );
    expect(selectedButtons).toHaveLength(1);
    expect((selectedButtons[0] as HTMLElement).dataset.subview).toBe('dividends');
  });

  it('switching back to holdings restores its aria-selected', () => {
    showPortfolioSubview('contributions');
    showPortfolioSubview('holdings');

    const holdingsBtn = document.querySelector('[data-subview="holdings"]') as HTMLElement;
    expect(holdingsBtn.getAttribute('aria-selected')).toBe('true');

    const contribBtn = document.querySelector('[data-subview="contributions"]') as HTMLElement;
    expect(contribBtn.getAttribute('aria-selected')).toBe('false');
  });
});
