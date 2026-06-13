import Fraction from 'fraction.js';

export class CalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculationError';
  }
}

/**
 * Production-grade Math Engine
 * Uses Recursive Descent Parsing and Fraction.js for precision.
 */
export const evaluateExpression = (input: string): number => {
  const sanitized = input.replace(/×/g, '*').replace(/÷/g, '/').trim();
  if (!sanitized) throw new CalculationError('Empty expression');

  const tokens = tokenize(sanitized);
  let pos = 0;

  const parseExpression = (): Fraction => {
    let node = parseTerm();
    while (pos < tokens.length && (tokens[pos] === '+' || tokens[pos] === '-')) {
      const op = tokens[pos++];
      const right = parseTerm();
      node = op === '+' ? node.add(right) : node.sub(right);
    }
    return node;
  };

  const parseTerm = (): Fraction => {
    let node = parseFactor();
    while (pos < tokens.length && (tokens[pos] === '*' || tokens[pos] === '/' || tokens[pos] === '%')) {
      const op = tokens[pos++];
      const right = parseFactor();
      if (op === '/' || op === '%') {
        if (right.equals(0)) throw new CalculationError('Division by zero');
        node = op === '/' ? node.div(right) : node.mod(right);
      } else {
        node = node.mul(right);
      }
    }
    return node;
  };

  const parseFactor = (): Fraction => {
    const token = tokens[pos++];
    if (token === '(') {
      const val = parseExpression();
      if (tokens[pos++] !== ')') throw new CalculationError('Mismatched parentheses');
      return val;
    }
    if (token === '-') {
      return parseFactor().mul(-1);
    }
    if (!isNaN(Number(token))) {
      return new Fraction(token);
    }
    throw new CalculationError(`Invalid token: ${token}`);
  };

  const result = parseExpression();
  if (pos !== tokens.length) throw new CalculationError('Invalid expression syntax');
  return result.valueOf();
};

const tokenize = (str: string): string[] => {
  const regex = /\d*\.?\d+|[+\-*/%()]/g;
  const matches = str.match(regex);
  if (!matches) throw new CalculationError('No valid tokens found');
  return matches;
};

export const safeEvaluate = (expr: string, decimals = 2): string => {
  try {
    // Clean trailing operators before evaluation
    const cleanExpr = expr.replace(/[+\-*/%×÷(]+$/, '');
    if (!cleanExpr || cleanExpr === '0') return '0.00';
    
    const result = evaluateExpression(cleanExpr);
    if (!isFinite(result)) return '0.00';
    
    return result.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: false
    });
  } catch {
    return '0.00';
  }
};

export const isValidPartialExpression = (expr: string): boolean => {
  if (!expr) return true;
  try {
    const sanitized = expr.replace(/×/g, '*').replace(/÷/g, '/');
    // Simple check: shouldn't end with a binary operator for a "final" evaluation
    return !/[+\-*/%]$/.test(sanitized);
  } catch {
    return false;
  }
};

/**
 * Handles complex toggle sign logic for expression strings
 */
export const toggleExpressionSign = (expression: string): string => {
  if (expression === '0') return '0';
  
  // Regex to find the last number or parenthesized group
  const match = expression.match(/([+\-×÷(]|^)(-?\d*\.?\d*)$/);
  if (!match) return expression;

  const prefix = expression.slice(0, match.index! + (match[1] ? match[1].length : 0));
  let lastNum = match[2] || '';

  if (lastNum === '' && prefix.endsWith('(')) {
     return expression; // Don't negate empty parens yet
  }

  const toggled = lastNum.startsWith('-') ? lastNum.slice(1) : '-' + lastNum;
  
  // Cleanup double negatives or operator clashes
  let result = prefix + toggled;
  return result
    .replace(/\+\-/g, '-')
    .replace(/\-\-/g, '+')
    .replace(/×\-/g, '×-')
    .replace(/÷\-/g, '÷-')
    .replace(/\(\-/g, '(-');
};