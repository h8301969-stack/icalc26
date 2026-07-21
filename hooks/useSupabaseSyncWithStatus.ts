import { useRef } from 'react';
import { useSyncStatus } from './useSyncStatus';

export const useSupabaseSyncWithStatus = () => {
  const syncStatus = useSyncStatus();
  const syncCallsRef = useRef<Map<string, number>>(new Map());

  const trackSyncCall = (key: string, fn: () => Promise<any>) => {
    return fn()
      .then(result => {
        syncStatus.setSyncStatus('success');
        syncCallsRef.current.delete(key);
        return result;
      })
      .catch(error => {
        syncStatus.trackSyncError(key, error);
        syncStatus.scheduleRetry(key, () => fn());
      });
  };

  const retryFailedSyncs = () => {
    syncStatus.retryAllFailed();
  };

  return {
    syncState: syncStatus.syncState,
    trackSyncCall,
    retryFailedSyncs,
    setSyncStatus: syncStatus.setSyncStatus,
  };
};
