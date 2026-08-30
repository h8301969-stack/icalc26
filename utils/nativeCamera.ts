/**
 * Native camera features for QR code scanning and receipt capture
 * Uses Capacitor Camera plugin for native access
 */

import { Camera, CameraDirection, CameraResultType, CameraSource } from '@capacitor/camera';

export interface QRScanResult {
  success: boolean;
  data?: string;
  error?: string;
}

export interface ReceiptPhotoResult {
  success: boolean;
  imagePath?: string;
  imageData?: string;
  error?: string;
}

/**
 * Scan QR code using device camera
 * Returns decoded QR data (product IDs, inventory links, etc.)
 */
export const scanQRCode = async (): Promise<QRScanResult> => {
  try {
    const image = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
      direction: CameraDirection.Rear,
    });

    // Note: Actual QR decoding requires jsQR or similar library
    // This captures the image - decoding happens client-side
    return {
      success: true,
      data: image.webPath,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Camera access denied or unavailable',
    };
  }
};

/**
 * Capture receipt photo for documentation
 * User can attach receipt to invoice or request
 */
export const captureReceiptPhoto = async (): Promise<ReceiptPhotoResult> => {
  try {
    const photo = await Camera.getPhoto({
      quality: 85,
      allowEditing: true,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
    });

    return {
      success: true,
      imageData: `data:image/${photo.format};base64,${photo.base64String}`,
      imagePath: photo.webPath,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to capture photo',
    };
  }
};

/**
 * Request camera + photo library access (needed before gallery / camera pick on Android 13+).
 */
export const requestPhotoPermissions = async (): Promise<{
  ok: boolean;
  error?: string;
}> => {
  try {
    const current = await Camera.checkPermissions();
    if (current.photos === 'granted' || current.photos === 'limited') {
      return { ok: true };
    }
    const next = await Camera.requestPermissions({ permissions: ['photos', 'camera'] });
    if (next.photos === 'granted' || next.photos === 'limited' || next.camera === 'granted') {
      return { ok: true };
    }
    return { ok: false, error: 'Photo library permission was denied.' };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not request photo permission.',
    };
  }
};

/**
 * Pick existing photo from device gallery
 */
/** Camera or gallery photo as a data URL for Fun Print / receipt raster jobs. */
export const pickPrintableImage = async (
  source: 'camera' | 'photos' = 'photos'
): Promise<ReceiptPhotoResult> => {
  if (source === 'camera') return captureReceiptPhoto();
  return pickPhotoFromGallery();
};

export const pickPhotoFromGallery = async (): Promise<ReceiptPhotoResult> => {
  try {
    const permission = await requestPhotoPermissions();
    if (!permission.ok) {
      return { success: false, error: permission.error ?? 'Photo access denied.' };
    }

    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Photos,
      // Prefer the system file picker so all photo formats are selectable.
      webUseInput: true,
    });

    return {
      success: true,
      imageData: `data:image/${photo.format};base64,${photo.base64String}`,
      imagePath: photo.webPath,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to pick photo',
    };
  }
};

/**
 * Check if camera is available on device
 */
export const isCameraAvailable = async (): Promise<boolean> => {
  try {
    const result = await Camera.checkPermissions();
    return result.camera !== 'denied';
  } catch {
    return false;
  }
};
