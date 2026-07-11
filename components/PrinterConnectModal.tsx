import React, { useCallback, useEffect, useState } from 'react';
import { Icons } from '../constants';
import {
  printerInstance,
  KnownPrinter,
  getBluetoothSupport,
  getUsbSupport,
  normalizeBluetoothError,
} from '../utils/bluetoothPrinter';
import { PAPER_WIDTH_OPTIONS, type PaperWidth } from '../utils/receiptLayout';

interface PrinterConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLight: boolean;
  onPrint: () => Promise<void>;
  isPrinting?: boolean;
  autoPrintOnConnect?: boolean;
}

const PrinterConnectModal: React.FC<PrinterConnectModalProps> = ({
  isOpen,
  onClose,
  isLight,
  onPrint,
  isPrinting = false,
  autoPrintOnConnect = false,
}) => {
  const [printerName, setPrinterName] = useState<string | null>(null);
  const [knownPrinters, setKnownPrinters] = useState<KnownPrinter[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bluetoothSupport, setBluetoothSupport] = useState(getBluetoothSupport);
  const [usbSupport, setUsbSupport] = useState(getUsbSupport);
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(() => printerInstance.paperWidth);

  const refreshPrinterState = useCallback(async () => {
    const known = await printerInstance.getKnownPrinters();
    setKnownPrinters(known);
    setPaperWidth(printerInstance.paperWidth);
    if (printerInstance.isConnected) {
      setPrinterName(printerInstance.getConnectedDeviceName());
    } else {
      setPrinterName(null);
    }
  }, []);

  const handlePaperWidthChange = useCallback((width: PaperWidth) => {
    printerInstance.setPaperWidth(width);
    setPaperWidth(width);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setBluetoothSupport(getBluetoothSupport());
    setUsbSupport(getUsbSupport());
    void refreshPrinterState();

    const bt = navigator.bluetooth;
    const onAvailability = () => setBluetoothSupport(getBluetoothSupport());
    bt?.addEventListener?.('availabilitychanged', onAvailability);
    return () => bt?.removeEventListener?.('availabilitychanged', onAvailability);
  }, [isOpen, refreshPrinterState]);

  useEffect(() => {
    if (!isOpen) return;
    const onChange = () => {
      void refreshPrinterState();
    };
    printerInstance.setConnectionChangeListener(onChange);
    return () => printerInstance.removeConnectionChangeListener(onChange);
  }, [isOpen, refreshPrinterState]);

  const handleScanAndConnect = async () => {
    setIsScanning(true);
    setConnectingId(null);
    setErrorMessage(null);
    try {
      const connectedName = await printerInstance.scanAndConnect();
      setPrinterName(connectedName);
      await refreshPrinterState();
      if (autoPrintOnConnect) {
        await handlePrint();
      }
    } catch (err: unknown) {
      const message = normalizeBluetoothError(err).message;
      if (!message.toLowerCase().includes('cancel')) {
        setErrorMessage(message);
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleUsbConnect = async () => {
    setIsScanning(true);
    setConnectingId(null);
    setErrorMessage(null);
    try {
      const connectedName = await printerInstance.scanAndConnectUsb();
      setPrinterName(connectedName);
      await refreshPrinterState();
      if (autoPrintOnConnect) {
        await handlePrint();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'USB connection failed.';
      if (!message.toLowerCase().includes('cancel')) {
        setErrorMessage(message);
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleConnectSaved = async (printerId: string) => {
    setConnectingId(printerId);
    setErrorMessage(null);
    try {
      const connectedName = await printerInstance.connectToSavedPrinter(printerId);
      setPrinterName(connectedName);
      await refreshPrinterState();
      if (autoPrintOnConnect) {
        await handlePrint();
      }
    } catch (err: unknown) {
      const message = normalizeBluetoothError(err).message;
      if (!message.toLowerCase().includes('cancel')) {
        setErrorMessage(message);
      }
    } finally {
      setConnectingId(null);
    }
  };

  const handlePrint = async () => {
    setErrorMessage(null);
    try {
      await onPrint();
      onClose();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to print.');
    }
  };

  if (!isOpen) return null;

  const panelBg = isLight ? 'bg-[#f2f2f7] text-zinc-900' : 'bg-[#1c1c1e] text-white';
  const rowBg = isLight ? 'bg-white border-zinc-200' : 'bg-white/5 border-white/5';

  return (
    <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-4 pointer-events-auto">
      <div
        className={`absolute inset-0 ${isLight ? 'bg-[#f2f2f7]' : 'bg-[#0a0a0c]'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative w-full max-w-sm rounded-[28px] overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.45)] ${panelBg}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="printer-connect-title"
      >
        <div className={`px-5 pt-5 pb-3 flex items-center justify-between border-b ${isLight ? 'border-black/6' : 'border-white/6'}`}>
          <div className="flex items-center gap-2">
            <span className="text-blue-500"><Icons.Printer size={20} /></span>
            <h3 id="printer-connect-title" className="text-lg font-black tracking-tight">
              Connect Printer
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`p-2 rounded-full ${isLight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
          >
            <Icons.X size={22} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {bluetoothSupport.message && (
            <div className={`p-3 rounded-lg text-xs font-bold leading-normal border ${
              bluetoothSupport.supported
                ? 'bg-blue-500/10 border-blue-500/20 text-blue-600'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-600'
            }`}>
              {bluetoothSupport.message}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-black">Paper width</span>
              <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                58mm for standard (57mm) rolls · 25mm for mini printers
              </span>
            </div>
            <div className="flex rounded-full overflow-hidden border text-xs font-black uppercase tracking-widest">
              {PAPER_WIDTH_OPTIONS.map(({ id, label }) => {
                const active = paperWidth === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handlePaperWidthChange(id)}
                    className={`flex-1 py-2.5 transition-all ${
                      active
                        ? isLight
                          ? 'bg-black text-white'
                          : 'bg-white text-black'
                        : 'opacity-50'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {printerName && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-green-500/10 border border-green-500/20">
              <div className="min-w-0">
                <span className="app-subtext text-xs font-bold text-green-500">Connected</span>
                <div className="text-sm font-black truncate">{printerName}</div>
              </div>
              <span className="text-green-500 shrink-0"><Icons.Check size={18} /></span>
            </div>
          )}

          {knownPrinters.filter((e) => e.status !== 'connected').map((entry) => {
            const isBusy = connectingId === entry.saved.id;
            return (
              <div
                key={entry.saved.id}
                className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${rowBg}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black truncate">{entry.saved.name}</div>
                  <div className={`app-subtext text-[10px] font-bold mt-0.5 ${isLight ? 'text-black/50' : 'text-white/50'}`}>
                    {(entry.saved.transport === 'usb' ? 'USB · ' : 'BLE · ') + (entry.status === 'available' ? 'Ready to connect' : 'Saved printer')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleConnectSaved(entry.saved.id)}
                  disabled={isBusy || isScanning || (entry.saved.transport !== 'usb' && !bluetoothSupport.supported)}
                  className="py-1.5 px-3 rounded-lg bg-blue-500 text-white text-xs font-black uppercase active:scale-95 disabled:opacity-50 shrink-0"
                >
                  {isBusy ? '...' : 'Connect'}
                </button>
              </div>
            );
          })}

          {knownPrinters.length === 0 && (
            <div className={`app-subtext text-[10px] opacity-45 p-4 rounded-xl text-center ${isLight ? 'text-black' : 'text-white'}`}>
              No printers yet. Scan to pair your first device.
            </div>
          )}

          <button
            type="button"
            onClick={handleScanAndConnect}
            disabled={isScanning || connectingId !== null || !bluetoothSupport.supported}
            className="w-full py-3.5 rounded-xl bg-blue-500 text-white text-xs font-black uppercase tracking-widest hover:bg-blue-600 active:scale-95 disabled:opacity-50 transition-all"
          >
            {isScanning ? 'Searching...' : 'Scan Bluetooth Printer'}
          </button>

          {usbSupport.message && (
            <div className={`p-3 rounded-lg text-xs font-bold leading-normal border ${
              usbSupport.supported
                ? 'bg-violet-500/10 border-violet-500/20 text-violet-600'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-600'
            }`}>
              {usbSupport.message}
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleUsbConnect()}
            disabled={isScanning || connectingId !== null || !usbSupport.supported}
            className="w-full py-3.5 rounded-xl bg-violet-600 text-white text-xs font-black uppercase tracking-widest hover:bg-violet-700 active:scale-95 disabled:opacity-50 transition-all"
          >
            {isScanning ? 'Connecting...' : 'Connect USB Printer'}
          </button>

          {errorMessage && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold">
              {errorMessage}
            </div>
          )}

          {printerName && !autoPrintOnConnect && (
            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting}
              className="w-full py-3.5 rounded-xl bg-green-500 text-white text-xs font-black uppercase tracking-widest shadow-[0_0_20px_rgba(48,209,88,0.4)] hover:bg-green-600 active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              <Icons.Check size={16} />
              {isPrinting ? 'Printing...' : 'Print Invoice'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PrinterConnectModal;