import React, { useEffect, useState } from 'react';
import { AuditLogEntry } from '../types';
import { fetchAllAuditLogs } from '../utils/auditLog';
import { Icons } from '../constants';
import { AppLoadingInline } from './AppLoading';

interface AuditLogPanelProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string | null;
  isLight: boolean;
}

export const AuditLogPanel: React.FC<AuditLogPanelProps> = ({
  isOpen,
  onClose,
  userId,
  isLight,
}) => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !userId) return;

    setLoading(true);
    fetchAllAuditLogs(userId, 100)
      .then(setLogs)
      .catch(err => console.error('Failed to fetch audit logs:', err))
      .finally(() => setLoading(false));
  }, [isOpen, userId]);

  const formatAction = (action: string) => {
    const actionMap: Record<string, string> = {
      create: '✨ Created',
      update: '✏️ Updated',
      delete: '🗑️ Deleted',
      restore: '♻️ Restored',
    };
    return actionMap[action] || action;
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${
        isLight ? 'bg-black/50' : 'bg-black/70'
      }`}
      onClick={onClose}
    >
      <div
        className={`rounded-lg shadow-xl max-w-2xl w-full max-h-96 flex flex-col ${
          isLight ? 'bg-white' : 'bg-[#1c1c1e]'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b" style={{
          borderColor: isLight ? '#e5e5ea' : '#424245'
        }}>
          <h2 className="app-subtext text-[10px] font-black uppercase tracking-widest">Audit Log</h2>
          <button
            onClick={onClose}
            className="text-2xl leading-none opacity-50 hover:opacity-100"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar fluid-bounce-scroll">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <AppLoadingInline label="Loading" size="md" isLight={isLight} />
            </div>
          ) : logs.length === 0 ? (
            <div className={`text-center py-8 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
              <div className="text-3xl mb-2">📋</div>
              <p className="app-subtext text-[10px]">No activity logged yet</p>
            </div>
          ) : (
            <div className="divide-y" style={{
              borderColor: isLight ? '#e5e5ea' : '#424245'
            }}>
              {logs.map(log => (
                <div key={log.id} className={`p-3 ${isLight ? 'hover:bg-gray-50' : 'hover:bg-[#2c2c2e]'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="app-subtext text-[10px] font-black">
                        {formatAction(log.action)} {log.entityType}
                      </p>
                      <p className={`app-subtext text-[10px] mt-1 opacity-60 ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                        ID: {log.entityId.slice(0, 8)}...
                      </p>
                      {log.profileName && (
                        <p className={`app-subtext text-[10px] mt-1 opacity-50 ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>
                          by {log.profileName}
                        </p>
                      )}
                    </div>
                    <p className={`app-subtext text-[10px] whitespace-nowrap ml-2 opacity-50 ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>
                      {new Date(log.timestamp).toLocaleString()}
                    </p>
                  </div>
                  {log.details && (
                    <pre className={`app-subtext text-[10px] mt-2 p-2 rounded overflow-x-auto ${
                      isLight ? 'bg-gray-100 text-gray-700' : 'bg-[#2c2c2e] text-gray-300'
                    }`}>
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
