/**
 * Native share functionality for invoices and receipts
 * Uses Capacitor Share plugin for native sharing (email, messaging, AirDrop, etc.)
 */

import { Share } from '@capacitor/share';

export interface ShareOptions {
  title?: string;
  text?: string;
  url?: string;
  dialogTitle?: string;
}

export interface ShareResult {
  success: boolean;
  shared?: boolean;
  error?: string;
}

/**
 * Share invoice as text via native share sheet
 */
export const shareInvoice = async (
  invoiceName: string,
  invoiceText: string,
  total: string
): Promise<ShareResult> => {
  try {
    const canShare = await Share.canShare();
    if (!canShare.value) {
      return {
        success: false,
        error: 'Share is not available on this device',
      };
    }

    const result = await Share.share({
      title: `Invoice: ${invoiceName}`,
      text: invoiceText,
      dialogTitle: `Share ${invoiceName} (Total: ${total})`,
    });

    return {
      success: true,
      // activityType is set when a target app was chosen (undefined on web cancel paths)
      shared: result.activityType !== undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to share invoice',
    };
  }
};

/**
 * Share receipt image via native share sheet
 */
export const shareReceiptImage = async (
  imagePath: string,
  fileName: string = 'receipt.jpg'
): Promise<ShareResult> => {
  try {
    const canShare = await Share.canShare();
    if (!canShare.value) {
      return {
        success: false,
        error: 'Share is not available on this device',
      };
    }

    const result = await Share.share({
      title: 'Share Receipt',
      text: 'Receipt from iCalc POS',
      url: imagePath,
      dialogTitle: `Share ${fileName}`,
    });

    return {
      success: true,
      shared: result.activityType !== undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to share receipt',
    };
  }
};

/**
 * Check if native share is available
 */
export const isShareAvailable = async (): Promise<boolean> => {
  try {
    const result = await Share.canShare();
    return result.value;
  } catch {
    return false;
  }
};
