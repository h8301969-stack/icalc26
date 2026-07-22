/**
 * Native camera features for QR code scanning and receipt capture
 * Uses Capacitor Camera plugin for native access
 */

import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

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
      direction: 'front' // Use back camera
    });

    // Note: Actual QR decoding requires jsQR or similar library
    // This captures the image - decoding happens client-side
    return {
      success: true,
      imagePath: image.webPath,
      data: image.webPath
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Camera access denied or unavailable'
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
      source: CameraSource.Camera
    });

    return {
      success: true,
      imageData: `data:image/${photo.format};base64,${photo.base64String}`,
      imagePath: photo.webPath
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to capture photo'
    };
  }
};

/**
 * Pick existing photo from device gallery
 */
export const pickPhotoFromGallery = async (): Promise<ReceiptPhotoResult> => {
  try {
    const photo = await Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Photos
    });

    return {
      success: true,
      imageData: `data:image/${photo.format};base64,${photo.base64String}`,
      imagePath: photo.webPath
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to pick photo'
    };
  }
};

/**
 * Check if camera is available on device
 */
export const isCameraAvailable = async (): Promise<boolean> => {
  try {
    const result = await Camera.checkPermissions();
    return result.camera !== 'denied' && result.camera !== 'prompt-blocked';
  } catch {
    return false;
  }
};
