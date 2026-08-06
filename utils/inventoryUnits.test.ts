import { describe, expect, it } from 'vitest';
import { boxFractionLabel, formatBoxQuantity, gcd } from './inventoryUnits';

describe('inventoryUnits', () => {
  it('gcd', () => {
    expect(gcd(8, 4)).toBe(4);
    expect(gcd(4, 8)).toBe(4);
  });

  it('half box when 4 of 8', () => {
    expect(boxFractionLabel(4, 8)).toBe('1/2 box');
    expect(formatBoxQuantity(4, 8)).toContain('1/2 box');
  });

  it('whole boxes', () => {
    expect(boxFractionLabel(16, 8)).toBe('2 boxes');
    expect(formatBoxQuantity(16, 8)).toContain('2 boxes');
  });
});
