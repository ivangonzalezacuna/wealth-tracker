import { describe, it, expect } from 'vitest';
import { parseNum } from './csv';

describe('parseNum', () => {
  it('parses German comma-decimal "1234,56"', () => {
    expect(parseNum('1234,56')).toBeCloseTo(1234.56);
  });

  it('parses German thousands+comma "1.234,56"', () => {
    expect(parseNum('1.234,56')).toBeCloseTo(1234.56);
  });

  it('parses dot-decimal "1234.56"', () => {
    expect(parseNum('1234.56')).toBeCloseTo(1234.56);
  });

  it('returns 0 for empty string', () => {
    expect(parseNum('')).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(parseNum(undefined)).toBe(0);
  });
});
