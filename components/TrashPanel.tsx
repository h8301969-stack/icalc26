import React, { useEffect, useState } from 'react';
import { fetchDeletedItems, handleSoftRestore } from '../utils/enhancedSync';
import { Icons } from '../constants';

interface TrashPanelProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string | null;
  isLight: boolean;
  onRestore?: () => void;
}

export const TrashPanel: React.FC<TrashPanelProps> = ({
  isOpen,
  onClose,
  userId,
  isLight,
  onRestore,
}) => {
  const [deletedItems, setDeletedItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'inventory' | 'invoice'>('inventory');

  useEffect(() => {
    if (!isOpen || !userId) return;

    setLoading(true);
    fetchDeletedItems(userId, selectedTab)
      .then(setDeletedItems)
      .catch(err => console.error('Failed to fetch trash:', err))
      .finally(() => setLoading(false));
  }, [isOpen, userId, selectedTab]);

  const handleRestore = async (itemId: string) => {
    if (!userId) return;
    try {
      await handleSoftRestore(userId, selectedTab, itemId);
      setDeletedItems(prev => prev.filter(item => item.id !== itemId));
      onRestore?.();
    } catch (err) {
      console.error('Failed to restore item:', err);
    }
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
        className={`rounded-lg shadow-xl max-w-lg w-full max-h-96 flex flex-col ${
          isLight ? 'bg-white' : 'bg-[#1c1c1e]'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b" style={{
          borderColor: isLight ? '#e5e5ea' : '#424245'
        }}>
          <h2 className="text-lg font-semibold">Trash</h2>
          <button
            onClick={onClose}
            className="text-2xl leading-none opacity-50 hover:opacity-100"
          >
            ×
          </button>
        </div>

        <div className="flex gap-2 px-4 pt-3">
          {(['inventory', 'invoice'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab)}
              className={`px-3 py-1.5 text-sm rounded transition-all ${
                selectedTab === tab
                  ? isLight
                    ? 'bg-blue-600 text-white'
                    : 'bg-blue-700 text-white'
                  : isLight
                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    : 'bg-[#424245] text-gray-300 hover:bg-[#515154]'
              }`}
            >
              {tab === 'inventory' ? 'Inventory' : 'Invoices'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin"><Icons.Sync size={20} /></div>
            </div>
          ) : deletedItems.length === 0 ? (
            <div className={`text-center py-8 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
              <div className="text-3xl mb-2">🗑️</div>
              <p className="text-sm">No deleted items in {selectedTab}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {deletedItems.map(item => (
                <div
                  key={item.id}
                  className={`p-3 rounded flex items-center justify-between ${
                    isLight
                      ? 'bg-gray-50 border border-gray-200'
                      : 'bg-[#2c2c2e] border border-[#424245]'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {item.name || item.invoice_name || 'Unnamed'}
                    </p>
                    <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                      Deleted {new Date(item.deleted_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRestore(item.id)}
                    className={`ml-2 px-2 py-1.5 text-xs rounded font-medium transition-all ${
                      isLight
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-green-900/40 text-green-300 hover:bg-green-800/50'
                    }`}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
