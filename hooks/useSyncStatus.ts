import { useState, useRef, useCallback } from 'react';
import { SyncState, SyncStatus } from '../types';

interface SyncRetryItem {
  key: string;
  attempt: number;
  nextRetryAt: number;
}

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

const getBackoffDelay = (attempt: number): number => {
  const exponential = BASE_BACKOFF_MS * Math.pow(2, attempt);
  return Math.min(exponential + Math.random() * 1000, MAX_BACKOFF_MS);
};

export const useSyncStatus = () => {
  const [syncState, setSyncState] = useState<SyncState>({
    status: 'idle',
    failedItems: new Map(),
  });

  const retryQueueRef = useRef<Map<string, SyncRetryItem>>(new Map());
  const retryTimersRef = useRef<Map<string, number>>(new Map());

  const setSyncStatus = useCallback((status: SyncStatus, error?: string) => {
    setSyncState(prev => ({
      ...prev,
      status,
      lastError: error,
      lastSyncTime: status === 'success' ? Date.now() : prev.lastSyncTime,
    }));
  }, []);

  const trackSyncError = useCallback((itemKey: string, error: Error) => {
    setSyncState(prev => {
      const failedItems = new Map(prev.failedItems);
      const current = failedItems.get(itemKey) || { count: 0, nextRetryAt: 0 };
      const attempt = current.count;

      if (attempt >= MAX_RETRIES) {
        failedItems.delete(itemKey);
        return { ...prev, failedItems };
      }

      const nextRetryAt = Date.now() + getBackoffDelay(attempt);
      failedItems.set(itemKey, { count: attempt + 1, nextRetryAt });
      return { ...prev, failedItems, status: 'error', lastError: error.message };
    });

    const retry = retryQueueRef.current.get(itemKey) || { key: itemKey, attempt: 0, nextRetryAt: 0 };
    retry.attempt = (retry.attempt || 0) + 1;
    retry.nextRetryAt = Date.now() + getBackoffDelay(retry.attempt - 1);
    retryQueueRef.current.set(itemKey, retry);
  }, []);

  const scheduleRetry = useCallback((itemKey: string, fn: () => Promise<void>) => {
    if (retryTimersRef.current.has(itemKey)) {
      window.clearTimeout(retryTimersRef.current.get(itemKey)!);
    }

    const retry = retryQueueRef.current.get(itemKey);
    if (!retry || retry.attempt >= MAX_RETRIES) return;

    const delay = Math.max(0, retry.nextRetryAt - Date.now());
    const timer = window.setTimeout(() => {
      void fn().catch(err => trackSyncError(itemKey, err));
      retryTimersRef.current.delete(itemKey);
    }, delay);

    retryTimersRef.current.set(itemKey, timer);
  }, [trackSyncError]);

  const clearRetries = useCallback(() => {
    retryQueueRef.current.forEach((_, key) => {
      const timer = retryTimersRef.current.get(key);
      if (timer) window.clearTimeout(timer);
    });
    retryQueueRef.current.clear();
    retryTimersRef.current.clear();
    setSyncState(prev => ({
      ...prev,
      failedItems: new Map(),
      status: 'idle',
      lastError: undefined,
    }));
  }, []);

  const retryAllFailed = useCallback(() => {
    setSyncState(prev => ({
      ...prev,
      failedItems: new Map(),
      status: 'syncing',
    }));
  }, []);

  return {
    syncState,
    setSyncStatus,
    trackSyncError,
    scheduleRetry,
    clearRetries,
    retryAllFailed,
  };
};
