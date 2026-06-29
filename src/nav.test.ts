import { describe, it, expect } from 'vitest';
import { navHash, parseNavHash } from './nav';

describe('navHash', () => {
  it('returns #networth for networth section', () => {
    expect(navHash('networth')).toBe('#networth');
  });

  it('returns #portfolio for portfolio with default holdings subview', () => {
    expect(navHash('portfolio', 'holdings')).toBe('#portfolio');
  });

  it('returns #portfolio for portfolio with no subview', () => {
    expect(navHash('portfolio')).toBe('#portfolio');
  });

  it('returns #portfolio/contributions for contributions subview', () => {
    expect(navHash('portfolio', 'contributions')).toBe('#portfolio/contributions');
  });

  it('returns #portfolio/dividends for dividends subview', () => {
    expect(navHash('portfolio', 'dividends')).toBe('#portfolio/dividends');
  });

  it('returns #settings for settings section', () => {
    expect(navHash('settings')).toBe('#settings');
  });

  it('returns #log for log section', () => {
    expect(navHash('log')).toBe('#log');
  });
});

describe('parseNavHash', () => {
  it('returns networth for empty string', () => {
    expect(parseNavHash('')).toEqual({ section: 'networth', subview: null });
  });

  it('returns networth for hash-only', () => {
    expect(parseNavHash('#')).toEqual({ section: 'networth', subview: null });
  });

  it('returns portfolio with null subview for #portfolio', () => {
    expect(parseNavHash('portfolio')).toEqual({ section: 'portfolio', subview: null });
  });

  it('returns portfolio with contributions subview', () => {
    expect(parseNavHash('portfolio/contributions')).toEqual({ section: 'portfolio', subview: 'contributions' });
  });

  it('returns portfolio with dividends subview', () => {
    expect(parseNavHash('#portfolio/dividends')).toEqual({ section: 'portfolio', subview: 'dividends' });
  });

  it('returns portfolio with holdings subview', () => {
    expect(parseNavHash('#portfolio/holdings')).toEqual({ section: 'portfolio', subview: 'holdings' });
  });

  it('returns networth for unknown section', () => {
    expect(parseNavHash('unknown')).toEqual({ section: 'networth', subview: null });
  });

  it('returns portfolio with null subview for unknown subview', () => {
    expect(parseNavHash('portfolio/unknown')).toEqual({ section: 'portfolio', subview: null });
  });

  it('returns settings for #settings', () => {
    expect(parseNavHash('#settings')).toEqual({ section: 'settings', subview: null });
  });

  it('returns log for #log', () => {
    expect(parseNavHash('#log')).toEqual({ section: 'log', subview: null });
  });
});
