import React from 'react';
import { Icons } from '../constants';
import { CartLineItem, InvoiceActionLog } from '../types';
import { formatPosLineItemDisplay } from '../utils/posExpression';

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onClear: () => void;
  isLight?: boolean;
  currency?: string;
  invoiceName: string;
  onInvoiceNameChange: (name: string) => void;
  cartItems: CartLineItem[];
  actionLogs: InvoiceActionLog[];
  runningTotal: string;
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({
  isOpen,
  onClose,
  onClear,
  isLight = false,
  currency = 'GHS',
  invoiceName,
  onInvoiceNameChange,
  cartItems,
  actionLogs,
  runningTotal,
}) => {
  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const levitateClass = isLight
    ? 'bg-white shadow-[0_12px_36px_rgba(0,0,0,0.08)]'
    : 'bg-white/5 shadow-[0_0_36px_rgba(255,255,255,0.05)]';

  const textMuted = isLight ? 'text-zinc-400' : 'text-zinc-500';

  return (
    <div
      className={`fixed inset-0 z-[120] flex flex-col justify-end transition-all duration-300 ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      role="presentation"
      aria-hidden={!isOpen}
    >
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-md transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className={`
          relative w-full max-h-[78vh] flex flex-col rounded-t-[28.6px] shadow-[0_-20px_80px_rgba(0,0,0,0.45)] overflow-hidden
          transition-transform duration-500 cubic-bezier(0.16, 1, 0.3, 1)
          ${isOpen ? 'translate-y-0' : 'translate-y-full'}
          ${isLight ? 'bg-[#f2f2f7]/95 text-black' : 'bg-zinc-900/95 text-white'}
        `}
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-title"
      >
        <div className="flex justify-center pt-3 pb-1">
          <div
            className={`w-10 h-1 rounded-full ${isLight ? 'bg-black/15' : 'bg-white/20'}`}
            aria-hidden="true"
          />
        </div>

        <div
          className={`px-6 pb-4 flex items-center justify-between gap-3 border-b ${
            isLight ? 'border-black/5' : 'border-white/5'
          }`}
        >
          <input
            id="invoice-title"
            type="text"
            value={invoiceName}
            onChange={(e) => onInvoiceNameChange(e.target.value)}
            placeholder="Invoice #1"
            aria-label="Invoice name"
            className={`flex-1 min-w-0 text-2xl font-black tracking-tighter bg-transparent outline-none border-b border-transparent focus:border-current/20 transition-colors placeholder:opacity-30 ${
              isLight ? 'text-black' : 'text-white'
            }`}
          />
          <button
            onClick={onClose}
            aria-label="Close invoice panel"
            className={`p-2.5 rounded-full hover:bg-black/5 transition-colors duration-150 shrink-0 ${
              isLight ? 'text-black' : 'text-white'
            }`}
          >
            <Icons.X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 custom-scrollbar">
          <section aria-label="Live cart">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40">
                Live Cart
              </h3>
              <span className="text-xl font-black tracking-tighter">= {runningTotal}</span>
            </div>

            {cartItems.length === 0 ? (
              <div
                className={`py-10 flex items-center justify-center font-black uppercase tracking-[0.3em] text-[10px] ${textMuted}`}
                role="status"
              >
                Start typing to add items
              </div>
            ) : (
              <div className={`p-5 rounded-[23.4px] space-y-2 ${levitateClass}`}>
                {cartItems.map((item, idx) => (
                  <div
                    key={`${idx}-${item.price}-${item.quantity}`}
                    className="text-sm font-semibold tracking-tight opacity-80"
                  >
                    {formatPosLineItemDisplay(item, currency, item.name)}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section aria-label="Action log">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40 mb-3">
              Action Log
            </h3>

            {actionLogs.length === 0 ? (
              <div className={`py-6 text-center text-[10px] font-black uppercase tracking-[0.25em] ${textMuted}`}>
                Items log here as you complete each line
              </div>
            ) : (
              <div className="space-y-3">
                {actionLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-4 rounded-[18px] flex items-start gap-3 ${levitateClass}`}
                  >
                    <div
                      className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                        isLight ? 'bg-green-500' : 'bg-green-400'
                      }`}
                      aria-hidden="true"
                    />
                    <p className="text-sm font-semibold tracking-tight opacity-75 leading-snug">
                      {log.message}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div
          className={`px-6 pt-2 pb-2 border-t ${isLight ? 'border-black/5' : 'border-white/5'}`}
        >
          <button
            onClick={onClear}
            aria-label="Clear invoice cart"
            className="w-full py-4 rounded-[18.2px] bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all duration-300 font-black uppercase tracking-[0.3em] text-[10px] active:scale-95"
          >
            Clear Invoice
          </button>
        </div>
      </div>
    </div>
  );
};

export default HistoryPanel;
