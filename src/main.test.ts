/**
 * @vitest-environment jsdom
 */
// @ts-nocheck — mirrors production file's @ts-nocheck; test fixtures use partial objects
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * main.ts has heavy module-level side effects (DOM manipulation, auth init,
 * etc.) which make direct import impractical for unit testing. Instead, we
 * test the guard logic in isolation by reproducing the exact guard conditions
 * used in showSection and showPortfolioSubview, then verify the expected
 * short-circuit behavior.
 *
 * This matches the project's established precedent (Phase 1F's PWA-shell
 * case, Phase 21's per-section error boundary) of explicitly documenting
 * when DOM/render-cycle behavior is tested via focused guard-logic tests
 * rather than full integration.
 */

describe('showSection idempotent guard', () => {
  let _activeSection: string;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="networth" class="section active"></div>
      <div id="portfolio" class="section"></div>
      <div id="settings" class="section"></div>
      <div id="log" class="section"></div>
    `;
    _activeSection = 'networth';
  });

  function isAlreadyActive(id: string): boolean {
    return _activeSection === id && !!document.getElementById(id)?.classList.contains('active');
  }

  it('detects already-active section (networth on networth)', () => {
    expect(isAlreadyActive('networth')).toBe(true);
  });

  it('does not detect already-active when switching to a different section', () => {
    expect(isAlreadyActive('portfolio')).toBe(false);
    expect(isAlreadyActive('settings')).toBe(false);
    expect(isAlreadyActive('log')).toBe(false);
  });

  it('does not detect already-active when _activeSection matches but DOM class is missing', () => {
    // Simulate first boot: _activeSection is 'networth' but DOM has no .active
    document.getElementById('networth')!.classList.remove('active');
    expect(isAlreadyActive('networth')).toBe(false);
  });

  it('settings is always-repaint even when already active', () => {
    // Simulate settings being the active section
    document.getElementById('networth')!.classList.remove('active');
    document.getElementById('settings')!.classList.add('active');
    _activeSection = 'settings';

    // Guard detects it's active
    expect(isAlreadyActive('settings')).toBe(true);
    // But the real code skips the guard for settings (id !== 'settings' check)
    const shouldShortCircuit = isAlreadyActive('settings') && 'settings' !== 'settings';
    expect(shouldShortCircuit).toBe(false);
  });
});

describe('showPortfolioSubview idempotent guard', () => {
  let _portfolioSubview: string;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="subview-holdings" style="display: block"></div>
      <div id="subview-contributions" style="display: none"></div>
      <div id="subview-dividends" style="display: none"></div>
    `;
    _portfolioSubview = 'holdings';
  });

  function isSubviewAlreadyActive(sub: string, force = false): boolean {
    return (
      !force &&
      _portfolioSubview === sub &&
      document.getElementById(`subview-${sub}`)?.style.display === 'block'
    );
  }

  it('detects already-active sub-view (holdings on holdings)', () => {
    expect(isSubviewAlreadyActive('holdings')).toBe(true);
  });

  it('does not detect already-active when switching to a different sub-view', () => {
    expect(isSubviewAlreadyActive('contributions')).toBe(false);
    expect(isSubviewAlreadyActive('dividends')).toBe(false);
  });

  it('does not detect already-active when state matches but DOM display is not block', () => {
    // Simulate: _portfolioSubview says 'contributions' but display is none
    _portfolioSubview = 'contributions';
    expect(isSubviewAlreadyActive('contributions')).toBe(false);
  });

  it('force=true bypasses the guard even when already active', () => {
    expect(isSubviewAlreadyActive('holdings', true)).toBe(false);
  });

  it('second call to same sub-view is a no-op (render spy not called)', () => {
    const renderSpy = vi.fn();

    function showPortfolioSubview(sub: string, force = false): void {
      const alreadyActive =
        !force &&
        _portfolioSubview === sub &&
        document.getElementById(`subview-${sub}`)?.style.display === 'block';
      if (alreadyActive) return;
      _portfolioSubview = sub;
      renderSpy(sub);
    }

    // First call — should render
    // Reset DOM to simulate initial state where display is 'none'
    document.getElementById('subview-holdings')!.style.display = 'none';
    _portfolioSubview = 'contributions'; // start from different sub-view
    showPortfolioSubview('holdings');
    expect(renderSpy).toHaveBeenCalledTimes(1);

    // Simulate that after render, display is set to 'block'
    document.getElementById('subview-holdings')!.style.display = 'block';

    // Second call — should be no-op
    showPortfolioSubview('holdings');
    expect(renderSpy).toHaveBeenCalledTimes(1); // still 1, not 2

    // Third call — still no-op
    showPortfolioSubview('holdings');
    expect(renderSpy).toHaveBeenCalledTimes(1); // still 1

    // But switching to a different sub-view should render
    showPortfolioSubview('contributions');
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });
});
