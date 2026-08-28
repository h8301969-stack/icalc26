export interface PosLineItem {
  price: number;
  quantity: number;
}

const normalizeExpression = (expression: string): string =>
  expression.replace(/×/g, 'x').replace(/\s/g, '');

export const isPosStyleExpression = (expression: string): boolean => {
  if (!expression || expression === '0') return false;
  const normalized = normalizeExpression(expression);
  if (/[-÷/%()]/.test(normalized)) return false;
  return /^[\d.x+]+$/i.test(normalized);
};

export const parsePosLineItems = (expression: string): PosLineItem[] => {
  if (!expression || expression === '0') return [];

  const cleaned = normalizeExpression(expression)
    .replace(/[+x]$/i, '')
    .replace(/^\+/, '');

  if (!cleaned) return [];

  return cleaned
    .split('+')
    .map((segment) => {
      if (!segment) return null;

      const xIndex = segment.toLowerCase().lastIndexOf('x');
      if (xIndex === -1) {
        const price = parseFloat(segment);
        if (Number.isNaN(price)) return null;
        return { price, quantity: 1 };
      }

      const priceStr = segment.slice(0, xIndex);
      const qtyStr = segment.slice(xIndex + 1);
      if (!priceStr) return null;

      const price = parseFloat(priceStr);
      if (Number.isNaN(price)) return null;

      if (!qtyStr) return null;

      const quantity = parseFloat(qtyStr);
      if (Number.isNaN(quantity)) return null;

      return { price, quantity };
    })
    .filter((item): item is PosLineItem => item !== null);
};

export const formatInventoryPriceSegment = (price: number): string => {
  const priceStr = Number.isInteger(price) ? String(price) : price.toString();
  return `${priceStr}x`;
};

export const formatPriceLabel = (price: number, currency = 'GHS'): string => {
  const priceStr =
    Number.isInteger(price) ? String(price) : price.toString();
  const currencyLabel = currency === 'GHS' ? 'ghs' : currency.toLowerCase();
  return `${priceStr} ${currencyLabel}`;
};

export const formatPosLineItem = (item: PosLineItem, currency = 'GHS'): string => {
  return `${formatPriceLabel(item.price, currency)} x ${item.quantity}`;
};

export const formatPosLineItemDisplay = (
  item: PosLineItem,
  currency = 'GHS',
  itemName?: string
): string => {
  const line = formatPosLineItem(item, currency);
  return itemName ? `${itemName} — ${line}` : line;
};

export const getCompletedSegments = (expression: string): string[] => {
  const normalized = normalizeExpression(expression);
  if (!normalized.includes('+')) return [];
  return normalized.split('+').slice(0, -1).filter(Boolean);
};

const isSegmentComplete = (segment: string): boolean => {
  if (!segment) return false;
  const xIndex = segment.toLowerCase().lastIndexOf('x');
  if (xIndex === -1) return !Number.isNaN(parseFloat(segment));
  const qtyStr = segment.slice(xIndex + 1);
  if (!qtyStr) return false;
  return !Number.isNaN(parseFloat(segment.slice(0, xIndex))) && !Number.isNaN(parseFloat(qtyStr));
};

/** Segments complete enough to appear in the action log (live, not only after +). */
export const getLoggedSegments = (expression: string): string[] => {
  const normalized = normalizeExpression(expression);
  if (!normalized || normalized === '0') return [];

  const parts = normalized.split('+').filter(Boolean);
  if (parts.length === 0) return [];

  const last = parts[parts.length - 1];
  if (!isSegmentComplete(last)) {
    return parts.slice(0, -1).filter(isSegmentComplete);
  }
  return parts.filter(isSegmentComplete);
};

export const formatPosLineItems = (expression: string, currency = 'GHS'): string[] =>
  parsePosLineItems(expression).map((item) => formatPosLineItem(item, currency));

export const cleanPosExpressionForEval = (expression: string): string =>
  normalizeExpression(expression).replace(/\+$/, '');

export const evaluatePosExpression = (expression: string): number =>
  parsePosLineItems(expression).reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

const formatPosSegment = (item: PosLineItem): string => {
  const priceStr = Number.isInteger(item.price) ? String(item.price) : String(item.price);
  if (item.quantity === 1) return priceStr;
  const qtyStr = Number.isInteger(item.quantity) ? String(item.quantity) : String(item.quantity);
  return `${priceStr}x${qtyStr}`;
};

export const buildPosExpressionFromItems = (items: PosLineItem[]): string => {
  if (!items.length) return '0';
  return items.map(formatPosSegment).join('+');
};

/** Add qty to a price line (or create it). Used by Assets Hub carting. */
export const addOrIncrementPosItem = (
  expression: string,
  price: number,
  qtyDelta = 1
): string => {
  if (!Number.isFinite(price) || !Number.isFinite(qtyDelta) || qtyDelta === 0) {
    return expression && expression !== '0' ? expression : '0';
  }
  const base = !expression || expression === '0' ? [] : parsePosLineItems(expression);
  const idx = base.findIndex((item) => Math.abs(item.price - price) < 0.001);
  if (idx >= 0) {
    const nextQty = base[idx].quantity + qtyDelta;
    if (nextQty <= 0) {
      base.splice(idx, 1);
    } else {
      base[idx] = { ...base[idx], quantity: nextQty };
    }
  } else if (qtyDelta > 0) {
    base.push({ price, quantity: qtyDelta });
  }
  return buildPosExpressionFromItems(base);
};
