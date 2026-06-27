import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icons } from '../constants';
import { printerInstance } from '../utils/bluetoothPrinter';
import { CartLineItem } from '../types';

interface SettingsSlice {
  themeMode: 'light' | 'dark';
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SettingsSlice;
  updateSettings: (key: string, value: unknown) => void;
  cartItems?: CartLineItem[];
  runningTotal?: number;
  invoiceName?: string;
  currency?: string;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ 
  isOpen, 
  onClose, 
  settings,
  updateSettings: _updateSettings,
  cartItems = [],
  runningTotal = 0,
  invoiceName = 'Walk-in Customer',
  currency = '¢',
}) => {
  const isLight = settings.themeMode === 'light';

  // Bluetooth states
  const [printerName, setPrinterName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [paperWidth, setPaperWidth] = useState<'58mm' | '25mm'>('58mm');
  const [printSuccess, setPrintSuccess] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => {
    const panel = panelRef.current;
    const active = document.activeElement as HTMLElement | null;
    if (panel?.contains(active)) {
      active.blur();
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
      const id = requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(id);
    }

    const panel = panelRef.current;
    const active = document.activeElement as HTMLElement | null;
    if (panel?.contains(active)) {
      active.blur();
    }
    lastFocusedRef.current?.focus?.({ preventScroll: true });
  }, [isOpen]);

  // Sync paper width configuration from printer instance
  useEffect(() => {
    setPaperWidth(printerInstance.paperWidth);
  }, [printerName]);

  const handleScanAndConnect = async () => {
    setIsConnecting(true);
    setErrorMessage(null);
    setPrintSuccess(false);
    try {
      const connectedName = await printerInstance.scanAndConnect();
      setPrinterName(connectedName);
      setPaperWidth(printerInstance.paperWidth);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to connect to printer.');
      setPrinterName(null);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    printerInstance.disconnect();
    setPrinterName(null);
    setPrintSuccess(false);
  };

  const handlePaperWidthChange = (width: '58mm' | '25mm') => {
    printerInstance.paperWidth = width;
    setPaperWidth(width);
  };

  const handlePrintReceipt = async () => {
    if (!printerName) return;
    setErrorMessage(null);
    setPrintSuccess(false);
    try {
      // Use actual items if available, otherwise print a demo test receipt
      const itemsToPrint = cartItems.length > 0 
        ? cartItems.map((item, idx) => ({
            id: `item-${idx}`,
            name: item.name || `Item ${idx + 1}`,
            price: item.price,
            quantity: item.quantity
          }))
        : [
            { id: 'demo1', name: 'Neural Processor T1', price: 29.99, quantity: 1 },
            { id: 'demo2', name: 'Optic Cable 2M', price: 12.50, quantity: 2 }
          ];
      const totalToPrint = cartItems.length > 0 ? runningTotal : 54.99;
      const titleToPrint = cartItems.length > 0 ? invoiceName : 'Demo Invoice';

      await printerInstance.printInvoice(titleToPrint, itemsToPrint, totalToPrint, currency);
      setPrintSuccess(true);
      setTimeout(() => setPrintSuccess(false), 3000);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to print invoice.');
    }
  };

  return (
    <div 
      ref={panelRef}
      inert={!isOpen ? true : undefined}
      className={`
        absolute inset-0 z-50 flex flex-col transition-transform duration-300 cubic-bezier(0.16, 1, 0.3, 1)
        ${isOpen ? 'translate-x-0 pointer-events-auto' : 'translate-x-full pointer-events-none'}
        ${isLight ? 'bg-[#f2f2f7] text-zinc-900' : 'bg-[#1c1c1e] text-white'}
      `}
      role="dialog"
      aria-modal={isOpen}
      aria-labelledby="settings-title"
    >
      <div className="p-8 pb-4 flex items-center justify-between border-b border-current/5">
        <h2 id="settings-title" className="text-2xl font-black tracking-tight">Settings</h2>
        <button 
          ref={closeRef}
          onClick={handleClose} 
          aria-label="Close settings panel"
          className={`p-2.5 rounded-full ${isLight ? 'bg-zinc-200 hover:bg-zinc-300' : 'bg-white/10 hover:bg-white/20'}`}
        >
          <Icons.X size={24} />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
        
        {/* BLE Printer Configuration Box */}
        <div className={`p-6 rounded-2xl border transition-all duration-300 ${isLight ? 'bg-white border-zinc-200 shadow-[0_12px_32px_rgba(0,0,0,0.12)]' : 'bg-zinc-800/40 border-white/5 shadow-[0_0_20px_rgba(255,255,255,0.18)]'}`}>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-blue-500"><Icons.Settings size={22} /></span>
            <h3 className="text-sm font-black uppercase tracking-wider">BLE Thermal Printer</h3>
          </div>

          <div className="space-y-4">
            {printerName ? (
              <div className="flex items-center justify-between p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-green-500 uppercase tracking-widest">Connected</span>
                  <span className="text-sm font-black truncate max-w-[180px]">{printerName}</span>
                </div>
                <button 
                  onClick={handleDisconnect}
                  className="py-1.5 px-3 rounded-lg bg-red-500/10 text-red-500 text-xs font-black uppercase hover:bg-red-500/20 active:scale-95 transition-all"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button 
                onClick={handleScanAndConnect}
                disabled={isConnecting}
                className="w-full py-3.5 rounded-xl bg-blue-500 text-white text-xs font-black uppercase tracking-widest hover:bg-blue-600 active:scale-95 disabled:opacity-50 transition-all shadow-md"
              >
                {isConnecting ? 'Searching...' : 'Scan & Connect Printer'}
              </button>
            )}

            {/* Paper Size selector (auto detects, allows manual correction) */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider opacity-40">Roll Specifications</span>
              <div className="flex gap-2">
                {(['58mm', '25mm'] as const).map(width => (
                  <button
                    key={width}
                    onClick={() => handlePaperWidthChange(width)}
                    className={`flex-1 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all active:scale-95 ${
                      paperWidth === width 
                        ? 'bg-blue-500 text-white border-blue-500' 
                        : (isLight ? 'bg-zinc-100 border-zinc-200 text-zinc-900' : 'bg-white/5 border-white/5 text-white/60')
                    }`}
                  >
                    {width} {printerName && printerInstance.paperWidth === width && '(Auto)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Test Invoice / Print Action */}
            {printerName && (
              <button
                onClick={handlePrintReceipt}
                className={`w-full py-3 rounded-xl border text-xs font-black uppercase tracking-widest transition-all active:scale-95 ${
                  printSuccess 
                    ? 'bg-green-500 text-white border-green-500' 
                    : (isLight ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-900 border-white')
                }`}
              >
                {printSuccess ? 'Printed Successfully!' : 'Print Current Invoice'}
              </button>
            )}

            {/* Error Message Display */}
            {errorMessage && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold leading-normal">
                {errorMessage}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default SettingsPanel;
