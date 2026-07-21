import React, { useState } from 'react';
import { SyncState } from '../types';
import { Icons } from '../constants';

interface SyncStatusIndicatorProps {
  syncState: SyncState;
  isLight: boolean;
  onRetry?: () => void;
}

export const SyncStatusIndicator: React.FC<SyncStatusIndicatorProps> = ({
  syncState,
  isLight,
  onRetry,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  if (syncState.status === 'idle' || syncState.status === 'success') return null;

  const isError = syncState.status === 'error';
  const isSyncing = syncState.status === 'syncing';

  return (
    <>
      <button
        onClick={() => setShowDetails(!showDetails)}
        className={`fixed bottom-6 right-6 z-40 flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium transition-all ${
          isError
            ? isLight
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'bg-red-900/40 text-red-300 hover:bg-red-800/50'
            : isLight
              ? 'bg-blue-100 text-blue-700'
              : 'bg-blue-900/40 text-blue-300'
        }`}
        title={isError ? 'Click to see sync details' : 'Syncing...'}
      >
        {isSyncing ? (
          <div className="animate-spin">
            <Icons.Sync size={14} />
          </div>
        ) : (
          <span className="text-lg">⚠️</span>
        )}
        <span>{isSyncing ? 'Syncing...' : 'Sync failed'}</span>
      </button>

      {showDetails && isError && (
        <div
          className={`fixed bottom-20 right-6 z-40 p-4 rounded-lg shadow-lg max-w-sm w-80 ${
            isLight
              ? 'bg-white border border-red-200'
              : 'bg-[#1c1c1e] border border-red-900/40'
          }`}
        >
          <div className="flex justify-between items-start mb-3">
            <h3 className="font-semibold text-sm">Sync Error</h3>
            <button
              onClick={() => setShowDetails(false)}
              className="text-lg leading-none opacity-50 hover:opacity-100"
            >
              ×
            </button>
          </div>
          <p
            className={`text-xs mb-3 ${isLight ? 'text-gray-600' : 'text-gray-400'}`}
          >
            {syncState.lastError || 'Unable to sync your changes to the server.'}
          </p>
          <div className={`text-xs mb-3 ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>
            Failed items: {syncState.failedItems.size}
            {syncState.failedItems.size > 0 && (
              <div className="mt-2 space-y-1">
                {Array.from(syncState.failedItems.entries()).map(([key, { count }]) => (
                  <div key={key} className="text-xs opacity-75">
                    {key}: {count} attempt{count > 1 ? 's' : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
          {onRetry && (
            <button
              onClick={() => {
                onRetry();
                setShowDetails(false);
              }}
              className={`w-full py-2 px-3 rounded text-xs font-medium transition-all ${
                isLight
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-blue-700 text-white hover:bg-blue-600'
              }`}
            >
              Retry Sync
            </button>
          )}
        </div>
      )}
    </>
  );
};
