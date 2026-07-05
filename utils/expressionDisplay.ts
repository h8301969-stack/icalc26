import { isPosStyleExpression } from './posExpression';

export interface ExpressionPriceRange {
  start: number;
  end: number;
  price: number;
}

const priceInInventory = (price: number, inventoryPrices: number[]): boolean =>
  inventoryPrices.some((inv) => Math.abs(inv - price) < 0.001);

/** Character ranges of price literals not found in inventory (POS-style expressions). */
export const getUnidentifiedPriceRanges = (
  expression: string,
  inventoryPrices: number[]
): ExpressionPriceRange[] => {
  if (!expression || expression === '0') return [];

  const normalized = expression.replace(/×/g, 'x');
  if (!/^[\d.x+]+$/i.test(normalized.replace(/\s/g, ''))) return [];

  const ranges: ExpressionPriceRange[] = [];
  const parts = normalized.split('+');
  let searchFrom = 0;

  for (const part of parts) {
    if (!part) {
      searchFrom += 1;
      continue;
    }

    const partStart = normalized.indexOf(part, searchFrom);
    if (partStart === -1) continue;

    const priceMatch = part.match(/^(\d+(?:\.\d+)?)/);
    if (priceMatch) {
      const price = parseFloat(priceMatch[1]);
      if (!Number.isNaN(price) && !priceInInventory(price, inventoryPrices)) {
        ranges.push({
          start: partStart,
          end: partStart + priceMatch[1].length,
          price,
        });
      }
    }

    searchFrom = partStart + part.length + 1;
  }

  return ranges;
};

export type ExpressionSliceRole = 'price' | 'quantity' | 'separator' | 'plain';

export interface ExpressionRenderSlice {
  text: string;
  unidentified: boolean;
  showCursorAfter: boolean;
  role: ExpressionSliceRole;
}

const addPosStyleBreakpoints = (expression: string, breakpoints: Set<number>) => {
  if (!isPosStyleExpression(expression)) return;

  let segStart = 0;
  for (let i = 0; i <= expression.length; i++) {
    if (i === expression.length || expression[i] === '+') {
      const segment = expression.slice(segStart, i);
      const xRel = segment.search(/x|×/i);
      breakpoints.add(segStart);
      if (xRel >= 0) breakpoints.add(segStart + xRel);
      breakpoints.add(i);
      segStart = i + 1;
    }
  }
};

const getSliceRole = (expression: string, start: number, end: number): ExpressionSliceRole => {
  if (!isPosStyleExpression(expression)) return 'plain';

  const text = expression.slice(start, end);
  if (text === '+') return 'separator';

  let segStart = 0;
  for (let i = 0; i <= expression.length; i++) {
    if (i === expression.length || expression[i] === '+') {
      if (start >= segStart && end <= i) {
        const segment = expression.slice(segStart, i);
        const xRel = segment.search(/x|×/i);
        if (xRel < 0) return 'price';
        const qtyStart = segStart + xRel;
        if (end <= qtyStart) return 'price';
        return 'quantity';
      }
      segStart = i + 1;
    }
  }

  return 'plain';
};

/** Split expression into render slices with cursor + unidentified price highlights. */
export const buildExpressionRenderSlices = (
  expression: string,
  cursorPos: number,
  unidentifiedRanges: ExpressionPriceRange[]
): ExpressionRenderSlice[] => {
  if (!expression) return [];

  const breakpoints = new Set<number>([0, expression.length, cursorPos]);
  addPosStyleBreakpoints(expression, breakpoints);
  for (const range of unidentifiedRanges) {
    breakpoints.add(range.start);
    breakpoints.add(range.end);
  }

  const points = [...breakpoints].sort((a, b) => a - b);
  const slices: ExpressionRenderSlice[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (start >= end) continue;

    const text = expression.slice(start, end);
    const unidentified = unidentifiedRanges.some(
      (range) => start >= range.start && end <= range.end
    );

    slices.push({
      text,
      unidentified,
      showCursorAfter: end === cursorPos,
      role: getSliceRole(expression, start, end),
    });
  }

  return slices;
};