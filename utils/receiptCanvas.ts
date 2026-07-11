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
}

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
  } = input;

  const width = spec.widthPx;
  const itemHeight = spec.itemLineHeightPx;
  const headerHeight = attendantName ? spec.headerHeightPx : spec.headerHeightPx - 12;
  const footerHeight = spec.footerHeightPx;
  const itemRows = layoutMode === 'full' ? items.length : 0;
  const height = headerHeight + itemRows * itemHeight + footerHeight;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create 2D canvas context');

  paintReceiptHeaderGradient(ctx, width, headerHeight);
  paintReceiptBody(ctx, width, headerHeight, height);

  ctx.textBaseline = 'top';

  let headerOffset = 8;
  try {
    const logo = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = icalcLogo;
    });
    if (logo) {
      const logoSize = Math.min(40, Math.floor(width * 0.2));
      const logoX = (width - logoSize) / 2;
      ctx.drawImage(logo, logoX, 6, logoSize, logoSize);
      headerOffset = 6 + logoSize + 4;
    }
  } catch {
    // logo optional
  }

  const brandFontPx = Math.max(12, Math.round(width * 0.036));
  const titleFontPx = Math.max(20, Math.round(width * 0.058));
  const attendantFontPx = Math.max(12, Math.round(width * 0.031));
  const itemFontPx = Math.max(14, Math.round(width * 0.039));
  const totalLabelFontPx = Math.max(12, Math.round(width * 0.031));
  const totalValueFontPx = Math.max(20, Math.round(width * 0.052));
  const thanksFontPx = Math.max(12, Math.round(width * 0.031));

  ctx.fillStyle = RECEIPT_THEME.headerText;
  ctx.textAlign = 'center';
  ctx.font = `700 ${brandFontPx}px Montserrat, Candara`;
  ctx.fillText(brandLabel.toUpperCase(), width / 2, headerOffset);

  ctx.font = `700 ${titleFontPx}px Montserrat, Candara`;
  ctx.fillText(
    truncateReceiptText(invoiceName.toUpperCase(), spec.maxInvoiceTitleChars),
    width / 2,
    headerOffset + Math.round(titleFontPx * 0.78)
  );

  if (attendantName) {
    ctx.font = `500 ${attendantFontPx}px Montserrat, Candara`;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillText(
      formatServedByLine(attendantName, spec),
      width / 2,
      headerOffset + Math.round(titleFontPx * 1.85)
    );
  }

  const bodyStart = headerHeight + 8;
  let currentY = bodyStart;

  ctx.strokeStyle = RECEIPT_THEME.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8, bodyStart - 4);
  ctx.lineTo(width - 8, bodyStart - 4);
  ctx.stroke();

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
      ctx.font = `500 ${itemFontPx}px Montserrat, Candara`;
      ctx.fillText(displayName, 8, currentY);

      ctx.textAlign = 'right';
      ctx.fillText(priceText, width - 8, currentY);

      currentY += itemHeight;
    });
  }

  ctx.beginPath();
  ctx.moveTo(8, currentY + 4);
  ctx.lineTo(width - 8, currentY + 4);
  ctx.stroke();

  currentY += Math.round(totalLabelFontPx * 1.4);
  ctx.textAlign = 'left';
  ctx.font = `700 ${totalLabelFontPx}px Montserrat, Candara`;
  ctx.fillStyle = RECEIPT_THEME.muted;
  ctx.fillText('TOTAL', 8, currentY);

  ctx.textAlign = 'right';
  ctx.font = `800 ${totalValueFontPx}px Montserrat, Candara`;
  ctx.fillStyle = RECEIPT_THEME.totalGreen;
  ctx.fillText(`${currency}${runningTotal.toFixed(2)}`, width - 8, currentY - 2);

  currentY += Math.round(totalValueFontPx * 1.35);
  ctx.textAlign = 'center';
  ctx.font = `500 ${thanksFontPx}px Montserrat, Candara`;
  ctx.fillStyle = RECEIPT_THEME.muted;
  ctx.fillText('Thank you for your purchase', width / 2, currentY);
}