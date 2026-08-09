import icalcLogo from '../assets/logo/icalc-logo.png';
import {
  formatReceiptItemLine,
  formatServedByLine,
  truncateReceiptText,
  type ReceiptLayoutMode,
  type ReceiptSpec,
} from './receiptLayout';

export const RECEIPT_THEME = {
  headerTop: '#1e3a8a',
  headerMid: '#2563eb',
  headerBottom: '#60a5fa',
  bodyBg: '#ffffff',
  headerText: '#ffffff',
  bodyText: '#0a0a0a',
  totalGreen: '#16a34a',
  muted: 'rgba(0,0,0,0.5)',
  rule: 'rgba(0,0,0,0.12)',
} as const;

export function paintReceiptHeaderGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  headerHeight: number
): void {
  const gradient = ctx.createLinearGradient(0, 0, width, headerHeight);
  gradient.addColorStop(0, RECEIPT_THEME.headerTop);
  gradient.addColorStop(0.5, RECEIPT_THEME.headerMid);
  gradient.addColorStop(1, RECEIPT_THEME.headerBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, headerHeight);
}

export function paintReceiptBody(
  ctx: CanvasRenderingContext2D,
  width: number,
  headerHeight: number,
  totalHeight: number
): void {
  ctx.fillStyle = RECEIPT_THEME.bodyBg;
  ctx.fillRect(0, headerHeight, width, totalHeight - headerHeight);
}

export interface ThermalReceiptDrawInput {
  invoiceName: string;
  items: { name?: string; price: number; quantity: number }[];
  runningTotal: number;
  currency: string;
  attendantName?: string;
  layoutMode: ReceiptLayoutMode;
  spec: ReceiptSpec;
  brandLabel?: string;
  businessName?: string;
  businessPhone?: string;
  businessAddress?: string;
}

/**
 * Sequence:
 * - summary (mini): business (bold) + info subtext → invoice → total → served by
 * - full (admin hub): business → invoice → line items → total → served by
 */
