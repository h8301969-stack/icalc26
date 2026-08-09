import { describe, expect, it } from 'vitest';
import { pickCarouselIndex, rubberBand } from './fluidSpring';

describe('rubberBand', () => {
  it('passes through in-bounds values', () => {
    expect(rubberBand(1.2, 0, 3, 1)).toBeCloseTo(1.2);
  });

  it('resists past min/max', () => {
    const below = rubberBand(-0.8, 0, 3, 1);
    const above = rubberBand(3.8, 0, 3, 1);
    expect(below).toBeLessThan(0);
    expect(below).toBeGreaterThan(-0.8);
    expect(above).toBeGreaterThan(3);
    expect(above).toBeLessThan(3.8);
  });
});

describe('pickCarouselIndex', () => {
  it('snaps to nearest without fling', () => {
    expect(pickCarouselIndex(2.1, 0, 0, 5)).toBe(2);
    expect(pickCarouselIndex(2.4, 0, 0, 5)).toBe(3);
    // 1.7 is 0.3 past center toward 1 → previous page
    expect(pickCarouselIndex(1.7, 0, 0, 5)).toBe(1);
    expect(pickCarouselIndex(1.6, 0, 0, 5)).toBe(1);
    expect(pickCarouselIndex(2.0, 0, 0, 5)).toBe(2);
  });

  it('honors fling toward next/previous', () => {
    expect(pickCarouselIndex(2.05, 0.002, 0, 5)).toBe(3);
    expect(pickCarouselIndex(2.05, -0.002, 0, 5)).toBe(1);
  });

  it('clamps to bounds', () => {
    expect(pickCarouselIndex(0.1, -0.005, 0, 5)).toBe(0);
    expect(pickCarouselIndex(4.9, 0.005, 0, 5)).toBe(5);
  });
});
