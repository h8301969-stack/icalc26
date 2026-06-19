import React from 'react';
import { HistoryItem } from '../types';
import { Icons } from '../constants';

interface HistoryPanelProps {
  history: HistoryItem[];
  isOpen: boolean;
  onClose: () => void;
  onClear: () => void;
  onSelect: (item: HistoryItem) => void;
  isLight?: boolean;
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({ 
  history, 
  isOpen, 
  onClose, 
  onClear,
  onSelect,
  isLight = false
}) => {
  // Keyboard accessibility: close on Escape
  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);
  const formatDateTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const levitateClass = isLight 
    ? 'bg-white shadow-[0_12px_36px_rgba(0,0,0,0.08)] hover:shadow-[0_40px_80px_rgba(0,0,0,0.14)]' 
    : 'bg-white/5 shadow-black hover:bg-white/10 shadow-[0_0_36px_rgba(255,255,255,0.05)]';

  return (
    <div 
      className={`fixed inset-0 z-[120] flex items-center justify-center p-4 transition-all duration-200 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      role="presentation"
      aria-hidden={!isOpen}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-md cursor-pointer" onClick={onClose} aria-hidden="true" />
      <div 
        className={`
          relative w-full max-w-sm max-h-[75vh] flex flex-col rounded-[28.6px] shadow-[0_60px_160px_rgba(0,0,0,0.6)] overflow-hidden transition-all duration-300 transform cubic-bezier(0.16, 1, 0.3, 1)
          ${isOpen ? 'scale-100 translate-y-0 opacity-100' : 'scale-95 translate-y-8 opacity-0'}
          ${isLight ? 'bg-[#f2f2f7]/95 text-black' : 'bg-zinc-900/90 text-white'}
        `}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
      >
        <div className={`p-8 pb-4 flex items-center justify-between border-b ${isLight ? 'border-black/5' : 'border-white/5'}`}>
          <h2 id="history-title" className="text-2xl font-black tracking-tighter">History</h2>
          <button 
            onClick={onClose} 
            aria-label="Close history panel"
            className={`p-2.5 rounded-full hover:bg-black/5 transition-colors duration-150 ${isLight ? 'text-black' : 'text-white'}`}
          >
            <Icons.X size={24} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar" role="list" aria-label="Calculation history">
          {history.length === 0 ? (
            <div className={`h-full py-20 flex items-center justify-center font-black uppercase tracking-[0.3em] text-[10px] ${isLight ? 'text-zinc-400' : 'text-zinc-500'}`} role="status">Empty Archive</div>
          ) : (
            history.map((item, idx) => (
              <div 
                key={item.id} 
                role="listitem"
                tabIndex={0}
                aria-label={`History item ${idx + 1}: ${item.expression} equals ${item.result}`}
                onClick={() => onSelect(item)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item); } }}
                className={`p-6 rounded-[23.4px] transition-all duration-300 cursor-pointer group active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-white/40 ${levitateClass}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="text-[9px] uppercase tracking-[0.2em] font-black opacity-30">{formatDateTime(item.timestamp)}</div>
                  <div className="text-2xl font-black tracking-tighter leading-none">= {item.result}</div>
                </div>
                <div className="text-xs font-bold opacity-50 truncate">{item.expression}</div>
              </div>
            ))
          )}
        </div>

        <div className={`p-6 border-t ${isLight ? 'border-black/5' : 'border-white/5'}`}>
          <button 
            onClick={onClear} 
            aria-label="Clear all calculation history"
            className="w-full py-5 rounded-[18.2px] bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all duration-300 font-black uppercase tracking-[0.3em] text-[10px] active:scale-95"
          >
            Clear History
          </button>
        </div>
      </div>
    </div>
  );
};

export default HistoryPanel;