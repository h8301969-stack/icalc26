/**
 * Production-grade expression evaluator
 * Handles operator precedence, decimals, and validates input
 */

export class CalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculationError';
  }
}

interface Token {
  type: 'number' | 'operator' | 'paren';
  value: string;
}

/**
 * Tokenizes an expression string
 * Supports unary minus (negation) and rejects invalid characters.
 */
function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const char = expr[i];

    if (char === ' ') {
      i++;
      continue;
    }

    if (/\d/.test(char) || char === '.') {
      let current = '';
      while (i < expr.length && (/\d/.test(expr[i]) || expr[i] === '.')) {
        current += expr[i];
        i++;
      }
      if (current.endsWith('.')) {
        throw new CalculationError('Invalid decimal number');
      }
      tokens.push({ type: 'number', value: current });
      continue;
    }

    if (['+', '*', '/', '%', '×', '÷'].includes(char)) {
      const op = char === '×' ? '*' : char === '÷' ? '/' : char;
      tokens.push({ type: 'operator', value: op });
      i++;
      continue;
    }

    if (char === '-') {
      const prev = tokens.length > 0 ? tokens[tokens.length - 1] : null;
      const isUnaryContext = !prev ||
        prev.type === 'operator' ||
        (prev.type === 'paren' && prev.value === '(');

      if (isUnaryContext) {
        i++; // consume the '-'
        let num = '';
        while (i < expr.length && (/\d/.test(expr[i]) || expr[i] === '.')) {
          num += expr[i];
          i++;
        }
        if (!num) {
          // unary minus not followed by digits, e.g. "5*-" or "(-" at end
          tokens.push({ type: 'operator', value: '-' });
          continue;
        }
        if (num.startsWith('.')) num = '0' + num;
        if (num.endsWith('.')) {
          throw new CalculationError('Invalid decimal number');
        }
        tokens.push({ type: 'number', value: '-' + num });
        continue;
      } else {
        // binary minus
        tokens.push({ type: 'operator', value: '-' });
        i++;
        continue;
      }
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char });
      i++;
      continue;
    }

    // Unknown character -> invalid input
    throw new CalculationError('Invalid character in expression');
  }

  return tokens;
}

/**
 * Validates tokens for syntax errors
 */
function validateTokens(tokens: Token[]): void {
  if (tokens.length === 0) {
    throw new CalculationError('Empty expression');
  }

  // Check for invalid token sequences
  for (let i = 0; i < tokens.length; i++) {
    const curr = tokens[i];
    const next = tokens[i + 1];
    const prev = tokens[i - 1];

    // Operator can't be at start (except minus for negation)
    if (curr.type === 'operator' && i === 0 && curr.value !== '-') {
      throw new CalculationError('Expression cannot start with an operator');
    }

    // Two operators in a row
    if (curr.type === 'operator' && next?.type === 'operator') {
      throw new CalculationError('Cannot have two operators in a row');
    }

    // Invalid decimal
    if (curr.type === 'number' && (curr.value === '.' || /\.\d*\./.test(curr.value))) {
      throw new CalculationError('Invalid decimal number');
    }

    // Parenthesis mismatch
    if (curr.type === 'paren' && curr.value === ')' && prev?.type === 'operator') {
      throw new CalculationError('Invalid expression near parenthesis');
    }
  }

  // Check balanced parentheses
  let parenCount = 0;
  for (const token of tokens) {
    if (token.type === 'paren') {
      parenCount += token.value === '(' ? 1 : -1;
      if (parenCount < 0) {
        throw new CalculationError('Unmatched closing parenthesis');
      }
    }
  }
  if (parenCount !== 0) {
    throw new CalculationError('Unmatched opening parenthesis');
  }
}

/**
 * Recursive descent parser with proper precedence
 */
class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private current(): Token | null {
    return this.tokens[this.pos] ?? null;
  }

  private advance(): void {
    this.pos++;
  }

  private consume(expected: string): Token {
    const curr = this.current();
    if (!curr || curr.value !== expected) {
      throw new CalculationError(`Expected ${expected}`);
    }
    this.advance();
    return curr;
  }

  parse(): number {
    const result = this.parseAddition();
    if (this.current() !== null) {
      throw new CalculationError('Unexpected tokens after expression');
    }
    return result;
  }

  private parseAddition(): number {
    let left = this.parseMultiplication();

    while (this.current()?.type === 'operator' && ['+', '-'].includes(this.current()!.value)) {
      const op = this.current()!.value;
      this.advance();
      const right = this.parseMultiplication();
      left = op === '+' ? left + right : left - right;
    }

    return left;
  }

  private parseMultiplication(): number {
    let left = this.parsePrimary();

    while (this.current()?.type === 'operator' && ['*', '/', '%'].includes(this.current()!.value)) {
      const op = this.current()!.value;
      this.advance();
      const right = this.parsePrimary();

      if (op === '*') {
        left = left * right;
      } else if (op === '/') {
        if (right === 0) {
          throw new CalculationError('Division by zero');
        }
        left = left / right;
      } else if (op === '%') {
        if (right === 0) {
          throw new CalculationError('Modulo by zero');
        }
        left = left % right;
      }
    }

    return left;
  }

  private parsePrimary(): number {
    const curr = this.current();

    if (!curr) {
      throw new CalculationError('Unexpected end of expression');
    }

    // Parenthesized expression
    if (curr.type === 'paren' && curr.value === '(') {
      this.advance();
      const result = this.parseAddition();
      this.consume(')');
      return result;
    }

    // Number
    if (curr.type === 'number') {
      const value = parseFloat(curr.value);
      if (isNaN(value)) {
        throw new CalculationError('Invalid number');
      }
      this.advance();
      return value;
    }

    throw new CalculationError('Unexpected token in expression');
  }
}

/**
 * Evaluates a mathematical expression string
 * @throws CalculationError if expression is invalid
 */
export function evaluateExpression(expr: string): number {
  if (!expr || expr.trim() === '') {
    throw new CalculationError('Empty expression');
  }

  const tokens = tokenize(expr);
  validateTokens(tokens);
  const parser = new Parser(tokens);
  const result = parser.parse();

  if (!isFinite(result)) {
    throw new CalculationError('Result is not a valid number');
  }

  return result;
}

/**
 * Safely evaluates expression and returns formatted result.
 * Never throws — returns a default formatted value on any error (for live previews).
 */
export function safeEvaluate(expr: string, decimalPlaces: number = 2, defaultValue: string = '0.00'): string {
  try {
    if (!expr || expr === '0') return defaultValue;

    const result = evaluateExpression(expr);
    if (!isFinite(result)) return defaultValue;
    return result.toFixed(decimalPlaces);
  } catch {
    return defaultValue;
  }
}

/**
 * Validates if a string is a valid incomplete expression
 */
export function isValidPartialExpression(expr: string): boolean {
  if (!expr || expr === '0') return true;

  try {
    const tokens = tokenize(expr);
    // Valid partial if it doesn't end with an operator
    const last = tokens[tokens.length - 1];
    return last?.type !== 'operator';
  } catch {
    return false;
  }
}
