import { describe, expect, it } from 'vitest';
import {
  buildPosExpressionFromItems,
  countCompletedPriceOccurrences,
  getPosPriceSpans,
  getTrailingMultiplyPrice,
  isBlankExpression,
  resolveInvoiceContinueExpression,
} from './posExpression';

describe('resolveInvoiceContinueExpression', () => {
  it('uses the stored expression when it is a real calc string', () => {
    expect(
      resolveInvoiceContinueExpression('10x2+5', [{ price: 99, quantity: 1 }])
    ).toBe('10x2+5');
  });

  it('does not treat stored 0 as the invoice to continue', () => {
    expect(
      resolveInvoiceContinueExpression('0', [
        { price: 10, quantity: 2 },
        { price: 5, quantity: 1 },
      ])
    ).toBe(buildPosExpressionFromItems([
      { price: 10, quantity: 2 },
      { price: 5, quantity: 1 },
    ]));
  });

  it('rebuilds from line items when nothing is stored', () => {
    expect(
      resolveInvoiceContinueExpression(undefined, [{ price: 20, quantity: 3 }])
    ).toBe('20x3');
  });

  it('returns 0 when both stored expr and items are empty', () => {
    expect(resolveInvoiceContinueExpression('0', [])).toBe('0');
    expect(isBlankExpression('0')).toBe(true);
  });
});

describe('getTrailingMultiplyPrice', () => {
  it('reads the price waiting for quantity after ×', () => {
    expect(getTrailingMultiplyPrice('78×')).toBe(78);
    expect(getTrailingMultiplyPrice('78x')).toBe(78);
    expect(getTrailingMultiplyPrice('10x2+78×')).toBe(78);
    expect(getTrailingMultiplyPrice('12.5x')).toBe(12.5);
  });

  it('ignores complete lines and non-POS expressions', () => {
    expect(getTrailingMultiplyPrice('78x2')).toBeNull();
    expect(getTrailingMultiplyPrice('78')).toBeNull();
    expect(getTrailingMultiplyPrice('0')).toBeNull();
    expect(getTrailingMultiplyPrice('10-78×')).toBeNull();
  });
});

describe('countCompletedPriceOccurrences', () => {
  it('does not count the trailing price× as a completed line', () => {
    expect(countCompletedPriceOccurrences('78×', 78)).toBe(0);
    expect(countCompletedPriceOccurrences('78x2+78×', 78)).toBe(1);
    expect(countCompletedPriceOccurrences('10x1+78×', 78)).toBe(0);
  });
});

describe('getPosPriceSpans', () => {
  it('marks each price and a following × as the tap target', () => {
    const spans = getPosPriceSpans('78×2+10x1');
    expect(spans).toEqual([
      { start: 0, end: 3, price: 78, occurrence: 0 },
      { start: 5, end: 8, price: 10, occurrence: 0 },
    ]);
  });

  it('counts a second line at the same price as a later occurrence', () => {
    const spans = getPosPriceSpans('78x2+78x3');
    expect(spans.map((s) => ({ price: s.price, occurrence: s.occurrence }))).toEqual([
      { price: 78, occurrence: 0 },
      { price: 78, occurrence: 1 },
    ]);
  });
});
