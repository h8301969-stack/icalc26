/**
 * Production-grade tests for calculator
 * Tests operator precedence, edge cases, and error handling
 * 
 * Run with: npm test
 * Or manually for debugging: node -r esbuild-register utils/calculator.test.ts
 */

import { evaluateExpression, safeEvaluate, CalculationError, isValidPartialExpression } from './calculator';

// Simple test framework for manual running
interface TestResult {
  passed: number;
  failed: number;
  errors: string[];
}

const results: TestResult = { passed: 0, failed: 0, errors: [] };

function assert(condition: boolean, message: string) {
  if (!condition) {
    results.failed++;
    results.errors.push(message);
    throw new Error(message);
  }
}

function assertEqual(actual: any, expected: any, message?: string) {
  const msg = message || `Expected ${expected}, got ${actual}`;
  assert(actual === expected, msg);
}

function assertClose(actual: number, expected: number, tolerance: number = 0.01) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `Expected ~${expected}, got ${actual} (tolerance: ${tolerance})`
  );
}

function assertThrows(fn: () => void, ErrorType?: any) {
  try {
    fn();
    assert(false, 'Expected function to throw an error');
  } catch (err) {
    if (ErrorType && !(err instanceof ErrorType)) {
      assert(false, `Expected ${ErrorType.name}, got ${err instanceof Error ? err.constructor.name : typeof err}`);
    }
  }
}

