import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icons } from '../constants';
import { printerInstance, KnownPrinter, getBluetoothSupport } from '../utils/bluetoothPrinter';
import { CartLineItem, UserProfile } from '../types';
import ProfileAvatar from './ProfileAvatar';
import ProfilePickerModal from './ProfilePickerModal';
import { STANDBY_TIMER_OPTIONS } from '../hooks/useStandby';

interface SettingsSlice {
  themeMode: 'light' | 'dark' | 'system';
  disableCalculatorCard?: boolean;
  layoutMode?: 'portrait' | 'landscape';
  layoutModeAuto?: boolean;
  invoiceSwitcherMode?: 'horizontal' | 'grid' | 'vertical';
  invoiceSwitcherGridCols?: 3 | 4;
  standbyTimerSeconds?: number;
  profiles?: UserProfile[];
  activeProfileId?: string;
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SettingsSlice;
  updateSettings: (keyOrPatch: string | Partial<SettingsSlice>, value?: unknown) => void;
  onApplyAppearance?: () => void;
  cartItems?: CartLineItem[];
  runningTotal?: number;
  invoiceName?: string;
  currency?: string;
  onInvoicePrinted?: (invoiceName: string, total: string, items: CartLineItem[]) => void;
  isLight?: boolean;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ 
  isOpen, 
  onClose, 
  settings,
  updateSettings: _updateSettings,
  onApplyAppearance,
  isLight: isLightProp,
  cartItems = [],
  runningTotal = 0,
  invoiceName = 'Walk-in Customer',
  currency = '¢',
  onInvoicePrinted,
}) => {
  const isLight = isLightProp ?? settings.themeMode === 'light';

  // Bluetooth states
  const [printerName, setPrinterName] = useState<string | null>(null);
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [knownPrinters, setKnownPrinters] = useState<KnownPrinter[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [printSuccess, setPrintSuccess] = useState(false);
  const [bluetoothSupport, setBluetoothSupport] = useState(getBluetoothSupport);
  const [isProfilePickerOpen, setIsProfilePickerOpen] = useState(false);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
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

  const applyAppearance = useCallback((keyOrPatch: string | Partial<SettingsSlice>, value?: unknown) => {
    if (typeof keyOrPatch === 'string') {
      _updateSettings({ [keyOrPatch]: value } as Partial<SettingsSlice>);
    } else {
      _updateSettings(keyOrPatch);
    }
    onApplyAppearance?.();
  }, [_updateSettings, onApplyAppearance]);

  const cycleLayoutMode = useCallback(() => {
    const current = settings.layoutMode ?? 'portrait';
    applyAppearance({ layoutMode: current === 'portrait' ? 'landscape' : 'portrait', layoutModeAuto: false });
  }, [settings.layoutMode, applyAppearance]);

  const cycleCalculatorBackground = useCallback(() => {
    applyAppearance('disableCalculatorCard', !settings.disableCalculatorCard);
  }, [settings.disableCalculatorCard, applyAppearance]);

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

  const refreshPrinterState = useCallback(async () => {
    const known = await printerInstance.getKnownPrinters();
    setKnownPrinters(known);
    if (printerInstance.isConnected) {
      setPrinterName(printerInstance.getConnectedDeviceName());
      setConnectedId(printerInstance.getConnectedDeviceId());
    } else {
      setPrinterName(null);
      setConnectedId(null);
    }
  }, []);

  useEffect(() => {
    printerInstance.setConnectionChangeListener(() => {
      void refreshPrinterState();
    });
    return () => printerInstance.setConnectionChangeListener(null);
  }, [refreshPrinterState]);

  useEffect(() => {
    if (!isOpen) return;
    setBluetoothSupport(getBluetoothSupport());
    void refreshPrinterState();

    const bt = navigator.bluetooth;
    const onAvailability = () => setBluetoothSupport(getBluetoothSupport());
    bt?.addEventListener?.('availabilitychanged', onAvailability);
    return () => bt?.removeEventListener?.('availabilitychanged', onAvailability);
  }, [isOpen, refreshPrinterState]);

  const handleScanAndConnect = async () => {
    setIsScanning(true);
    setConnectingId(null);
    setErrorMessage(null);
    setPrintSuccess(false);
    try {
      const connectedName = await printerInstance.scanAndConnect();
      setPrinterName(connectedName);
      setConnectedId(printerInstance.getConnectedDeviceId());
      await refreshPrinterState();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect to printer.';
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
    setPrintSuccess(false);
    try {
      const connectedName = await printerInstance.connectToSavedPrinter(printerId);
      setPrinterName(connectedName);
      setConnectedId(printerInstance.getConnectedDeviceId());
      await refreshPrinterState();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reconnect to printer.';
      if (!message.toLowerCase().includes('cancel')) {
        setErrorMessage(message);
      }
    } finally {
      setConnectingId(null);
    }
  };

  const handleDisconnect = () => {
    printerInstance.disconnect();
    setPrinterName(null);
    setConnectedId(null);
    setPrintSuccess(false);
    void refreshPrinterState();
  };

  const profiles = settings.profiles ?? [];
  const activeProfile =
    profiles.find((p) => p.id === settings.activeProfileId) ?? profiles[0] ?? null;

  const handleSelectProfile = (profileId: string) => {
    _updateSettings({ activeProfileId: profileId });
  };

  const handleAddProfile = (name: string, avatarUrl: string) => {
    const profile: UserProfile = {
      id: `profile-${Date.now()}`,
      name,
      avatarUrl,
    };
    _updateSettings({
      profiles: [...profiles, profile],
      activeProfileId: profile.id,
    });
  };

  const handleUpdateProfileAvatar = (profileId: string, avatarUrl: string) => {
    _updateSettings({
      profiles: profiles.map((p) => (p.id === profileId ? { ...p, avatarUrl } : p)),
    });
  };

  const handleActiveAvatarGallery = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeProfile) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        handleUpdateProfileAvatar(activeProfile.id, reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePrintReceipt = async () => {
    setErrorMessage(null);
    setPrintSuccess(false);
    try {
      const connected = printerInstance.isConnected || (await printerInstance.ensureConnected());
      if (!connected) {
        setErrorMessage('No printer connected. Scan and pair a printer first.');
        return;
      }
      setPrinterName(printerInstance.getConnectedDeviceName());
      setConnectedId(printerInstance.getConnectedDeviceId());
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

      const activeProfile =
        profiles.find((p) => p.id === settings.activeProfileId) ?? profiles[0] ?? null;
      const ok = await printerInstance.printInvoice(
        titleToPrint,
        itemsToPrint,
        totalToPrint,
        currency,
        activeProfile?.name
      );
      if (!ok) return;
      onInvoicePrinted?.(titleToPrint, String(totalToPrint), itemsToPrint);
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
        ${isLight ? 'bg-[#f2f2f7] text-black' : 'bg-[#1c1c1e] text-white'}
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

        {/* Profile */}
        <div className={`p-8 rounded-2xl border transition-all duration-300 ${isLight ? 'bg-white border-zinc-200 shadow-[0_12px_32px_rgba(0,0,0,0.12)]' : 'bg-zinc-800/40 border-white/5 shadow-[0_0_20px_rgba(255,255,255,0.18)]'}`}>
          <input
            ref={avatarFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleActiveAvatarGallery}
            aria-hidden="true"
          />
          <div className="flex flex-col items-center gap-3">
            <ProfileAvatar
              profile={activeProfile}
              size={80}
              isLight={isLight}
              onClick={() => avatarFileInputRef.current?.click()}
              ariaLabel="Change profile photo from gallery"
            />
            <button
              type="button"
              onClick={() => setIsProfilePickerOpen(true)}
              className="text-xl font-black tracking-tight lowercase active:opacity-60 transition-opacity"
              aria-label={`Switch profile, current: ${activeProfile?.name ?? 'none'}`}
            >
              {activeProfile?.name ?? 'fred'}
            </button>
          </div>
        </div>

        <ProfilePickerModal
          isOpen={isProfilePickerOpen}
          onClose={() => setIsProfilePickerOpen(false)}
          isLight={isLight}
          profiles={profiles}
          activeProfileId={settings.activeProfileId ?? activeProfile?.id ?? ''}
          onSelectProfile={handleSelectProfile}
          onAddProfile={handleAddProfile}
          onUpdateProfileAvatar={handleUpdateProfileAvatar}
        />

        {/* Idle / Standby Screen */}
        <div className={`p-6 rounded-2xl border transition-all duration-300 ${isLight ? 'bg-white border-zinc-200 shadow-[0_12px_32px_rgba(0,0,0,0.12)]' : 'bg-zinc-800/40 border-white/5 shadow-[0_0_20px_rgba(255,255,255,0.18)]'}`}>
          <div className="flex items-center gap-3 mb-4">
            <span><Icons.Moon size={20} /></span>
            <h3 className={`app-subtext text-sm font-black ${isLight ? 'text-black' : 'text-white'}`}>Idle Screen</h3>
          </div>

          <div className="flex flex-wrap gap-2">
            {STANDBY_TIMER_OPTIONS.map((option) => {
              const isActive = (settings.standbyTimerSeconds ?? 0) === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => _updateSettings({ standbyTimerSeconds: option.value })}
                  className={`app-subtext px-3 py-2 rounded-xl text-[10px] font-black border transition-all active:scale-95 ${
                    isActive
                      ? 'bg-blue-500 text-white border-blue-500'
                      : isLight
                        ? 'bg-zinc-100 border-zinc-200 text-black'
                        : 'bg-white/5 border-white/5 text-white'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Appearance Settings */}
        <div className={`p-6 rounded-2xl border transition-all duration-300 ${isLight ? 'bg-white border-zinc-200 shadow-[0_12px_32px_rgba(0,0,0,0.12)]' : 'bg-zinc-800/40 border-white/5 shadow-[0_0_20px_rgba(255,255,255,0.18)]'}`}>
          <div className="flex items-center gap-3 mb-4">
            <span>{isLight ? <Icons.Sun size={20} /> : <Icons.Moon size={20} />}</span>
            <h3 className={`app-subtext text-sm font-black ${isLight ? 'text-black' : 'text-white'}`}>Appearance</h3>
          </div>

          <div className="space-y-4">
            {/* Theme Toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-black">Theme</span>
              <div className="flex rounded-full overflow-hidden border text-xs font-black uppercase tracking-widest">
                <button
                  onClick={() => _updateSettings({ themeMode: 'light' })}
                  className={`px-3 py-1.5 flex items-center gap-1 transition-all ${settings.themeMode === 'light' ? 'bg-black text-white' : (isLight ? 'bg-zinc-100' : 'bg-white/10')}`}
                >
                  <Icons.Sun size={14} /> Light
                </button>
                <button
                  onClick={() => _updateSettings({ themeMode: 'dark' })}
                  className={`px-3 py-1.5 flex items-center gap-1 transition-all ${settings.themeMode === 'dark' ? 'bg-white text-black' : (isLight ? 'bg-zinc-100' : 'bg-white/10')}`}
                >
                  <Icons.Moon size={14} /> Dark
                </button>
                <button
                  onClick={() => _updateSettings({ themeMode: 'system' })}
                  className={`px-3 py-1.5 transition-all ${settings.themeMode === 'system' ? (isLight ? 'bg-black text-white' : 'bg-white text-black') : (isLight ? 'bg-zinc-100' : 'bg-white/10')}`}
                >
                  Auto
                </button>
              </div>
            </div>

            {/* Layout Mode */}
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <div className="flex flex-col">
                <span className="text-sm font-black">Layout</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  {settings.layoutModeAuto !== false ? 'Auto from device orientation' : 'Manual layout override'}
                </span>
              </div>
              <button
                type="button"
                onClick={cycleLayoutMode}
                className={`flex rounded-full overflow-hidden border text-xs font-black uppercase tracking-widest px-4 py-1.5 items-center gap-1.5 transition-all ${isLight ? 'bg-black text-white' : 'bg-white text-black'}`}
                aria-label={`Layout: ${(settings.layoutMode ?? 'portrait') === 'portrait' ? 'Portrait' : 'Landscape'}. Tap to switch.`}
              >
                {(settings.layoutMode ?? 'portrait') === 'portrait' ? (
                  <><Icons.Portrait size={14} /> Portrait</>
                ) : (
                  <><Icons.Landscape size={14} /> Landscape</>
                )}
              </button>
            </div>

            {/* Invoice switcher layout */}
            <div className="pt-2 border-t border-white/10 space-y-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-black">Invoice switcher</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  How invoices appear when you open the switcher
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  { id: 'horizontal' as const, label: 'Horizontal', icon: Icons.Carousel },
                  { id: 'grid' as const, label: 'Grid', icon: Icons.Grid },
                  { id: 'vertical' as const, label: 'Vertical', icon: Icons.Stack },
                ]).map(({ id, label, icon: Icon }) => {
                  const active = (settings.invoiceSwitcherMode ?? 'horizontal') === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => applyAppearance({ invoiceSwitcherMode: id })}
                      className={`app-subtext px-3 py-2 rounded-xl text-[10px] font-black border transition-all active:scale-95 flex items-center gap-1.5 ${
                        active
                          ? 'bg-blue-500 text-white border-blue-500'
                          : isLight
                            ? 'bg-zinc-100 border-zinc-200 text-black'
                            : 'bg-white/5 border-white/5 text-white'
                      }`}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  );
                })}
              </div>
              {(settings.invoiceSwitcherMode ?? 'horizontal') === 'grid' && (
                <div className="flex items-center justify-between">
                  <span className={`app-subtext text-[10px] font-black ${isLight ? 'text-black/70' : 'text-white/70'}`}>
                    Grid density
                  </span>
                  <div className="flex rounded-full overflow-hidden border text-[10px] font-black uppercase tracking-widest">
                    {([3, 4] as const).map((cols) => {
                      const active = (settings.invoiceSwitcherGridCols ?? 3) === cols;
                      return (
                        <button
                          key={cols}
                          type="button"
                          onClick={() => applyAppearance({ invoiceSwitcherGridCols: cols })}
                          className={`px-3 py-1.5 transition-all ${
                            active
                              ? isLight ? 'bg-black text-white' : 'bg-white text-black'
                              : isLight ? 'bg-zinc-100 text-black' : 'bg-white/10 text-white'
                          }`}
                        >
                          {cols}×{cols}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Calculator on background */}
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <div className="flex flex-col">
                <span className="text-sm font-black">Calculator on background</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>Remove card • fill more space, larger buttons</span>
              </div>
              <button
                type="button"
                onClick={cycleCalculatorBackground}
                className={`flex rounded-full overflow-hidden border text-xs font-black uppercase tracking-widest px-4 py-1.5 transition-all ${isLight ? 'bg-black text-white' : 'bg-white text-black'}`}
                aria-label={`Calculator display: ${settings.disableCalculatorCard ? 'On background' : 'On card'}. Tap to switch.`}
              >
                {settings.disableCalculatorCard ? 'Background' : 'Card'}
              </button>
            </div>
          </div>
        </div>

        {/* Bluetooth / BLE Printer */}
        <div className={`p-6 rounded-2xl border transition-all duration-300 ${isLight ? 'bg-white border-zinc-200 shadow-[0_12px_32px_rgba(0,0,0,0.12)]' : 'bg-zinc-800/40 border-white/5 shadow-[0_0_20px_rgba(255,255,255,0.18)]'}`}>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-blue-500"><Icons.Printer size={22} /></span>
            <h3 className={`app-subtext text-sm font-black ${isLight ? 'text-black' : 'text-white'}`}>Bluetooth</h3>
          </div>

          <div className="space-y-4">
            {bluetoothSupport.message && (
              <div className={`p-3 rounded-lg text-xs font-bold leading-normal border ${
                bluetoothSupport.supported
                  ? 'bg-blue-500/10 border-blue-500/20 text-blue-600'
                  : 'bg-amber-500/10 border-amber-500/20 text-amber-600'
              }`}>
                {bluetoothSupport.message}
                {!bluetoothSupport.secureContext && (
                  <span className="block mt-1 opacity-80">
                    HTTP on localhost works; HTTPS works everywhere supported.
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <span className={`app-subtext text-[10px] font-black ${isLight ? 'text-black' : 'text-white'}`}>
                {knownPrinters.length} device{knownPrinters.length !== 1 ? 's' : ''} known
              </span>
              <button
                type="button"
                onClick={() => void refreshPrinterState()}
                className={`text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg active:scale-95 ${
                  isLight ? 'bg-zinc-100 text-black' : 'bg-white/10 text-white'
                }`}
              >
                Refresh
              </button>
            </div>

            {knownPrinters.filter((e) => e.status === 'connected').map((entry) => (
              <div
                key={`connected-${entry.saved.id}`}
                className="flex items-center justify-between p-3 rounded-xl bg-green-500/10 border border-green-500/20"
              >
                <div className="flex flex-col min-w-0">
                  <span className="app-subtext text-xs font-bold text-green-500">Connected</span>
                  <span className="text-sm font-black truncate">{entry.saved.name}</span>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="py-1.5 px-3 rounded-lg bg-red-500/10 text-red-500 text-xs font-black uppercase hover:bg-red-500/20 active:scale-95 transition-all shrink-0"
                >
                  Disconnect
                </button>
              </div>
            ))}

            {knownPrinters.filter((e) => e.status === 'available').length > 0 && (
              <div className="space-y-2">
                <span className={`app-subtext text-[10px] font-black ${isLight ? 'text-black' : 'text-white'}`}>
                  Available (paired in browser)
                </span>
                {knownPrinters.filter((e) => e.status === 'available').map((entry) => {
                  const isBusy = connectingId === entry.saved.id;
                  return (
                    <div
                      key={`available-${entry.saved.id}`}
                      className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${
                        isLight ? 'bg-zinc-50 border-zinc-200' : 'bg-white/5 border-white/5'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-black truncate">{entry.saved.name}</div>
                        <div className={`app-subtext text-[10px] font-bold mt-0.5 ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                          Ready to connect
                        </div>
                      </div>
                      <button
                        onClick={() => handleConnectSaved(entry.saved.id)}
                        disabled={isBusy || isScanning || !bluetoothSupport.supported}
                        className="py-1.5 px-3 rounded-lg bg-blue-500 text-white text-xs font-black uppercase active:scale-95 disabled:opacity-50 transition-all shrink-0"
                      >
                        {isBusy ? '...' : 'Connect'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {knownPrinters.filter((e) => e.status === 'saved').length > 0 && (
              <div className="space-y-2">
                <span className={`app-subtext text-[10px] font-black ${isLight ? 'text-black' : 'text-white'}`}>
                  Saved printers
                </span>
                {knownPrinters.filter((e) => e.status === 'saved').map((entry) => {
                  const isBusy = connectingId === entry.saved.id;
                  return (
                    <div
                      key={`saved-${entry.saved.id}`}
                      className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${
                        isLight ? 'bg-zinc-50 border-zinc-200' : 'bg-white/5 border-white/5'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-black truncate">{entry.saved.name}</div>
                        <div className={`app-subtext text-[10px] font-bold mt-0.5 ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                          {entry.saved.lastConnected > 0
                            ? `Last used ${new Date(entry.saved.lastConnected).toLocaleDateString()}`
                            : 'Tap connect to pair again'}
                        </div>
                      </div>
                      <button
                        onClick={() => handleConnectSaved(entry.saved.id)}
                        disabled={isBusy || isScanning || !bluetoothSupport.supported}
                        className="py-1.5 px-3 rounded-lg bg-blue-500 text-white text-xs font-black uppercase active:scale-95 disabled:opacity-50 transition-all shrink-0"
                      >
                        {isBusy ? '...' : 'Connect'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {knownPrinters.length === 0 && (
              <div className={`p-4 rounded-xl text-center text-xs font-bold ${isLight ? 'text-black' : 'text-white'}`}>
                No printers yet. Scan to pair your first device.
              </div>
            )}

            <button
              onClick={handleScanAndConnect}
              disabled={isScanning || connectingId !== null || !bluetoothSupport.supported}
              className="w-full py-3.5 rounded-xl bg-blue-500 text-white text-xs font-black uppercase tracking-widest hover:bg-blue-600 active:scale-95 disabled:opacity-50 transition-all shadow-md"
            >
              {isScanning ? 'Searching...' : knownPrinters.length > 0 ? 'Scan for new printer' : 'Scan & Connect Printer'}
            </button>

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
