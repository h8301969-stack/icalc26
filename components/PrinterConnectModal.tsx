import React, { useCallback, useEffect, useState } from 'react';
import { Icons } from '../constants';
import {
  printerInstance,
  KnownPrinter,
  getBluetoothSupport,
  getUsbSupport,
  getNetworkPrinterSupport,
  getPrinterCapabilities,
  normalizeBluetoothError,
} from '../utils/bluetoothPrinter';
import { pickPrintableImage } from '../utils/nativeCamera';
import { MorphPresence } from './MorphCrossfade';

interface PrinterConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLight: boolean;
  onPrint: () => Promise<void>;
  isPrinting?: boolean;
  autoPrintOnConnect?: boolean;
}

const transportLabel = (transport?: string) => {
  if (transport === 'usb') return 'USB';
  if (transport === 'network') return 'WiFi';
  return 'Bluetooth';
};

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
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [printFormat, setPrintFormat] = useState<string | null>(null);
  const [bluetoothSupport, setBluetoothSupport] = useState(getBluetoothSupport);
  const [usbSupport, setUsbSupport] = useState(getUsbSupport);
  const [networkSupport, setNetworkSupport] = useState(getNetworkPrinterSupport);
  const [wifiHost, setWifiHost] = useState('');
  const [wifiPort, setWifiPort] = useState('9100');
  const [wifiName, setWifiName] = useState('');
  const [showWifiForm, setShowWifiForm] = useState(false);
  const [showReqs, setShowReqs] = useState(false);
  const [noteTitle, setNoteTitle] = useState('Note');
  const [noteBody, setNoteBody] = useState('');
  const [mediaBusy, setMediaBusy] = useState(false);

  const capabilities = getPrinterCapabilities();

  const refreshPrinterState = useCallback(async () => {
    const known = await printerInstance.getKnownPrinters();
    setKnownPrinters(known);
    if (printerInstance.isConnected) {
      setPrinterName(printerInstance.getConnectedDeviceName());
      setPrintFormat(printerInstance.getActivePrintFormat().summary);
    } else {
      setPrinterName(null);
      setPrintFormat(null);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setBluetoothSupport(getBluetoothSupport());
    setUsbSupport(getUsbSupport());
    setNetworkSupport(getNetworkPrinterSupport());
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

  // Auto-scan known printers when modal opens (USB → BT → WiFi)
  useEffect(() => {
    if (!isOpen) return;
    if (printerInstance.isConnected) {
      void refreshPrinterState();
      return;
    }
    let cancelled = false;
    setIsAutoScanning(true);
    setErrorMessage(null);
    (async () => {
      try {
        const result = await printerInstance.autoConnectPreferredSequence(10000);
        if (cancelled) return;
        setPrinterName(result.name);
        setPrintFormat(result.format);
        await refreshPrinterState();
      } catch {
        // stay idle — user can scan manually
      } finally {
        if (!cancelled) setIsAutoScanning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-run when modal opens; avoid onPrint/onClose identity churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleScanAndConnect = async () => {
    setIsScanning(true);
    setConnectingId(null);
    setErrorMessage(null);
    try {
      const connectedName = await printerInstance.scanAndConnect();
      setPrinterName(connectedName);
      setPrintFormat(printerInstance.getActivePrintFormat().summary);
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
      setPrintFormat(printerInstance.getActivePrintFormat().summary);
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

  const handleWifiConnect = async () => {
    setIsScanning(true);
    setConnectingId(null);
    setErrorMessage(null);
    try {
      const port = parseInt(wifiPort, 10) || 9100;
      const connectedName = await printerInstance.connectNetworkPrinter({
        host: wifiHost,
        port,
        name: wifiName || undefined,
      });
      setPrinterName(connectedName);
      setPrintFormat(printerInstance.getActivePrintFormat().summary);
      setShowWifiForm(false);
      await refreshPrinterState();
      if (autoPrintOnConnect) {
        await handlePrint();
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'WiFi printer connection failed.');
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
      setPrintFormat(printerInstance.getActivePrintFormat().summary);
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

  const runMediaPrint = async (job: () => Promise<boolean>, emptyMessage?: string) => {
    setErrorMessage(null);
    setMediaBusy(true);
    try {
      const connected = printerInstance.isConnected || (await printerInstance.ensureConnected());
      if (!connected) {
        setErrorMessage('Connect a printer first.');
        return;
      }
      const ok = await job();
      if (!ok && emptyMessage) setErrorMessage(emptyMessage);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to print.';
      if (!/cancel/i.test(message)) setErrorMessage(message);
    } finally {
      setMediaBusy(false);
      await refreshPrinterState();
    }
  };

  const handlePrintPhoto = (kind: 'photo' | 'sticker', source: 'camera' | 'photos') => {
    void runMediaPrint(async () => {
      const picked = await pickPrintableImage(source);
      if (!picked.success || !picked.imageData) {
        throw new Error(picked.error || 'No photo selected.');
      }
      return kind === 'sticker'
        ? printerInstance.printSticker(picked.imageData)
        : printerInstance.printPhoto(picked.imageData);
    });
  };

  const handlePrintNote = () => {
    const body = noteBody.trim();
    if (!body) {
      setErrorMessage('Type a note first.');
      return;
    }
    void runMediaPrint(
      () => printerInstance.printNote(noteTitle.trim() || 'Note', body),
      'Could not print the note.'
    );
  };

  const panelBg = isLight ? 'bg-[#f2f2f7] text-zinc-900' : 'bg-[#1c1c1e] text-white';
  const rowBg = isLight ? 'bg-white border-zinc-200' : 'bg-white/5 border-white/5';
  const inputClass = isLight
    ? 'bg-white border-zinc-200 text-zinc-900'
    : 'bg-white/5 border-white/10 text-white';

  return (
    <MorphPresence show={isOpen}>
      {(visible) => (
    <div className={`fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-4 ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 morph-scrim ${visible ? 'morph-scrim--in' : 'morph-scrim--out'} ${isLight ? 'bg-[#f2f2f7]' : 'bg-[#0a0a0c]'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative w-full max-w-sm rounded-[28px] overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.45)] morph-panel ${visible ? 'morph-panel--in' : 'morph-panel--out'} ${panelBg}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="printer-connect-title"
      >
        <div className={`px-5 pt-5 pb-3 flex items-center justify-between border-b ${isLight ? 'border-black/6' : 'border-white/6'}`}>
          <div className="flex items-center gap-2">
            <span className="text-blue-500"><Icons.Printer size={20} /></span>
            <h3 id="printer-connect-title" className="text-lg font-black ">
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

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
          <div className={`p-3 rounded-lg text-[11px] font-bold leading-normal border ${
            isLight ? 'bg-zinc-50 border-zinc-200 text-zinc-700' : 'bg-white/5 border-white/10 text-white/80'
          }`}>
            <div className="font-black mb-1">Auto-connect order</div>
            <div>1. USB · 2. Bluetooth (BLE) · 3. WiFi / network</div>
            <div className={`mt-1.5 font-medium ${isLight ? 'text-black/55' : 'text-white/55'}`}>
              Print format: Fun Print (photos, stickers, notes) on pocket printers, plus ESC/POS text/raster on receipt printers. Dialect is detected from Bluetooth services — no name matching.
            </div>
            {isAutoScanning && (
              <div className="mt-2 text-blue-500">Scanning for known printers…</div>
            )}
          </div>

          {printerName && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-green-500/10 border border-green-500/20">
              <div className="min-w-0">
                <span className="app-subtext text-xs font-bold text-green-500">Connected</span>
                <div className="text-sm font-black truncate">{printerName}</div>
                {printFormat && (
                  <div className={`app-subtext text-[10px] font-bold mt-0.5 ${isLight ? 'text-black/50' : 'text-white/50'}`}>
                    {printFormat}
                  </div>
                )}
              </div>
              <span className="text-green-500 shrink-0"><Icons.Check size={18} /></span>
            </div>
          )}

          {knownPrinters.length > 0 && (
            <div className="space-y-2">
              <span className="text-sm font-black">Available printers</span>
              {knownPrinters.map((entry) => {
                const isBusy = connectingId === entry.saved.id;
                const isConnected = entry.status === 'connected';
                const statusLabel = isConnected
                  ? 'Connected'
                  : entry.status === 'available'
                    ? 'Ready to connect'
                    : 'Saved printer';
                return (
                  <div
                    key={entry.saved.id}
                    className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${rowBg}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-black truncate">{entry.saved.name}</div>
                      <div className={`app-subtext text-[10px] font-bold mt-0.5 ${isLight ? 'text-black/50' : 'text-white/50'}`}>
                        {transportLabel(entry.saved.transport)} · {statusLabel}
                        {entry.saved.host ? ` · ${entry.saved.host}:${entry.saved.port ?? 9100}` : ''}
                      </div>
                    </div>
                    {isConnected ? (
                      <span className="text-green-500 shrink-0"><Icons.Check size={18} /></span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleConnectSaved(entry.saved.id)}
                        disabled={
                          isBusy ||
                          isScanning ||
                          (entry.saved.transport === 'ble' && !bluetoothSupport.supported) ||
                          (entry.saved.transport === 'usb' && !usbSupport.supported)
                        }
                        className="py-1.5 px-3 rounded-lg bg-blue-500 text-white text-xs font-black uppercase active:scale-95 disabled:opacity-50 shrink-0"
                      >
                        {isBusy ? '...' : 'Connect'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {knownPrinters.length === 0 && !isAutoScanning && (
            <div className={`app-subtext text-[10px] opacity-45 p-4 rounded-xl text-center ${isLight ? 'text-black' : 'text-white'}`}>
              No printers yet. Connect USB, search Bluetooth, or add a WiFi IP.
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleUsbConnect()}
            disabled={isScanning || connectingId !== null || !usbSupport.supported}
            className="w-full py-3.5 rounded-xl bg-violet-600 text-white text-xs font-black uppercase hover:bg-violet-700 active:scale-95 disabled:opacity-50 transition-all"
          >
            {isScanning ? 'Connecting...' : 'Connect USB Printer'}
          </button>

          <button
            type="button"
            onClick={handleScanAndConnect}
            disabled={isScanning || connectingId !== null || !bluetoothSupport.supported}
            className="w-full py-3.5 rounded-xl bg-blue-500 text-white text-xs font-black uppercase hover:bg-blue-600 active:scale-95 disabled:opacity-50 transition-all"
          >
            {isScanning ? 'Searching...' : 'Search for Bluetooth Printer'}
          </button>

          <button
            type="button"
            onClick={() => setShowWifiForm((v) => !v)}
            disabled={isScanning || connectingId !== null}
            className="w-full py-3.5 rounded-xl bg-teal-600 text-white text-xs font-black uppercase hover:bg-teal-700 active:scale-95 disabled:opacity-50 transition-all"
          >
            {showWifiForm ? 'Hide WiFi form' : 'Add WiFi / Network Printer'}
          </button>

          {showWifiForm && (
            <div className={`space-y-2 p-3 rounded-xl border ${rowBg}`}>
              {networkSupport.message && (
                <p className={`text-[10px] font-bold leading-normal ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  {networkSupport.message}
                </p>
              )}
              <input
                type="text"
                inputMode="decimal"
                placeholder="Printer IP (e.g. 192.168.1.50)"
                value={wifiHost}
                onChange={(e) => setWifiHost(e.target.value)}
                className={`w-full px-3 py-2.5 rounded-lg border text-sm font-bold ${inputClass}`}
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Port"
                  value={wifiPort}
                  onChange={(e) => setWifiPort(e.target.value)}
                  className={`w-24 px-3 py-2.5 rounded-lg border text-sm font-bold ${inputClass}`}
                />
                <input
                  type="text"
                  placeholder="Name (optional)"
                  value={wifiName}
                  onChange={(e) => setWifiName(e.target.value)}
                  className={`flex-1 px-3 py-2.5 rounded-lg border text-sm font-bold ${inputClass}`}
                />
              </div>
              <button
                type="button"
                onClick={() => void handleWifiConnect()}
                disabled={isScanning || !wifiHost.trim()}
                className="w-full py-2.5 rounded-lg bg-teal-600 text-white text-xs font-black uppercase active:scale-95 disabled:opacity-50"
              >
                {isScanning ? 'Connecting...' : 'Connect WiFi Printer'}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowReqs((v) => !v)}
            className={`w-full text-left text-[10px] font-black uppercase ${isLight ? 'text-black/50' : 'text-white/50'}`}
          >
            {showReqs ? 'Hide' : 'Show'} print requirements & format
          </button>

          {showReqs && (
            <div className={`p-3 rounded-lg text-[10px] font-bold leading-relaxed border space-y-2 ${
              isLight ? 'bg-zinc-50 border-zinc-200 text-zinc-700' : 'bg-white/5 border-white/10 text-white/75'
            }`}>
              <div>
                <span className="font-black">Formats: </span>
                {capabilities.formats.funprint.name}; {capabilities.formats.text.name}; {capabilities.formats.raster.name}
              </div>
              <ul className="list-disc pl-4 space-y-1">
                {capabilities.necessities.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          {bluetoothSupport.message && !bluetoothSupport.supported && (
            <div className="p-3 rounded-lg text-xs font-bold leading-normal border bg-amber-500/10 border-amber-500/20 text-amber-600">
              {bluetoothSupport.message}
            </div>
          )}

          {usbSupport.message && !usbSupport.supported && (
            <div className="p-3 rounded-lg text-xs font-bold leading-normal border bg-amber-500/10 border-amber-500/20 text-amber-600">
              {usbSupport.message}
            </div>
          )}

          {errorMessage && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold">
              {errorMessage}
            </div>
          )}

          {/* When opened from invoice switcher print, autoPrintOnConnect handles the job.
              Only show a print button for manual connect-then-print flows. */}
          {printerName && (
            <div className={`space-y-2 p-3 rounded-xl border ${rowBg}`}>
              <div className="text-sm font-black">Photos, stickers & notes</div>
              <p className={`text-[10px] font-bold leading-normal ${isLight ? 'text-black/55' : 'text-white/55'}`}>
                Same Fun Print jobs as the companion app. Receipts still print from the invoice drawer.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handlePrintPhoto('photo', 'photos')}
                  disabled={mediaBusy || isPrinting}
                  className="py-2.5 rounded-lg bg-blue-500 text-white text-[10px] font-black uppercase active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Icons.Image size={14} />
                  Photo
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintPhoto('sticker', 'photos')}
                  disabled={mediaBusy || isPrinting}
                  className="py-2.5 rounded-lg bg-violet-600 text-white text-[10px] font-black uppercase active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Icons.StickyNote size={14} />
                  Sticker
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintPhoto('photo', 'camera')}
                  disabled={mediaBusy || isPrinting}
                  className="py-2.5 rounded-lg bg-zinc-700 text-white text-[10px] font-black uppercase active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 col-span-2"
                >
                  <Icons.Camera size={14} />
                  Camera
                </button>
              </div>
              <input
                type="text"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="Note title"
                className={`w-full px-3 py-2 rounded-lg border text-xs font-bold ${inputClass}`}
              />
              <textarea
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Type a note, list, or sticker text…"
                rows={3}
                className={`w-full px-3 py-2 rounded-lg border text-xs font-bold resize-none ${inputClass}`}
              />
              <button
                type="button"
                onClick={handlePrintNote}
                disabled={mediaBusy || isPrinting || !noteBody.trim()}
                className="w-full py-2.5 rounded-lg bg-amber-500 text-black text-[10px] font-black uppercase active:scale-95 disabled:opacity-50"
              >
                {mediaBusy ? 'Printing…' : 'Print note'}
              </button>
            </div>
          )}

          {printerName && !autoPrintOnConnect && (
            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting || mediaBusy}
              className="w-full py-3.5 rounded-xl bg-green-500 text-white text-xs font-black uppercase shadow-[0_0_20px_rgba(48,209,88,0.4)] hover:bg-green-600 active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              <Icons.Check size={16} />
              {isPrinting ? 'Printing...' : 'Print Invoice'}
            </button>
          )}
        </div>
      </div>
    </div>
      )}
    </MorphPresence>
  );
};

export default PrinterConnectModal;