export async function drawThermalReceiptCanvas(
  canvas: HTMLCanvasElement,
  input: ThermalReceiptDrawInput
): Promise<void> {
  const {
    invoiceName,
    items,
    runningTotal,
    currency,
    attendantName,
    layoutMode,
    spec,
    brandLabel = 'iCalc',
    businessName = '',
    businessPhone = '',
    businessAddress = '',
  } = input;

  const width = spec.widthPx;
  const itemHeight = spec.itemLineHeightPx;
  const itemRows = layoutMode === 'full' ? items.length : 0;
  const hasBiz = !!businessName.trim();
  const bizSubLines =
    [businessPhone.trim(), businessAddress.trim()].filter(Boolean).length;
  // Header: brand/logo + optional business block
  const headerHeight =
    (hasBiz ? 52 + bizSubLines * 14 : 36) + (attendantName && layoutMode === 'summary' ? 0 : 8) + 48;
  const footerHeight = layoutMode === 'summary' ? 100 : 110;
  const height = Math.max(
    headerHeight + itemRows * itemHeight + footerHeight,
    layoutMode === 'summary' ? 220 : 260
  );

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create 2D canvas context');

  paintReceiptHeaderGradient(ctx, width, headerHeight);
  paintReceiptBody(ctx, width, headerHeight, height);

  ctx.textBaseline = 'top';

  let y = 8;
  try {
    const logo = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = icalcLogo;
    });
    if (logo && !hasBiz) {
      const logoSize = Math.min(36, Math.floor(width * 0.18));
      const logoX = (width - logoSize) / 2;
      ctx.drawImage(logo, logoX, 6, logoSize, logoSize);
      y = 6 + logoSize + 4;
    }
  } catch {
    // logo optional
  }

  const brandFontPx = Math.max(11, Math.round(width * 0.034));
  const bizFontPx = Math.max(15, Math.round(width * 0.048));
  const subFontPx = Math.max(10, Math.round(width * 0.028));
  const titleFontPx = Math.max(16, Math.round(width * 0.05));
  const itemFontPx = Math.max(13, Math.round(width * 0.036));
  const totalLabelFontPx = Math.max(11, Math.round(width * 0.03));
  const totalValueFontPx = Math.max(18, Math.round(width * 0.05));
  const servedFontPx = Math.max(11, Math.round(width * 0.03));

  ctx.textAlign = 'center';
  ctx.fillStyle = RECEIPT_THEME.headerText;

  if (hasBiz) {
    // Business name — bold / block
    ctx.font = `800 ${bizFontPx}px Montserrat, Candara, sans-serif`;
    ctx.fillText(
      truncateReceiptText(businessName.toUpperCase(), Math.floor(width / (bizFontPx * 0.55))),
      width / 2,
      y
    );
    y += bizFontPx + 4;
    ctx.font = `500 ${subFontPx}px Montserrat, Candara, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    if (businessPhone.trim()) {
      ctx.fillText(truncateReceiptText(businessPhone.trim(), 28), width / 2, y);
      y += subFontPx + 3;
    }
    if (businessAddress.trim()) {
      ctx.fillText(truncateReceiptText(businessAddress.trim(), 32), width / 2, y);
      y += subFontPx + 3;
    }
  } else {
    ctx.font = `700 ${brandFontPx}px Montserrat, Candara, sans-serif`;
    ctx.fillText(brandLabel.toUpperCase(), width / 2, y);
    y += brandFontPx + 6;
  }

  // Invoice # / customer name
  ctx.fillStyle = RECEIPT_THEME.headerText;
  ctx.font = `700 ${titleFontPx}px Montserrat, Candara, sans-serif`;
  ctx.fillText(
    truncateReceiptText(invoiceName.toUpperCase(), spec.maxInvoiceTitleChars),
    width / 2,
    Math.min(y + 4, headerHeight - titleFontPx - 10)
  );

  // Body
  let currentY = headerHeight + 10;
  ctx.strokeStyle = RECEIPT_THEME.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8, currentY - 4);
  ctx.lineTo(width - 8, currentY - 4);
  ctx.stroke();

  // Full hub print: line items BEFORE total
  if (layoutMode === 'full') {
    items.forEach((item, idx) => {
      const { displayName, priceText } = formatReceiptItemLine(
        item.name || `Item ${idx + 1}`,
        item.quantity,
        item.price,
        currency,
        spec
      );
      ctx.fillStyle = RECEIPT_THEME.bodyText;
      ctx.textAlign = 'left';
      ctx.font = `500 ${itemFontPx}px Montserrat, Candara, sans-serif`;
      ctx.fillText(displayName, 8, currentY);
      ctx.textAlign = 'right';
      ctx.fillText(priceText, width - 8, currentY);
      currentY += itemHeight;
    });
    ctx.beginPath();
    ctx.moveTo(8, currentY + 2);
    ctx.lineTo(width - 8, currentY + 2);
    ctx.stroke();
    currentY += 10;
  }

  // Total amount
  currentY += 4;
  ctx.textAlign = 'left';
  ctx.font = `700 ${totalLabelFontPx}px Montserrat, Candara, sans-serif`;
  ctx.fillStyle = RECEIPT_THEME.muted;
  ctx.fillText('TOTAL', 8, currentY);

  ctx.textAlign = 'right';
  ctx.font = `800 ${totalValueFontPx}px Montserrat, Candara, sans-serif`;
  ctx.fillStyle = RECEIPT_THEME.totalGreen;
  ctx.fillText(`${currency}${runningTotal.toFixed(2)}`, width - 8, currentY - 2);

  currentY += Math.round(totalValueFontPx * 1.35);

  // Served by (user)
  if (attendantName) {
    ctx.textAlign = 'center';
    ctx.font = `600 ${servedFontPx}px Montserrat, Candara, sans-serif`;
    ctx.fillStyle = RECEIPT_THEME.bodyText;
    ctx.fillText(formatServedByLine(attendantName, spec), width / 2, currentY);
    currentY += servedFontPx + 10;
  }

  if (layoutMode === 'full') {
    ctx.textAlign = 'center';
    ctx.font = `500 ${servedFontPx}px Montserrat, Candara, sans-serif`;
    ctx.fillStyle = RECEIPT_THEME.muted;
    ctx.fillText('Thank you for your purchase', width / 2, currentY);
  }
}
