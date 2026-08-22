import { CartLineItem } from '../types';
import { RECEIPT_THEME } from './receiptCanvas';
import { ReceiptLayoutMode } from './receiptLayout';
import { sendInvoiceImageToTelegram } from './telegramDb';

export interface ShareReceiptSettings {
  layoutMode: ReceiptLayoutMode;
}

export interface InvoiceSharePayload {
  invoiceName: string;
  total: string;
  currency: string;
  attendantName: string;
  items: CartLineItem[];
}

const CANVAS_WIDTH = 720;
const HEADER_HEIGHT = 184;
const SHARE_FONTS = {
  brand: 16,
  title: 36,
  item: 20,
  totalLabel: 16,
  totalValue: 52,
  servedBy: 18,
} as const;
const SHARE_ITEM_LINE_HEIGHT = 40;

const formatShareTotal = (total: string, currency: string): string => {
  const num = parseFloat(total) || 0;
  const val = num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbols: Record<string, string> = {
    GHS: `${val}ghs`,
    USD: `$${val}`,
    EUR: `€${val}`,
    GBP: `£${val}`,
    JPY: `¥${val}`,
    NGN: `₦${val}`,
  };
  return symbols[currency] ?? `${currency}${val}`;
};

const formatItemLine = (item: CartLineItem, index: number, currency: string): string => {
  const name = item.name?.trim() || `Item ${index + 1}`;
  const qty = item.quantity;
  const lineTotal = (item.price * qty).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${name}  ${qty}x  ${currency}${lineTotal}`;
};

export const renderInvoiceShareImage = (
  payload: InvoiceSharePayload,
  shareSettings: ShareReceiptSettings
): HTMLCanvasElement => {
  const { invoiceName, total, currency, attendantName, items } = payload;
  const isFull = shareSettings.layoutMode === 'full';
  const attendant = attendantName?.trim() ?? '';

  let height = HEADER_HEIGHT + 32;
  if (isFull && items.length > 0) height += items.length * SHARE_ITEM_LINE_HEIGHT;
  height += 104;
  if (attendant) height += 44;
  height = Math.max(height, 280);

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas');

  const headerGradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, HEADER_HEIGHT);
  headerGradient.addColorStop(0, RECEIPT_THEME.headerTop);
  headerGradient.addColorStop(0.5, RECEIPT_THEME.headerMid);
  headerGradient.addColorStop(1, RECEIPT_THEME.headerBottom);
  ctx.fillStyle = headerGradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, HEADER_HEIGHT);

  ctx.fillStyle = RECEIPT_THEME.bodyBg;
  ctx.fillRect(0, HEADER_HEIGHT, CANVAS_WIDTH, height - HEADER_HEIGHT);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = RECEIPT_THEME.headerText;
  ctx.font = `700 ${SHARE_FONTS.title}px Montserrat`;
  ctx.fillText(invoiceName, CANVAS_WIDTH / 2, 52);

  let y = HEADER_HEIGHT + 32;
  ctx.fillStyle = RECEIPT_THEME.bodyText;

  if (isFull && items.length > 0) {
    ctx.textAlign = 'left';
    ctx.font = `500 ${SHARE_FONTS.item}px Montserrat`;
    items.forEach((item, index) => {
      ctx.fillText(formatItemLine(item, index, currency), 48, y);
      y += SHARE_ITEM_LINE_HEIGHT;
    });
    y += 10;
  }

  ctx.strokeStyle = RECEIPT_THEME.rule;
  ctx.beginPath();
  ctx.moveTo(48, y);
  ctx.lineTo(CANVAS_WIDTH - 48, y);
  ctx.stroke();
  y += 24;

  ctx.textAlign = 'left';
  ctx.font = `700 ${SHARE_FONTS.totalLabel}px Montserrat`;
  ctx.fillStyle = RECEIPT_THEME.muted;
  ctx.fillText('TOTAL', 48, y);

  ctx.textAlign = 'right';
  ctx.font = `800 ${SHARE_FONTS.totalValue}px Montserrat`;
  ctx.fillStyle = RECEIPT_THEME.totalGreen;
  ctx.fillText(formatShareTotal(total, currency), CANVAS_WIDTH - 48, y - 8);
  y += 84;

  if (attendant) {
    const prefix = 'served by ';
    const name = attendant;
    ctx.textAlign = 'left';
    ctx.font = `italic 500 ${SHARE_FONTS.servedBy}px Montserrat`;
    ctx.fillStyle = RECEIPT_THEME.muted;
    const prefixWidth = ctx.measureText(prefix).width;
    ctx.fillText(prefix, (CANVAS_WIDTH - prefixWidth - ctx.measureText(name).width) / 2, y);
    ctx.font = `700 ${SHARE_FONTS.servedBy}px Montserrat`;
    ctx.fillStyle = RECEIPT_THEME.bodyText;
    ctx.fillText(name, (CANVAS_WIDTH - prefixWidth - ctx.measureText(name).width) / 2 + prefixWidth, y);
  }

  return canvas;
};

const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 1));

/** Render invoice image and write PNG to the system clipboard. */
export const copyInvoiceImageToClipboard = async (
  payload: InvoiceSharePayload,
  shareSettings: ShareReceiptSettings
): Promise<{ ok: boolean; error?: string }> => {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      return { ok: false, error: 'Clipboard image copy is not supported in this browser.' };
    }

    const canvas = renderInvoiceShareImage(payload, shareSettings);
    const blob = await canvasToPngBlob(canvas);
    if (!blob) return { ok: false, error: 'Could not create image.' };

    // Some browsers require a Promise for the ClipboardItem value.
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': Promise.resolve(blob),
      }),
    ]);
    return { ok: true };
  } catch (err) {
    // Fallback: try non-promise blob (Chrome older paths)
    try {
      const canvas = renderInvoiceShareImage(payload, shareSettings);
      const blob = await canvasToPngBlob(canvas);
      if (!blob) throw err;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return { ok: true };
    } catch (fallbackErr) {
      return {
        ok: false,
        error:
          fallbackErr instanceof Error
            ? fallbackErr.message
            : err instanceof Error
              ? err.message
              : 'Could not copy image.',
      };
    }
  }
};

/** Render invoice PNG and sendPhoto to the linked / shared testing Telegram bot. */
export const sendInvoiceImageToLinkedTelegram = async (
  payload: InvoiceSharePayload,
  shareSettings: ShareReceiptSettings,
  accountId?: string | null
): Promise<{ ok: boolean; error?: string }> => {
  try {
    const canvas = renderInvoiceShareImage(payload, shareSettings);
    const caption = `🧾 ${payload.invoiceName}\nTotal: ${formatShareTotal(payload.total, payload.currency)}${
      payload.attendantName?.trim() ? `\nServed by: ${payload.attendantName.trim()}` : ''
    }`;
    const result = await sendInvoiceImageToTelegram({
      accountId,
      canvas,
      caption,
    });
    if (result.ok === false) return { ok: false as const, error: result.error };
    return { ok: true as const };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Telegram send failed.' };
  }
};

export const shareInvoiceAsImage = async (
  payload: InvoiceSharePayload,
  shareSettings: ShareReceiptSettings
): Promise<{ ok: boolean; error?: string }> => {
  try {
    const canvas = renderInvoiceShareImage(payload, shareSettings);
    const blob = await canvasToPngBlob(canvas);
    if (!blob) return { ok: false, error: 'Could not create image.' };

    const fileName = `${payload.invoiceName.replace(/[^\w.-]+/g, '_') || 'invoice'}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: payload.invoiceName });
      return { ok: true };
    }

    // Prefer clipboard image when Web Share is unavailable
    const copied = await copyInvoiceImageToClipboard(payload, shareSettings);
    if (copied.ok) return { ok: true };

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Share failed.' };
  }
};