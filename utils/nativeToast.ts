/**
 * Native toast notifications for status updates and alerts
 * Uses Capacitor Toast plugin for native OS notifications
 * Better UX than browser alerts
 */

import { Toast, ToastShowOptions } from '@capacitor/toast';

export type ToastDuration = 'short' | 'long';
export type ToastPosition = 'top' | 'center' | 'bottom';

/**
 * Show simple toast message
 */
export const showToast = async (
  message: string,
  duration: ToastDuration = 'short'
): Promise<void> => {
  try {
    await Toast.show({
      text: message,
      duration: duration === 'short' ? 2000 : 3500,
      position: 'bottom'
    });
  } catch (error) {
    console.warn('Toast not available:', error);
  }
};

/**
 * Show success message
 */
export const showSuccessToast = async (message: string): Promise<void> => {
  await showToast(`✓ ${message}`, 'short');
};

/**
 * Show error message
 */
export const showErrorToast = async (message: string): Promise<void> => {
  await showToast(`✗ ${message}`, 'long');
};

/**
 * Show warning message
 */
export const showWarningToast = async (message: string): Promise<void> => {
  await showToast(`⚠ ${message}`, 'long');
};

/**
 * Show info message
 */
export const showInfoToast = async (message: string): Promise<void> => {
  await showToast(`ⓘ ${message}`, 'short');
};

/**
 * Show sync status
 */
export const showSyncToast = async (status: 'syncing' | 'success' | 'error'): Promise<void> => {
  const messages = {
    syncing: '⟳ Syncing data...',
    success: '✓ Synced successfully',
    error: '✗ Sync failed'
  };
  await showToast(messages[status], status === 'error' ? 'long' : 'short');
};

/**
 * Show invoice action feedback
 */
export const showInvoiceToast = async (
  action: 'created' | 'updated' | 'saved' | 'printed' | 'shared'
): Promise<void> => {
  const messages = {
    created: '✓ Invoice created',
    updated: '✓ Invoice updated',
    saved: '✓ Invoice saved',
    printed: '✓ Sent to printer',
    shared: '✓ Shared successfully'
  };
  await showToast(messages[action], 'short');
};

/**
 * Show inventory action feedback
 */
export const showInventoryToast = async (
  action: 'added' | 'updated' | 'deleted' | 'restocked'
): Promise<void> => {
  const messages = {
    added: '✓ Item added',
    updated: '✓ Item updated',
    deleted: '✓ Item removed',
    restocked: '✓ Stock updated'
  };
  await showToast(messages[action], 'short');
};

/**
 * Show connection status
 */
export const showConnectionToast = async (connected: boolean): Promise<void> => {
  if (connected) {
    await showToast('🌐 Back online', 'short');
  } else {
    await showToast('📴 Offline mode', 'long');
  }
};

/**
 * Custom toast with full options
 */
export const showCustomToast = async (options: Partial<ToastShowOptions>): Promise<void> => {
  try {
    const defaults: ToastShowOptions = {
      text: 'Notification',
      duration: 2000,
      position: 'bottom'
    };

    await Toast.show({ ...defaults, ...options });
  } catch (error) {
    console.warn('Toast not available:', error);
  }
};
