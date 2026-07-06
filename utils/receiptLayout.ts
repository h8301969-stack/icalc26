export type PaperWidth = '58mm' | '25mm';

export type ReceiptLayoutMode = 'summary' | 'full';

export const RECEIPT_LAYOUT_OPTIONS: { id: ReceiptLayoutMode; label: string; hint: string }[] = [
  { id: 'summary', label: 'Total only', hint: 'Name · total · attendant' },
  { id: 'full', label: 'Full invoice', hint: 'All line items' },
];

export interface ReceiptSpec {
  paperWidth: PaperWidth;
  widthPx: number;
  maxCols: number;
  maxNameChars: number;
  maxInvoiceTitleChars: number;
  itemLineHeightPx: number;
  headerHeightPx: number;
  footerHeightPx: number;
  maxRecommendedItems: number;
  maxHeightPx: number;
}

export const RECEIPT_SPECS: Record<PaperWidth, ReceiptSpec> = {
  '58mm': {
    paperWidth: '58mm',
    widthPx: 384,
    maxCols: 32,
    maxNameChars: 18,
    maxInvoiceTitleChars: 24,
    itemLineHeightPx: 24,
    headerHeightPx: 100,
    footerHeightPx: 80,
    maxRecommendedItems: 40,
    maxHeightPx: 2400,
  },
  '25mm': {
    paperWidth: '25mm',
    widthPx: 192,
    maxCols: 16,
    maxNameChars: 8,
    maxInvoiceTitleChars: 12,
    itemLineHeightPx: 24,
    headerHeightPx: 100,
    footerHeightPx: 80,
    maxRecommendedItems: 20,
    maxHeightPx: 1600,
  },
};

export function getReceiptSpec(paperWidth: PaperWidth = '58mm'): ReceiptSpec {
  return RECEIPT_SPECS[paperWidth];
}

export function truncateReceiptText(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  if (maxLen <= 3) return trimmed.slice(0, maxLen);
  return `${trimmed.slice(0, maxLen - 3)}...`;
}

export function formatReceiptItemLine(
  name: string,
  quantity: number,
  price: number,
  currency: string,
  spec: ReceiptSpec
): { displayName: string; priceText: string; line: string } {
  const priceText = `${quantity}x ${currency}${price.toFixed(2)}`;
  const nameBudget = Math.max(4, spec.maxCols - priceText.length - 1);
  const displayName = truncateReceiptText(name, nameBudget);
  const spaces = Math.max(1, spec.maxCols - displayName.length - priceText.length);
  return {
    displayName,
    priceText,
    line: `${displayName}${' '.repeat(spaces)}${priceText}`,
  };
}

export interface ReceiptLineItem {
  name?: string;
  price: number;
  quantity: number;
}

export interface ReceiptPrintValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  spec: ReceiptSpec;
  estimatedHeightPx: number;
}

export function validateReceiptPrint(
  invoiceName: string,
  items: ReceiptLineItem[],
  paperWidth: PaperWidth = '58mm',
  hasAttendant = false,
  currency = '¢',
  layoutMode: ReceiptLayoutMode = 'full'
): ReceiptPrintValidation {
  const spec = getReceiptSpec(paperWidth);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!invoiceName.trim()) errors.push('Invoice name is empty.');
  if (layoutMode === 'full' && items.length === 0) errors.push('No line items to print.');

  if (items.length > spec.maxRecommendedItems) {
    warnings.push(
      `Receipt has ${items.length} items; recommended max is ${spec.maxRecommendedItems} for mini printer reliability.`
    );
  }

  if (invoiceName.length > spec.maxInvoiceTitleChars) {
    warnings.push(`Invoice title will truncate at ${spec.maxInvoiceTitleChars} characters on paper.`);
  }

  items.forEach((item, idx) => {
    const label = item.name?.trim() || `Item ${idx + 1}`;
    const { displayName } = formatReceiptItemLine(label, item.quantity, item.price, currency, spec);
    if (displayName.endsWith('...')) {
      warnings.push(`Line ${idx + 1} name "${label}" truncates on ${spec.paperWidth} paper.`);
    }
  });

  const headerHeight = hasAttendant ? spec.headerHeightPx : spec.headerHeightPx - 12;
  const itemRows = layoutMode === 'full' ? items.length : 0;
  const estimatedHeightPx = headerHeight + itemRows * spec.itemLineHeightPx + spec.footerHeightPx;

  if (estimatedHeightPx > spec.maxHeightPx) {
    warnings.push(
      `Estimated receipt height ${estimatedHeightPx}px exceeds ${spec.maxHeightPx}px buffer for ${spec.paperWidth} printers.`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    spec,
    estimatedHeightPx,
  };
}

export type ReceiptLogPhase = 'validate' | 'start' | 'success' | 'failure' | 'skipped';

export function logReceiptPrint(phase: ReceiptLogPhase, payload: Record<string, unknown>) {
  const entry = { phase, at: new Date().toISOString(), ...payload };
  const tag = '[iCalc Receipt]';
  if (phase === 'failure') console.error(tag, entry);
  else if (phase === 'skipped') console.warn(tag, entry);
  else console.log(tag, entry);
}

/** CSS width for switcher card shell matching thermal paper proportion */
export function receiptShellWidth(paperWidth: PaperWidth): string {
  return paperWidth === '25mm' ? 'min(168px, 48vw)' : 'min(320px, 78vw, 384px)';
}