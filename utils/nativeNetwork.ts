/**
 * Native network status detection
 * Uses Capacitor Network plugin to detect online/offline status changes
 * Enables better sync management and offline indicators
 */

import { Network } from '@capacitor/network';

export interface NetworkStatus {
  isConnected: boolean;
  connectionType: 'none' | 'wifi' | 'cellular' | 'unknown';
  isMetered?: boolean;
}

export type NetworkStatusCallback = (status: NetworkStatus) => void;

let statusListeners: Set<NetworkStatusCallback> = new Set();
let currentStatus: NetworkStatus | null = null;

/**
 * Get current network connection status
 */
export const getNetworkStatus = async (): Promise<NetworkStatus> => {
  try {
    const status = await Network.getStatus();
    currentStatus = {
      isConnected: status.connected,
      connectionType: status.connectionType as 'none' | 'wifi' | 'cellular' | 'unknown',
      isMetered: status.connectionType === 'cellular'
    };
    return currentStatus;
  } catch (error) {
    console.error('Failed to get network status:', error);
    return {
      isConnected: false,
      connectionType: 'unknown'
    };
  }
};

/**
 * Subscribe to network status changes
 * Returns unsubscribe function
 */
export const onNetworkStatusChange = (callback: NetworkStatusCallback): (() => void) => {
  statusListeners.add(callback);

  // Call immediately with current status
  if (currentStatus) {
    callback(currentStatus);
  }

  // Set up listener if not already set
  if (statusListeners.size === 1) {
    setupNetworkListener();
  }

  // Return unsubscribe function
  return () => {
    statusListeners.delete(callback);
    if (statusListeners.size === 0) {
      teardownNetworkListener();
    }
  };
};

let unsubscribe: (() => void) | null = null;

const setupNetworkListener = async () => {
  try {
    // Get initial status
    const initialStatus = await getNetworkStatus();

    // Set up listener for changes
    unsubscribe = Network.addListener('networkStatusChange', (status) => {
      currentStatus = {
        isConnected: status.connected,
        connectionType: status.connectionType as 'none' | 'wifi' | 'cellular' | 'unknown',
        isMetered: status.connectionType === 'cellular'
      };

      // Notify all listeners
      statusListeners.forEach(callback => {
        if (currentStatus) callback(currentStatus);
      });
    });
  } catch (error) {
    console.error('Failed to setup network listener:', error);
  }
};

const teardownNetworkListener = () => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
};

/**
 * Check if currently connected to internet
 */
export const isOnline = async (): Promise<boolean> => {
  const status = await getNetworkStatus();
  return status.isConnected;
};

/**
 * Check if on metered connection (cellular)
 * Useful for deciding whether to sync large data
 */
export const isOnMeteredConnection = async (): Promise<boolean> => {
  const status = await getNetworkStatus();
  return status.isMetered ?? false;
};