function test(name: string, fn: () => void) {
  try {
    fn();
    results.passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function describe(name: string, tests: () => void) {
  console.log(`\n${name}`);
  tests();
}

// ============= TESTS =============

describe('Basic Operations', () => {
  test('Addition: 2 + 3 = 5', () => {
    assertEqual(evaluateExpression('2+3'), 5);
  });

  test('Addition with spaces: 10 + 5 = 15', () => {
    assertEqual(evaluateExpression('10 + 5'), 15);
  });

  test('Subtraction: 5 - 2 = 3', () => {
    assertEqual(evaluateExpression('5-2'), 3);
  });

  test('Subtraction: 10 - 3 = 7', () => {
    assertEqual(evaluateExpression('10 - 3'), 7);
  });

  test('Multiplication: 2 * 3 = 6', () => {
    assertEqual(evaluateExpression('2*3'), 6);
  });

  test('Multiplication: 10 * 5 = 50', () => {
    assertEqual(evaluateExpression('10 * 5'), 50);
  });

  test('Division: 6 / 2 = 3', () => {
    assertEqual(evaluateExpression('6/2'), 3);
  });

  test('Division: 10 / 4 = 2.5', () => {
    assertEqual(evaluateExpression('10/4'), 2.5);
  });

  test('Modulo: 10 % 3 = 1', () => {
    assertEqual(evaluateExpression('10%3'), 1);
  });

  test('Modulo: 7 % 3 = 1', () => {
    assertEqual(evaluateExpression('7%3'), 1);
  });
});

describe('Operator Precedence', () => {
  test('2 + 3 * 4 = 14 (not 20)', () => {
    assertEqual(evaluateExpression('2+3*4'), 14);
  });

  test('1 + 2 * 3 + 4 = 11', () => {
    assertEqual(evaluateExpression('1+2*3+4'), 11);
  });

  test('10 - 6 / 2 = 7 (not 2)', () => {
    assertEqual(evaluateExpression('10-6/2'), 7);
  });

  test('20 - 8 / 4 = 18', () => {
    assertEqual(evaluateExpression('20-8/4'), 18);
  });

  test('10 - 5 - 2 = 3 (left associative)', () => {
    assertEqual(evaluateExpression('10-5-2'), 3);
  });

  test('20 / 4 / 2 = 2.5 (left associative)', () => {
    assertEqual(evaluateExpression('20/4/2'), 2.5);
  });

  test('2 + 3 * 4 - 5 = 9', () => {
    assertEqual(evaluateExpression('2+3*4-5'), 9);
  });

  test('100 / 10 + 5 * 2 = 20', () => {
    assertEqual(evaluateExpression('100/10+5*2'), 20);
  });
});

describe('Parentheses', () => {
  test('(2 + 3) * 4 = 20 (not 14)', () => {
    assertEqual(evaluateExpression('(2+3)*4'), 20);
  });

  test('2 * (3 + 4) = 14', () => {
    assertEqual(evaluateExpression('2*(3+4)'), 14);
  });

  test('((2 + 3) * 4) = 20', () => {
    assertEqual(evaluateExpression('((2+3)*4)'), 20);
  });

  test('(2 * (3 + 4)) + 1 = 15', () => {
    assertEqual(evaluateExpression('(2*(3+4))+1'), 15);
  });

  test('(10 - 5) * (2 + 3) = 25', () => {
    assertEqual(evaluateExpression('(10-5)*(2+3)'), 25);
  });

  test('(2 + 3) * (4 + 5) / (1 + 1) = 22.5', () => {
    assertEqual(evaluateExpression('(2+3)*(4+5)/(1+1)'), 22.5);
  });
});

describe('Decimals', () => {
  test('2.5 + 1.5 = 4', () => {
    assertEqual(evaluateExpression('2.5+1.5'), 4);
  });

  test('10.5 - 0.5 = 10', () => {
    assertEqual(evaluateExpression('10.5-0.5'), 10);
  });

  test('1 / 3 ≈ 0.333', () => {
    assertClose(evaluateExpression('1/3'), 0.333, 0.01);
  });

  test('10 / 3 ≈ 3.333', () => {
    assertClose(evaluateExpression('10/3'), 3.333, 0.01);
  });

  test('1.5 + 2.5 * 3.0 = 9', () => {
    assertEqual(evaluateExpression('1.5+2.5*3.0'), 9);
  });
});

describe('iOS Symbol Support (× and ÷)', () => {
  test('2 × 3 = 6', () => {
    assertEqual(evaluateExpression('2×3'), 6);
  });

  test('2 × 3 + 4 = 10', () => {
    assertEqual(evaluateExpression('2×3+4'), 10);
  });

  test('6 ÷ 2 = 3', () => {
    assertEqual(evaluateExpression('6÷2'), 3);
  });

  test('10 ÷ 2 + 5 = 10', () => {
    assertEqual(evaluateExpression('10÷2+5'), 10);
  });

  test('(2 + 3) × 4 = 20', () => {
    assertEqual(evaluateExpression('(2+3)×4'), 20);
  });

  test('20 ÷ (2 + 2) = 5', () => {
    assertEqual(evaluateExpression('20÷(2+2)'), 5);
  });
});

describe('Error Handling', () => {
  test('Division by zero throws error', () => {
    assertThrows(() => evaluateExpression('10/0'), CalculationError);
  });

  test('5 / (2 - 2) throws error (division by zero)', () => {
    assertThrows(() => evaluateExpression('5/(2-2)'), CalculationError);
  });

  test('Modulo by zero throws error', () => {
    assertThrows(() => evaluateExpression('10%0'), CalculationError);
  });

  test('Empty expression throws error', () => {
    assertThrows(() => evaluateExpression(''), CalculationError);
  });

  test('Whitespace-only expression throws error', () => {
    assertThrows(() => evaluateExpression('   '), CalculationError);
  });

  test('Expression starting with + throws error', () => {
    assertThrows(() => evaluateExpression('+5'), CalculationError);
  });

  test('Expression ending with operator throws error', () => {
    assertThrows(() => evaluateExpression('5+'), CalculationError);
  });

  test('Double operator throws error', () => {
    assertThrows(() => evaluateExpression('5++3'), CalculationError);
  });

  test('Mismatched closing parenthesis throws error', () => {
    assertThrows(() => evaluateExpression('(2+3'), CalculationError);
  });

  test('Extra closing parenthesis throws error', () => {
    assertThrows(() => evaluateExpression('2+3)'), CalculationError);
  });

  test('Double closing parenthesis throws error', () => {
    assertThrows(() => evaluateExpression('((2+3)'), CalculationError);
  });

  test('Double decimal throws error', () => {
    assertThrows(() => evaluateExpression('2..5+3'), CalculationError);
  });

  test('Invalid character throws error', () => {
    assertThrows(() => evaluateExpression('2a+3'), CalculationError);
  });

  test('Special character throws error', () => {
    assertThrows(() => evaluateExpression('2&3'), CalculationError);
  });
});

describe('Edge Cases', () => {
  test('0 + 5 = 5', () => {
    assertEqual(evaluateExpression('0+5'), 5);
  });

  test('0 - 5 = -5', () => {
    assertEqual(evaluateExpression('0-5'), -5);
  });

  test('0 * 100 = 0', () => {
    assertEqual(evaluateExpression('0*100'), 0);
  });

  test('0 / 5 = 0', () => {
    assertEqual(evaluateExpression('0/5'), 0);
  });

  test('Negative number: -5 + 3 = -2', () => {
    assertEqual(evaluateExpression('-5+3'), -2);
  });

  test('Parenthesized negative: (-5) + 3 = -2', () => {
    assertEqual(evaluateExpression('(-5)+3'), -2);
  });

  test('Negative multiplication: 5 * -2 = -10', () => {
    assertEqual(evaluateExpression('5*-2'), -10);
  });

  test('Expression with spaces: 2 + 3 = 5', () => {
    assertEqual(evaluateExpression('2 + 3'), 5);
  });

  test('Expression with leading/trailing spaces: "  2+3  " = 5', () => {
    assertEqual(evaluateExpression('  2+3  '), 5);
  });

  test('Expression with multiple spaces: 2  +  3 = 5', () => {
    assertEqual(evaluateExpression('2  +  3'), 5);
  });

  test('Very large number: 999999999 + 1 = 1000000000', () => {
    assertEqual(evaluateExpression('999999999+1'), 1000000000);
  });

  test('Very small decimal: 0.001 + 0.002 ≈ 0.003', () => {
    assertClose(evaluateExpression('0.001+0.002'), 0.003, 0.0001);
  });
});

describe('safeEvaluate - Safe Evaluation', () => {
  test('safeEvaluate("2+3") = "5.00"', () => {
    assertEqual(safeEvaluate('2+3'), '5.00');
  });

  test('safeEvaluate("10/3") = "3.33"', () => {
    assertEqual(safeEvaluate('10/3'), '3.33');
  });

  test('safeEvaluate("10/0") returns "0.00" safely', () => {
    assertEqual(safeEvaluate('10/0'), '0.00');
  });

  test('safeEvaluate("invalid") returns "0.00" safely', () => {
    assertEqual(safeEvaluate('invalid'), '0.00');
  });

  test('safeEvaluate("1/3", 4) = "0.3333"', () => {
    assertEqual(safeEvaluate('1/3', 4), '0.3333');
  });

  test('safeEvaluate("10/3", 1) = "3.3"', () => {
    assertEqual(safeEvaluate('10/3', 1), '3.3');
  });

  test('safeEvaluate("") = "0.00"', () => {
    assertEqual(safeEvaluate(''), '0.00');
  });

  test('safeEvaluate("0") = "0.00"', () => {
    assertEqual(safeEvaluate('0'), '0.00');
  });
});

describe('isValidPartialExpression - Validation', () => {
  test('isValidPartialExpression("5") = true', () => {
    assert(isValidPartialExpression('5'), 'Should validate single number');
  });

  test('isValidPartialExpression("2+3") = true', () => {
    assert(isValidPartialExpression('2+3'), 'Should validate complete expression');
  });

  test('isValidPartialExpression("2+3*4") = true', () => {
    assert(isValidPartialExpression('2+3*4'), 'Should validate complex expression');
  });

  test('isValidPartialExpression("2+") = false', () => {
    assert(!isValidPartialExpression('2+'), 'Should reject expression ending with operator');
  });

  test('isValidPartialExpression("5*") = false', () => {
    assert(!isValidPartialExpression('5*'), 'Should reject expression ending with operator');
  });

  test('isValidPartialExpression("") = true', () => {
    assert(isValidPartialExpression(''), 'Should allow empty input');
  });

  test('isValidPartialExpression("0") = true', () => {
    assert(isValidPartialExpression('0'), 'Should allow zero');
  });
});

describe('Real-world Scenarios', () => {
  test('Shopping bill: 10.50 + 5.25 + 3.99 ≈ 19.74', () => {
    assertClose(evaluateExpression('10.50+5.25+3.99'), 19.74, 0.01);
  });

  test('Tip calculation: 100 * 0.20 = 20', () => {
    assertEqual(evaluateExpression('100*0.20'), 20);
  });

  test('Compound: (50 + 30) * 2 / 4 = 40', () => {
    assertEqual(evaluateExpression('(50+30)*2/4'), 40);
  });

  test('Discount: 100 - (100 * 0.15) = 85', () => {
    assertEqual(evaluateExpression('100-(100*0.15)'), 85);
  });

  test('Complex: (5 + 3) * (4 - 1) / 2 = 12', () => {
    assertEqual(evaluateExpression('(5+3)*(4-1)/2'), 12);
  });
});

// ============= RESULTS =============

console.log(`\n${'='.repeat(50)}`);
console.log(`Tests Passed: ${results.passed}`);
console.log(`Tests Failed: ${results.failed}`);
if (results.errors.length > 0) {
  console.log(`\nFailures:`);
  results.errors.forEach(err => console.log(`  - ${err}`));
}
console.log(`${'='.repeat(50)}\n`);

export default results;

// Partial expression validation
test('Valid partial: "2+3"', () => {
  const valid = isValidPartialExpression('2+3');
  if (!valid) throw new Error('Should be valid');
});

test('Invalid partial: "2+" (ends with operator)', () => {
  const valid = isValidPartialExpression('2+');
  if (valid) throw new Error('Should be invalid');
});

console.log('\n✅ Calculator tests complete');
