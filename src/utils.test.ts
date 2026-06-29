import { describe, it, expect } from 'vitest';
import { fmt } from './utils';

describe('fmt', () => {
  it('renders 2-decimal cents with comma separator (de-DE)', () => {
    const result = fmt(1234.56, 2);
    // de-DE uses comma as decimal separator
    expect(result).toContain(',');
    expect(result).toContain('56');
  });

  it('rounds to whole euros by default (d=0)', () => {
    const result = fmt(1234.56);
    // Should not contain decimal cents
    expect(result).toContain('1.235');
    expect(result).not.toContain('56');
  });

  it('starts with euro sign', () => {
    expect(fmt(100)).toMatch(/^€/);
    expect(fmt(100, 2)).toMatch(/^€/);
  });
});
