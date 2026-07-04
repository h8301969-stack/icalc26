/**
 * Production-grade tests for calculator
 * Run with: npm test
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateExpression,
  safeEvaluate,
  CalculationError,
  isValidPartialExpression,
  sanitizeClipboardExpression,
} from './calculator';

describe('Basic Operations', () => {
  it('Addition: 2 + 3 = 5', () => {
    expect(evaluateExpression('2+3')).toBe(5);
  });

  it('Addition with spaces: 10 + 5 = 15', () => {
    expect(evaluateExpression('10 + 5')).toBe(15);
  });

  it('Subtraction: 5 - 2 = 3', () => {
    expect(evaluateExpression('5-2')).toBe(3);
  });

  it('Subtraction: 10 - 3 = 7', () => {
    expect(evaluateExpression('10 - 3')).toBe(7);
  });

  it('Multiplication: 2 * 3 = 6', () => {
    expect(evaluateExpression('2*3')).toBe(6);
  });

  it('Multiplication: 10 * 5 = 50', () => {
    expect(evaluateExpression('10 * 5')).toBe(50);
  });

  it('Division: 6 / 2 = 3', () => {
    expect(evaluateExpression('6/2')).toBe(3);
  });

  it('Division: 10 / 4 = 2.5', () => {
    expect(evaluateExpression('10/4')).toBe(2.5);
  });

  it('Modulo: 10 % 3 = 1', () => {
    expect(evaluateExpression('10%3')).toBe(1);
  });

  it('Modulo: 7 % 3 = 1', () => {
    expect(evaluateExpression('7%3')).toBe(1);
  });
});

describe('Operator Precedence', () => {
  it('2 + 3 * 4 = 14 (not 20)', () => {
    expect(evaluateExpression('2+3*4')).toBe(14);
  });

  it('1 + 2 * 3 + 4 = 11', () => {
    expect(evaluateExpression('1+2*3+4')).toBe(11);
  });

  it('10 - 6 / 2 = 7 (not 2)', () => {
    expect(evaluateExpression('10-6/2')).toBe(7);
  });

  it('20 - 8 / 4 = 18', () => {
    expect(evaluateExpression('20-8/4')).toBe(18);
  });

  it('10 - 5 - 2 = 3 (left associative)', () => {
    expect(evaluateExpression('10-5-2')).toBe(3);
  });

  it('20 / 4 / 2 = 2.5 (left associative)', () => {
    expect(evaluateExpression('20/4/2')).toBe(2.5);
  });

  it('2 + 3 * 4 - 5 = 9', () => {
    expect(evaluateExpression('2+3*4-5')).toBe(9);
  });

  it('100 / 10 + 5 * 2 = 20', () => {
    expect(evaluateExpression('100/10+5*2')).toBe(20);
  });
});

describe('Parentheses', () => {
  it('(2 + 3) * 4 = 20 (not 14)', () => {
    expect(evaluateExpression('(2+3)*4')).toBe(20);
  });

  it('2 * (3 + 4) = 14', () => {
    expect(evaluateExpression('2*(3+4)')).toBe(14);
  });

  it('((2 + 3) * 4) = 20', () => {
    expect(evaluateExpression('((2+3)*4)')).toBe(20);
  });

  it('(2 * (3 + 4)) + 1 = 15', () => {
    expect(evaluateExpression('(2*(3+4))+1')).toBe(15);
  });

  it('(10 - 5) * (2 + 3) = 25', () => {
    expect(evaluateExpression('(10-5)*(2+3)')).toBe(25);
  });

  it('(2 + 3) * (4 + 5) / (1 + 1) = 22.5', () => {
    expect(evaluateExpression('(2+3)*(4+5)/(1+1)')).toBe(22.5);
  });
});

describe('Decimals', () => {
  it('2.5 + 1.5 = 4', () => {
    expect(evaluateExpression('2.5+1.5')).toBe(4);
  });

  it('10.5 - 0.5 = 10', () => {
    expect(evaluateExpression('10.5-0.5')).toBe(10);
  });

  it('1 / 3 ≈ 0.333', () => {
    expect(evaluateExpression('1/3')).toBeCloseTo(0.333, 2);
  });

  it('10 / 3 ≈ 3.333', () => {
    expect(evaluateExpression('10/3')).toBeCloseTo(3.333, 2);
  });

  it('1.5 + 2.5 * 3.0 = 9', () => {
    expect(evaluateExpression('1.5+2.5*3.0')).toBe(9);
  });
});

describe('iOS Symbol Support (× and ÷)', () => {
  it('2 × 3 = 6', () => {
    expect(evaluateExpression('2×3')).toBe(6);
  });

  it('2 × 3 + 4 = 10', () => {
    expect(evaluateExpression('2×3+4')).toBe(10);
  });

  it('6 ÷ 2 = 3', () => {
    expect(evaluateExpression('6÷2')).toBe(3);
  });

  it('10 ÷ 2 + 5 = 10', () => {
    expect(evaluateExpression('10÷2+5')).toBe(10);
  });

  it('(2 + 3) × 4 = 20', () => {
    expect(evaluateExpression('(2+3)×4')).toBe(20);
  });

  it('20 ÷ (2 + 2) = 5', () => {
    expect(evaluateExpression('20÷(2+2)')).toBe(5);
  });
});

describe('Error Handling', () => {
  it('Division by zero throws error', () => {
    expect(() => evaluateExpression('10/0')).toThrow(CalculationError);
  });

  it('5 / (2 - 2) throws error (division by zero)', () => {
    expect(() => evaluateExpression('5/(2-2)')).toThrow(CalculationError);
  });

  it('Modulo by zero throws error', () => {
    expect(() => evaluateExpression('10%0')).toThrow(CalculationError);
  });

  it('Empty expression throws error', () => {
    expect(() => evaluateExpression('')).toThrow(CalculationError);
  });

  it('Whitespace-only expression throws error', () => {
    expect(() => evaluateExpression('   ')).toThrow(CalculationError);
  });

  it('Expression starting with + throws error', () => {
    expect(() => evaluateExpression('+5')).toThrow(CalculationError);
  });

  it('Expression ending with operator throws error', () => {
    expect(() => evaluateExpression('5+')).toThrow(CalculationError);
  });

  it('Double operator throws error', () => {
    expect(() => evaluateExpression('5++3')).toThrow(CalculationError);
  });

  it('Mismatched closing parenthesis throws error', () => {
    expect(() => evaluateExpression('(2+3')).toThrow(CalculationError);
  });

  it('Extra closing parenthesis throws error', () => {
    expect(() => evaluateExpression('2+3)')).toThrow(CalculationError);
  });

  it('Double closing parenthesis throws error', () => {
    expect(() => evaluateExpression('((2+3)')).toThrow(CalculationError);
  });

  it('Double decimal throws error', () => {
    expect(() => evaluateExpression('2..5+3')).toThrow(CalculationError);
  });

  it('Invalid character throws error', () => {
    expect(() => evaluateExpression('2a+3')).toThrow(CalculationError);
  });

  it('Special character throws error', () => {
    expect(() => evaluateExpression('2&3')).toThrow(CalculationError);
  });
});

describe('Edge Cases', () => {
  it('0 + 5 = 5', () => {
    expect(evaluateExpression('0+5')).toBe(5);
  });

  it('0 - 5 = -5', () => {
    expect(evaluateExpression('0-5')).toBe(-5);
  });

  it('0 * 100 = 0', () => {
    expect(evaluateExpression('0*100')).toBe(0);
  });

  it('0 / 5 = 0', () => {
    expect(evaluateExpression('0/5')).toBe(0);
  });

  it('Negative number: -5 + 3 = -2', () => {
    expect(evaluateExpression('-5+3')).toBe(-2);
  });

  it('Parenthesized negative: (-5) + 3 = -2', () => {
    expect(evaluateExpression('(-5)+3')).toBe(-2);
  });

  it('Negative multiplication: 5 * -2 = -10', () => {
    expect(evaluateExpression('5*-2')).toBe(-10);
  });

  it('Expression with spaces: 2 + 3 = 5', () => {
    expect(evaluateExpression('2 + 3')).toBe(5);
  });

  it('Expression with leading/trailing spaces: "  2+3  " = 5', () => {
    expect(evaluateExpression('  2+3  ')).toBe(5);
  });

  it('Expression with multiple spaces: 2  +  3 = 5', () => {
    expect(evaluateExpression('2  +  3')).toBe(5);
  });

  it('Very large number: 999999999 + 1 = 1000000000', () => {
    expect(evaluateExpression('999999999+1')).toBe(1000000000);
  });

  it('Very small decimal: 0.001 + 0.002 ≈ 0.003', () => {
    expect(evaluateExpression('0.001+0.002')).toBeCloseTo(0.003, 3);
  });
});

describe('safeEvaluate - Safe Evaluation', () => {
  it('safeEvaluate("2+3") = "5.00"', () => {
    expect(safeEvaluate('2+3')).toBe('5.00');
  });

  it('safeEvaluate("10/3") = "3.33"', () => {
    expect(safeEvaluate('10/3')).toBe('3.33');
  });

  it('safeEvaluate("10/0") returns "0.00" safely', () => {
    expect(safeEvaluate('10/0')).toBe('0.00');
  });

  it('safeEvaluate("invalid") returns "0.00" safely', () => {
    expect(safeEvaluate('invalid')).toBe('0.00');
  });

  it('safeEvaluate("1/3", 4) = "0.3333"', () => {
    expect(safeEvaluate('1/3', 4)).toBe('0.3333');
  });

  it('safeEvaluate("10/3", 1) = "3.3"', () => {
    expect(safeEvaluate('10/3', 1)).toBe('3.3');
  });

  it('safeEvaluate("") = "0.00"', () => {
    expect(safeEvaluate('')).toBe('0.00');
  });

  it('safeEvaluate("0") = "0.00"', () => {
    expect(safeEvaluate('0')).toBe('0.00');
  });
});

describe('sanitizeClipboardExpression', () => {
  it('keeps math expressions and normalizes operators', () => {
    expect(sanitizeClipboardExpression('2 * 3 + 4')).toBe('2×3+4');
    expect(sanitizeClipboardExpression('10 / 2')).toBe('10÷2');
  });

  it('keeps POS quantity expressions', () => {
    expect(sanitizeClipboardExpression('56x2+120x1')).toBe('56x2+120x1');
  });

  it('strips non-math text', () => {
    expect(sanitizeClipboardExpression('56 ghs has been added to invoice')).toBe('56');
    expect(sanitizeClipboardExpression('hello')).toBe('');
  });

  it('removes thousands separators', () => {
    expect(sanitizeClipboardExpression('1,234.56+2')).toBe('1234.56+2');
  });
});

describe('isValidPartialExpression - Validation', () => {
  it('isValidPartialExpression("5") = true', () => {
    expect(isValidPartialExpression('5')).toBe(true);
  });

  it('isValidPartialExpression("2+3") = true', () => {
    expect(isValidPartialExpression('2+3')).toBe(true);
  });

  it('isValidPartialExpression("2+3*4") = true', () => {
    expect(isValidPartialExpression('2+3*4')).toBe(true);
  });

  it('isValidPartialExpression("2+") = false', () => {
    expect(isValidPartialExpression('2+')).toBe(false);
  });

  it('isValidPartialExpression("5*") = false', () => {
    expect(isValidPartialExpression('5*')).toBe(false);
  });

  it('isValidPartialExpression("") = true', () => {
    expect(isValidPartialExpression('')).toBe(true);
  });

  it('isValidPartialExpression("0") = true', () => {
    expect(isValidPartialExpression('0')).toBe(true);
  });
});

describe('Real-world Scenarios', () => {
  it('Shopping bill: 10.50 + 5.25 + 3.99 ≈ 19.74', () => {
    expect(evaluateExpression('10.50+5.25+3.99')).toBeCloseTo(19.74, 2);
  });

  it('Tip calculation: 100 * 0.20 = 20', () => {
    expect(evaluateExpression('100*0.20')).toBe(20);
  });

  it('Compound: (50 + 30) * 2 / 4 = 40', () => {
    expect(evaluateExpression('(50+30)*2/4')).toBe(40);
  });

  it('Discount: 100 - (100 * 0.15) = 85', () => {
    expect(evaluateExpression('100-(100*0.15)')).toBe(85);
  });

  it('Complex: (5 + 3) * (4 - 1) / 2 = 12', () => {
    expect(evaluateExpression('(5+3)*(4-1)/2')).toBe(12);
  });
});