/**
 * Safe mathematical expression evaluator with proper operator precedence
 * Handles: +, -, *, /, %, decimal numbers
 * Returns: { result: number, error?: string }
 */

interface EvaluationResult {
  result: number;
  error?: string;
}

/**
 * Tokenize expression into numbers and operators
 */
function tokenize(expr: string): (number | string)[] {
  const tokens: (number | string)[] = [];
  let currentNum = '';

  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];

    // Handle operators
    if (['+', '-', '*', '/', '%', '×', '÷'].includes(char)) {
      if (currentNum) {
        const num = parseFloat(currentNum);
        if (isNaN(num)) throw new Error('Invalid number format');
        tokens.push(num);
        currentNum = '';
      }
      // Normalize operators
      if (char === '×') tokens.push('*');
      else if (char === '÷') tokens.push('/');
      else tokens.push(char);
    } else if (char === '.') {
      // Allow only one decimal point per number
      if (currentNum.includes('.')) throw new Error('Invalid decimal format');
      currentNum += char;
    } else if (/\d/.test(char)) {
      currentNum += char;
    } else if (char === ' ') {
      // Skip whitespace
      continue;
    } else {
      throw new Error(`Invalid character: ${char}`);
    }
  }

  // Push final number
  if (currentNum) {
    const num = parseFloat(currentNum);
    if (isNaN(num)) throw new Error('Invalid number format');
    tokens.push(num);
  }

  return tokens;
}

/**
 * Validate token sequence (should be num op num op num ...)
 */
function validateTokens(tokens: (number | string)[]): void {
  if (tokens.length === 0) throw new Error('Empty expression');

  for (let i = 0; i < tokens.length; i++) {
    const isNumber = typeof tokens[i] === 'number';
    const shouldBeNumber = i % 2 === 0;

    if (isNumber !== shouldBeNumber) {
      throw new Error('Invalid expression syntax');
    }
  }

  // Must end with a number
  if (typeof tokens[tokens.length - 1] !== 'number') {
    throw new Error('Expression cannot end with operator');
  }
}

/**
 * Handle multiplication and division (higher precedence)
 */
function evaluateMultDiv(tokens: (number | string)[]): (number | string)[] {
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i] === '*' || tokens[i] === '/') {
      const left = tokens[i - 1] as number;
      const op = tokens[i] as string;
      const right = tokens[i + 1] as number;

      let result: number;
      if (op === '*') {
        result = left * right;
      } else {
        if (right === 0) throw new Error('Division by zero');
        result = left / right;
      }

      tokens.splice(i - 1, 3, result);
      i--; // Re-check this position
    } else if (tokens[i] === '%') {
      const left = tokens[i - 1] as number;
      const right = tokens[i + 1] as number;

      if (right === 0) throw new Error('Modulo by zero');
      const result = left % right;

      tokens.splice(i - 1, 3, result);
      i--;
    } else {
      i++;
    }
  }
  return tokens;
}

/**
 * Handle addition and subtraction (lower precedence)
 */
function evaluateAddSub(tokens: (number | string)[]): number {
  let result = tokens[0] as number;

  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i] as string;
    const right = tokens[i + 1] as number;

    if (op === '+') {
      result += right;
    } else if (op === '-') {
      result -= right;
    }
  }

  return result;
}

/**
 * Main evaluator function
 */
export function evaluate(expression: string): EvaluationResult {
  try {
    // Clean input
    const cleaned = expression.trim();

    if (!cleaned || cleaned === '0') {
      return { result: 0 };
    }

    // Tokenize
    const tokens = tokenize(cleaned);

    // Validate
    validateTokens(tokens);

    // Evaluate: multiplication/division first, then addition/subtraction
    const afterMultDiv = evaluateMultDiv(tokens);
    const result = evaluateAddSub(afterMultDiv);

    // Validate result
    if (isNaN(result)) throw new Error('Calculation resulted in NaN');
    if (!isFinite(result)) throw new Error('Calculation resulted in Infinity');

    return { result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      result: 0,
      error: message,
    };
  }
}

/**
 * Format result for display
 */
export function formatResult(num: number, maxDecimals: number = 10): string {
  // Remove floating point errors
  const rounded = Math.round(num * 1e10) / 1e10;

  // Format with appropriate decimal places
  if (Number.isInteger(rounded)) {
    return rounded.toString();
  }

  // Remove trailing zeros
  return rounded.toFixed(maxDecimals).replace(/\.?0+$/, '');
}
