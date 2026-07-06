import { CartLineItem } from '../types';
import { ReceiptLayoutMode } from './receiptLayout';

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
  return symbols[currency] ?? val;
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

  let height = 80;
  height += 52; // invoice name
  if (isFull && items.length > 0) height += 24 + items.length * 28;
  height += 72; // total
  if (attendant) height += 40;
  height = Math.max(height, 200);

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_WIDTH, height);

  let y = 48;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000000';

  ctx.font = '600 22px Montserrat, Candara, sans-serif';
  ctx.fillText(invoiceName, CANVAS_WIDTH / 2, y);
  y += 52;

  if (isFull && items.length > 0) {
    ctx.textAlign = 'left';
    ctx.font = '500 14px Montserrat, Candara, sans-serif';
    items.forEach((item, index) => {
      ctx.fillText(formatItemLine(item, index, currency), 48, y);
      y += 28;
    });
    y += 8;
    ctx.textAlign = 'center';
  }

  ctx.font = '700 44px Montserrat, Candara, sans-serif';
  ctx.fillText(formatShareTotal(total, currency), CANVAS_WIDTH / 2, y);
  y += 72;

  if (attendant) {
    const prefix = 'served by ';
    const name = attendant;
    ctx.font = 'italic 300 14px Montserrat, Candara, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const prefixWidth = ctx.measureText(prefix).width;
    ctx.font = '700 13px Montserrat, Candara, sans-serif';
    const nameWidth = ctx.measureText(name).width;
    const totalWidth = prefixWidth + nameWidth;
    const startX = (CANVAS_WIDTH - totalWidth) / 2;

    ctx.textAlign = 'left';
    ctx.font = 'italic 300 14px Montserrat, Candara, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(prefix, startX, y);
    ctx.font = '700 13px Montserrat, Candara, sans-serif';
    ctx.fillStyle = '#000000';
    ctx.fillText(name, startX + prefixWidth, y);
    ctx.textAlign = 'center';
  }

  return canvas;
};

export const shareInvoiceAsImage = async (
  payload: InvoiceSharePayload,
  shareSettings: ShareReceiptSettings
): Promise<{ ok: boolean; error?: string }> => {
  try {
    const canvas = renderInvoiceShareImage(payload, shareSettings);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png', 1)
    );
    if (!blob) return { ok: false, error: 'Could not create image.' };

    const fileName = `${payload.invoiceName.replace(/[^\w.-]+/g, '_') || 'invoice'}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: payload.invoiceName,
        text: `Invoice: ${payload.invoiceName}`,
      });
      return { ok: true };
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') return { ok: true };
    const message = err instanceof Error ? err.message : 'Share failed';
    return { ok: false, error: message };
  }
};