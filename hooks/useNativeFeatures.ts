/**
 * React hook for accessing native Capacitor features
 * Provides easy access to camera, share, network, haptics, filesystem, and toast
 */

import { useState, useEffect, useCallback } from 'react';
import * as nativeCamera from '../utils/nativeCamera';
import * as nativeShare from '../utils/nativeShare';
import * as nativeNetwork from '../utils/nativeNetwork';
import * as nativeHaptics from '../utils/nativeHaptics';
import * as nativeFilesystem from '../utils/nativeFilesystem';
import * as nativeToast from '../utils/nativeToast';
import { NetworkStatus } from '../utils/nativeNetwork';

export interface UseNativeFeaturesOptions {
  onNetworkStatusChange?: (status: NetworkStatus) => void;
}

export const useNativeFeatures = (options: UseNativeFeaturesOptions = {}) => {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isConnected: true,
    connectionType: 'unknown'
  });

  // Set up network listener
  useEffect(() => {
    const unsubscribe = nativeNetwork.onNetworkStatusChange((status) => {
      setNetworkStatus(status);
      options.onNetworkStatusChange?.(status);
    });

    return unsubscribe;
  }, [options]);

  // Camera functions
  const scanQRCode = useCallback(nativeCamera.scanQRCode, []);
  const captureReceiptPhoto = useCallback(nativeCamera.captureReceiptPhoto, []);
  const pickPhotoFromGallery = useCallback(nativeCamera.pickPhotoFromGallery, []);
  const isCameraAvailable = useCallback(nativeCamera.isCameraAvailable, []);

  // Share functions
  const shareInvoice = useCallback(nativeShare.shareInvoice, []);
  const shareReceiptImage = useCallback(nativeShare.shareReceiptImage, []);
  const isShareAvailable = useCallback(nativeShare.isShareAvailable, []);

  // Network functions
  const isOnline = useCallback(nativeNetwork.isOnline, []);
  const isOnMeteredConnection = useCallback(nativeNetwork.isOnMeteredConnection, []);

  // Haptics functions
  const vibrate = useCallback(nativeHaptics.vibrate, []);
  const hapticImpact = useCallback(nativeHaptics.hapticImpact, []);
  const hapticNotification = useCallback(nativeHaptics.hapticNotification, []);
  const hapticSelection = useCallback(nativeHaptics.hapticSelection, []);
  const hapticDoubleTap = useCallback(nativeHaptics.hapticDoubleTap, []);
  const hapticSuccess = useCallback(nativeHaptics.hapticSuccess, []);
  const hapticError = useCallback(nativeHaptics.hapticError, []);
  const hapticWarning = useCallback(nativeHaptics.hapticWarning, []);
  const areHapticsAvailable = useCallback(nativeHaptics.areHapticsAvailable, []);

  // Filesystem functions
  const exportInventoryAsFile = useCallback(nativeFilesystem.exportInventoryAsFile, []);
  const exportFullBackup = useCallback(nativeFilesystem.exportFullBackup, []);
  const exportInvoiceAsCSV = useCallback(nativeFilesystem.exportInvoiceAsCSV, []);
  const importDataFromFile = useCallback(nativeFilesystem.importDataFromFile, []);
  const listBackupFiles = useCallback(nativeFilesystem.listBackupFiles, []);
  const deleteBackupFile = useCallback(nativeFilesystem.deleteBackupFile, []);
  const saveCrashLog = useCallback(nativeFilesystem.saveCrashLog, []);

  // Toast functions
  const showToast = useCallback(nativeToast.showToast, []);
  const showSuccessToast = useCallback(nativeToast.showSuccessToast, []);
  const showErrorToast = useCallback(nativeToast.showErrorToast, []);
  const showWarningToast = useCallback(nativeToast.showWarningToast, []);
  const showInfoToast = useCallback(nativeToast.showInfoToast, []);
  const showSyncToast = useCallback(nativeToast.showSyncToast, []);
  const showInvoiceToast = useCallback(nativeToast.showInvoiceToast, []);
  const showInventoryToast = useCallback(nativeToast.showInventoryToast, []);
  const showConnectionToast = useCallback(nativeToast.showConnectionToast, []);

  return {
    // Network
    networkStatus,
    isOnline,
    isOnMeteredConnection,

    // Camera
    camera: {
      scanQRCode,
      captureReceiptPhoto,
      pickPhotoFromGallery,
      isCameraAvailable
    },

    // Share
    share: {
      shareInvoice,
      shareReceiptImage,
      isShareAvailable
    },

    // Haptics
    haptics: {
      vibrate,
      hapticImpact,
      hapticNotification,
      hapticSelection,
      hapticDoubleTap,
      hapticSuccess,
      hapticError,
      hapticWarning,
      areHapticsAvailable
    },

    // Filesystem
    filesystem: {
      exportInventoryAsFile,
      exportFullBackup,
      exportInvoiceAsCSV,
      importDataFromFile,
      listBackupFiles,
      deleteBackupFile,
      saveCrashLog
    },

    // Toast
    toast: {
      showToast,
      showSuccessToast,
      showErrorToast,
      showWarningToast,
      showInfoToast,
      showSyncToast,
      showInvoiceToast,
      showInventoryToast,
      showConnectionToast
    }
  };
};
