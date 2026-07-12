import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icons } from '../constants';
import {
  printerInstance,
  KnownPrinter,
  getBluetoothSupport,
  normalizeBluetoothError,
} from '../utils/bluetoothPrinter';
import { CartLineItem, NewProfileInput, UserProfile } from '../types';
import ProfileAvatar from './ProfileAvatar';
import ProfilePickerModal from './ProfilePickerModal';
import { STANDBY_TIMER_OPTIONS } from '../hooks/useStandby';
import { ADMIN_PROFILE_NAME, ensureAdminProfile, isAdminProfile } from '../utils/auth';
import { EXPRESSION_VIEW_OPTIONS } from '../utils/expressionDisplay';
import { RECEIPT_LAYOUT_OPTIONS } from '../utils/receiptLayout';
import FluidSegmentControl from './FluidSegmentControl';
import FluidToggle from './FluidToggle';
import BusinessInfoReceiptCard from './BusinessInfoReceiptCard';
import PasswordField from './PasswordField';
import { updateUserBusinessInfo } from '../utils/accessControl';


interface SettingsSlice {
  themeMode: 'light' | 'dark' | 'system';
  disableCalculatorCard?: boolean;
  layoutMode?: 'portrait' | 'landscape';
  layoutModeAuto?: boolean;
  invoiceSwitcherMode?: 'horizontal' | 'grid' | 'vertical' | 'list';
  expressionViewMode?: 'auto' | 'list';
  receiptLayoutMode?: 'summary' | 'full';
  visionHubDrawerMode?: 'drag' | 'click';

  standbyTimerSeconds?: number;
  profiles?: UserProfile[];
  activeProfileId?: string;
  businessName?: string;
  businessPhone?: string;
  businessAddress?: string;
  currency?: string;
  ghsCalculatorStyle?: 'ghs' | 'cedis';
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  focusSectionIndex?: number;
  settings: SettingsSlice;
  updateSettings: (keyOrPatch: string | Partial<SettingsSlice>, value?: unknown) => void;
  onApplyAppearance?: () => void;
  cartItems?: CartLineItem[];
  runningTotal?: number;
  invoiceName?: string;
  currency?: string;
  onInvoicePrinted?: (invoiceName: string, total: string, items: CartLineItem[]) => void;
  isLight?: boolean;
  accountUsername?: string;
  onChangePassword?: (current: string, newPassword: string) => Promise<{ error?: string; ok?: boolean }>;
  onLogout?: () => void;
  onVerifyAdminPassword?: (password: string) => Promise<{ error?: string; ok?: boolean }>;
  canInstallApp?: boolean;
  isAppInstalled?: boolean;
  onInstallApp?: () => void;
  installAppMode?: 'chromium' | 'ios-safari' | 'ios-other' | null;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ 
  isOpen, 
  onClose,
  focusSectionIndex = 0,
  settings,
  updateSettings: _updateSettings,
  onApplyAppearance,
  isLight: isLightProp,
  cartItems = [],
  runningTotal = 0,
  invoiceName = 'Walk-in Customer',
  currency = '¢',
  onInvoicePrinted,
  accountUsername,
  onChangePassword,
  onLogout,
  onVerifyAdminPassword,
  canInstallApp = false,
  isAppInstalled = false,
  onInstallApp,
  installAppMode = null,
}) => {
  const isIOSInstall = installAppMode === 'ios-safari' || installAppMode === 'ios-other';
  const isLight = isLightProp ?? settings.themeMode === 'light';

  // Bluetooth states
  const [printerName, setPrinterName] = useState<string | null>(null);
  const [, setConnectedId] = useState<string | null>(null);
  const [knownPrinters, setKnownPrinters] = useState<KnownPrinter[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [printSuccess, setPrintSuccess] = useState(false);
  const [bluetoothSupport, setBluetoothSupport] = useState(getBluetoothSupport);
  const [detectedPaperWidth, setDetectedPaperWidth] = useState(() => printerInstance.paperWidth);
  const [isProfilePickerOpen, setIsProfilePickerOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showPasswordPanel, setShowPasswordPanel] = useState(false);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const businessDraftRef = useRef({
    businessName: settings.businessName ?? '',
    businessPhone: settings.businessPhone ?? '',
    businessAddress: settings.businessAddress ?? '',
  });
  const savedBusinessRef = useRef({
    businessName: settings.businessName ?? '',
    businessPhone: settings.businessPhone ?? '',
    businessAddress: settings.businessAddress ?? '',
  });
  const [businessDirty, setBusinessDirty] = useState(false);
  const [businessSaving, setBusinessSaving] = useState(false);
  const [businessSyncError, setBusinessSyncError] = useState<string | null>(null);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  useEffect(() => {
    const next = {
      businessName: settings.businessName ?? '',
      businessPhone: settings.businessPhone ?? '',
      businessAddress: settings.businessAddress ?? '',
    };
    businessDraftRef.current = next;
    savedBusinessRef.current = next;
    setBusinessDirty(false);
  }, [settings.businessName, settings.businessPhone, settings.businessAddress]);

  useEffect(() => {
    if (!isOpen) return;
    const section = sectionRefs.current[focusSectionIndex];
    if (!section) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusSectionIndex, isOpen]);

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
    setDetectedPaperWidth(printerInstance.paperWidth);
    if (printerInstance.isConnected) {
      setPrinterName(printerInstance.getConnectedDeviceName());
      setConnectedId(printerInstance.getConnectedDeviceId());
    } else {
      setPrinterName(null);
      setConnectedId(null);
    }
  }, []);

  useEffect(() => {
    const onChange = () => {
      void refreshPrinterState();
    };
    printerInstance.setConnectionChangeListener(onChange);
    return () => printerInstance.removeConnectionChangeListener(onChange);
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
      const message = normalizeBluetoothError(err).message;
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
      const message = normalizeBluetoothError(err).message;
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
  const canEditBusinessInfo = isAdminProfile(activeProfile);

  const handleSelectProfile = (profileId: string) => {
    _updateSettings({ activeProfileId: profileId });
  };

  const handleAddProfile = async ({ name, avatarUrl, email, phone, sellerType }: NewProfileInput) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.toLowerCase() === ADMIN_PROFILE_NAME.toLowerCase()) return;
    const profile: UserProfile = {
      id: `profile-${Date.now()}`,
      name: trimmed,
      avatarUrl,
      email: email.trim(),
      phone: phone.trim(),
      sellerType,
    };
    _updateSettings({
      profiles: ensureAdminProfile([...profiles, profile]),
      activeProfileId: profile.id,
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  };

  const handleChangePasswordSubmit = async () => {
    if (!onChangePassword) return;
    setPasswordError(null);
    setPasswordSuccess(false);
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setIsChangingPassword(true);
    try {
      const result = await onChangePassword(currentPassword, newPassword);
      if (result.error) {
        setPasswordError(result.error);
        return;
      }
      setPasswordSuccess(true);
      setTimeout(() => {
        setPasswordSuccess(false);
        closePasswordPanel();
      }, 1200);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleUpdateProfileAvatar = (profileId: string, avatarUrl: string) => {
    _updateSettings({
      profiles: profiles.map((p) => (p.id === profileId ? { ...p, avatarUrl } : p)),
    });
  };

  const handleBusinessFieldChange = useCallback((patch: Partial<typeof businessDraftRef.current>) => {
    businessDraftRef.current = { ...businessDraftRef.current, ...patch };
    _updateSettings(patch);
    setBusinessDirty(true);
    setBusinessSyncError(null);
  }, [_updateSettings]);

  const confirmBusinessChanges = useCallback(async () => {
    setBusinessSaving(true);
    setBusinessSyncError(null);
    try {
      const draft = businessDraftRef.current;
      const result = await updateUserBusinessInfo({
        businessName: draft.businessName,
        businessPhone: draft.businessPhone,
        businessAddress: draft.businessAddress,
      });
      if (!result.ok) {
        setBusinessSyncError(result.error);
        return;
      }
      savedBusinessRef.current = { ...draft };
      setBusinessDirty(false);
    } finally {
      setBusinessSaving(false);
    }
  }, []);

  const closePasswordPanel = useCallback(() => {
    setShowPasswordPanel(false);
    setPasswordError(null);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }, []);

  const renderSettingsModal = (children: React.ReactNode, onClose: () => void, label: string) => (
    <div className="settings-modal-overlay absolute inset-0 z-[60] flex items-center justify-center p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`settings-modal-card relative w-full max-w-sm rounded-2xl border p-5 shadow-2xl ${
          isLight ? 'bg-white border-zinc-200 text-black' : 'bg-[#1c1c1e] border-white/12 text-white'
        }`}
      >
        {children}
      </div>
    </div>
  );

  const renderSettingsCardHeader = (title: string, icon: React.ReactNode) => (
    <div className="settings-card-header mb-4">
      <span className="settings-card-header__icon shrink-0">{icon}</span>
      <h3 className="settings-card-title settings-card-title--chip">{title}</h3>
    </div>
  );

  const renderSecuritySection = () => {
    if (!accountUsername || !onChangePassword || !onLogout) return null;
    return (
      <div className={`settings-security w-full px-8 pb-8 pt-4 border-t ${isLight ? 'border-zinc-200/80' : 'border-white/10'}`}>
        <div className="settings-card-header mb-3">
          <span className="settings-card-header__icon shrink-0 text-blue-500">
            <Icons.Settings size={20} />
          </span>
          <h4 className="settings-card-title settings-card-title--chip">Security</h4>
        </div>
        <p className={`settings-security__account app-subtext text-[11px] mb-4 ${isLight ? 'text-black/50' : 'text-white/50'}`}>
          Signed in as <span className="font-bold">{accountUsername}</span>
        </p>
        <div className="settings-security__actions flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => setShowPasswordPanel(true)}
            className={`settings-security__btn w-full py-3.5 px-4 rounded-xl text-sm font-black tracking-tight active:scale-[0.98] transition-all ${
              isLight
                ? 'bg-blue-500 text-white shadow-[0_8px_22px_rgba(59,130,246,0.35)]'
                : 'bg-blue-500/90 text-white shadow-[0_10px_28px_rgba(255,255,255,0.22)]'
            }`}
          >
            Change password
          </button>
          <button
            type="button"
            onClick={() => setShowSignOutConfirm(true)}
            className={`settings-security__btn settings-security__btn--signout w-full py-3 px-4 rounded-xl text-sm font-bold active:scale-[0.98] transition-all border ${
              isLight
                ? 'bg-white border-zinc-200 text-zinc-700'
                : 'bg-white/8 border-white/14 text-white/85'
            }`}
          >
            Click here to sign out
          </button>
        </div>
      </div>
    );
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
        activeProfile?.name,
        settings.receiptLayoutMode ?? 'summary'
      );
      if (!ok) return;
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
        settings-panel ${isLight ? 'settings-panel--light bg-[#f2f2f7] text-black' : 'settings-panel--dark bg-[#1c1c1e] text-white'}
      `}
      role="dialog"
      aria-modal={isOpen}
      aria-labelledby="settings-title"
    >
      <div className="p-8 pb-4 flex items-center justify-between border-b border-current/5">
        <h2 id="settings-title" className="settings-panel-title text-2xl font-black tracking-tight">Settings</h2>
        <button 
          ref={closeRef}
          onClick={handleClose} 
          aria-label="Close settings panel"
          className={`p-2.5 rounded-full ${isLight ? 'bg-zinc-200 hover:bg-zinc-300' : 'bg-white/10 hover:bg-white/20'}`}
        >
          <Icons.X size={24} />
        </button>
      </div>
      
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">

        {/* Profile */}
        <div
          ref={(el) => { sectionRefs.current[0] = el; }}
          className={`rounded-2xl border overflow-hidden transition-all duration-300 ${isLight ? 'bg-white border-zinc-200 shadow-[0_12px_32px_rgba(0,0,0,0.12)]' : 'bg-zinc-800/40 border-white/5 shadow-[0_0_20px_rgba(255,255,255,0.18)]'}`}
        >
          {(accountUsername || settings.businessName?.trim()) && (
            <BusinessInfoReceiptCard
              variant="settings"
              badgeLabel="Business"
              businessName={settings.businessName?.trim() || ''}
              businessPhone={settings.businessPhone}
              businessAddress={settings.businessAddress}
              className="w-full"
              editable={canEditBusinessInfo}
              isLight={isLight}
              onBusinessNameChange={(value) => handleBusinessFieldChange({ businessName: value })}
              onBusinessPhoneChange={(value) => handleBusinessFieldChange({ businessPhone: value })}
              onBusinessAddressChange={(value) => handleBusinessFieldChange({ businessAddress: value })}
            />
          )}
          {canEditBusinessInfo && businessDirty && (
            <div className="px-6 pb-3">
              <button
                type="button"
                onClick={() => void confirmBusinessChanges()}
                disabled={businessSaving}
                className={`w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center gap-2 ${
                  isLight ? 'bg-blue-500 text-white' : 'bg-blue-500 text-white'
                }`}
              >
                {businessSaving ? (
                  <>
                    <span className="auth-spinner" aria-hidden="true" />
                    Saving…
                  </>
                ) : (
                  'Confirm changes'
                )}
              </button>
            </div>
          )}
          {businessSyncError && (
            <p className="px-4 pt-2 text-red-500 text-[11px] font-bold">{businessSyncError}</p>
          )}
          <input
            ref={avatarFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleActiveAvatarGallery}
            aria-hidden="true"
          />
          <div className="flex flex-col items-center gap-3 p-8 pt-6">
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
          {renderSecuritySection()}
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
          onVerifyAdminPassword={onVerifyAdminPassword}
        />

        {/* Appearance Settings */}
        <div
          ref={(el) => { sectionRefs.current[1] = el; }}
          className={`p-6 rounded-2xl border transition-all duration-300 ${isLight ? 'bg-white border-zinc-200 shadow-[0_12px_32px_rgba(0,0,0,0.12)]' : 'bg-zinc-800/40 border-white/5 shadow-[0_0_20px_rgba(255,255,255,0.18)]'}`}
        >
          {renderSettingsCardHeader('Appearance', isLight ? <Icons.Sun size={22} /> : <Icons.Moon size={22} />)}

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-black">Theme</span>
              <FluidSegmentControl
                isLight={isLight}
                ariaLabel="Theme mode"
                value={settings.themeMode}
                onChange={(themeMode) => _updateSettings({ themeMode })}
                options={[
                  { id: 'light', label: 'Light', icon: <Icons.Sun size={14} /> },
                  { id: 'dark', label: 'Dark', icon: <Icons.Moon size={14} /> },
                  { id: 'system', label: 'Auto' },
                ]}
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-black">Layout</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  {settings.layoutModeAuto !== false ? 'Auto from device orientation' : 'Manual layout override'}
                </span>
              </div>
              <FluidSegmentControl
                isLight={isLight}
                ariaLabel="Layout orientation"
                value={settings.layoutMode ?? 'portrait'}
                onChange={(layoutMode) => applyAppearance({ layoutMode, layoutModeAuto: false })}
                options={[
                  { id: 'portrait', label: 'Portrait', icon: <Icons.Portrait size={14} /> },
                  { id: 'landscape', label: 'Landscape', icon: <Icons.Landscape size={14} /> },
                ]}
              />
            </div>

            {/* Invoice switcher layout */}
            <div className="pt-2 border-t border-white/10 space-y-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-black">Invoice switcher</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  How invoices appear when you open the switcher
                </span>
              </div>
              <FluidSegmentControl
                variant="chip"
                size="sm"
                isLight={isLight}
                ariaLabel="Invoice switcher layout"
                value={settings.invoiceSwitcherMode ?? 'horizontal'}
                onChange={(invoiceSwitcherMode) => applyAppearance({ invoiceSwitcherMode })}
                options={[
                  { id: 'horizontal', label: 'Horizontal', icon: <Icons.Carousel size={14} /> },
                  { id: 'vertical', label: 'Vertical', icon: <Icons.Stack size={14} /> },
                  { id: 'grid', label: 'Scattered', icon: <Icons.Grid size={14} /> },
                  { id: 'list', label: 'List', icon: <Icons.List size={14} /> },
                ]}
              />
            </div>

            {/* Expression view */}
            <div className="pt-2 border-t border-white/10 space-y-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-black">Expression view</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  Auto wraps to fit · List breaks after each +
                </span>
              </div>
              <FluidSegmentControl
                isLight={isLight}
                className="w-full"
                ariaLabel="Expression view mode"
                value={settings.expressionViewMode ?? 'auto'}
                onChange={(expressionViewMode) => applyAppearance({ expressionViewMode })}
                options={EXPRESSION_VIEW_OPTIONS.map(({ id, label }) => ({ id, label }))}
              />
            </div>

            {/* Vision Hub drawer */}
            <div className="pt-2 border-t border-white/10 space-y-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-black">Vision Hub drawer</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  Drag invoices to the printer, or tap to focus and print
                </span>
              </div>
              <FluidSegmentControl
                isLight={isLight}
                className="w-full"
                ariaLabel="Vision Hub drawer mode"
                value={settings.visionHubDrawerMode ?? 'drag'}
                onChange={(visionHubDrawerMode) => applyAppearance({ visionHubDrawerMode })}
                options={[
                  { id: 'drag', label: 'Drag', icon: <Icons.Printer size={14} /> },
                  { id: 'click', label: 'Click', icon: <Icons.List size={14} /> },
                ]}
              />
            </div>

            {/* Share & print receipt */}
            <div className="pt-2 border-t border-white/10 space-y-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-black">Invoice print style</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  Share image and Bluetooth receipt layout
                </span>
              </div>
              <FluidSegmentControl
                isLight={isLight}
                className="w-full"
                ariaLabel="Invoice print style"
                value={settings.receiptLayoutMode ?? 'summary'}
                onChange={(receiptLayoutMode) => applyAppearance({ receiptLayoutMode })}
                options={RECEIPT_LAYOUT_OPTIONS.map(({ id, label }) => ({ id, label }))}
              />
            </div>

            {(settings.currency ?? 'GHS') === 'GHS' && (
              <div className="pt-2 border-t border-white/10 space-y-3">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-black">Calculator currency style</span>
                  <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                    How amounts appear in the live result
                  </span>
                </div>
                <FluidSegmentControl
                  isLight={isLight}
                  className="w-full"
                  ariaLabel="Calculator GHS display style"
                  value={settings.ghsCalculatorStyle ?? 'ghs'}
                  onChange={(ghsCalculatorStyle) => _updateSettings({ ghsCalculatorStyle })}
                  options={[
                    { id: 'ghs', label: 'ghs' },
                    { id: 'cedis', label: '¢ cedis' },
                  ]}
                />
              </div>
            )}

            <div className="pt-2 border-t border-white/10 space-y-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-black">Idle screen</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  How long before the lock screen appears
                </span>
              </div>
              <FluidSegmentControl
                variant="chip"
                size="sm"
                isLight={isLight}
                ariaLabel="Idle screen timer"
                value={String(settings.standbyTimerSeconds ?? 0)}
                onChange={(id) => _updateSettings({ standbyTimerSeconds: Number(id) })}
                options={STANDBY_TIMER_OPTIONS.map((option) => ({
                  id: String(option.value),
                  label: option.label,
                }))}
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-black">Calculator on background</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  Remove card for more space and larger buttons
                </span>
              </div>
              <FluidToggle
                isLight={isLight}
                checked={!!settings.disableCalculatorCard}
                onChange={(disableCalculatorCard) => applyAppearance('disableCalculatorCard', disableCalculatorCard)}
                ariaLabel="Calculator on background"
                offLabel="Card"
                onLabel="Background"
              />
            </div>

            {canInstallApp && !isAppInstalled && onInstallApp && (
              <div className="pt-2 border-t border-white/10">
                <div className="flex flex-col gap-1 mb-3">
                  <span className="text-sm font-black">
                    {isIOSInstall ? 'Add to Home Screen' : 'Install app'}
                  </span>
                  <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                    {isIOSInstall
                      ? installAppMode === 'ios-other'
                        ? 'Open in Safari, then Share → Add to Home Screen'
                        : 'Tap Share in Safari, then Add to Home Screen'
                      : 'Add iCalc to your home screen for offline access'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void onInstallApp()}
                  className={`w-full py-3.5 px-4 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 active:scale-[0.98] transition-all ${
                    isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'
                  }`}
                >
                  {isIOSInstall ? <Icons.Share size={16} /> : <Icons.Download size={16} />}
                  {isIOSInstall ? 'How to add' : 'Install app'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Bluetooth and connectivity */}
        <div
          ref={(el) => { sectionRefs.current[2] = el; }}
          className={`p-6 rounded-2xl border transition-all duration-300 ${isLight ? 'bg-white border-zinc-200 shadow-[0_12px_32px_rgba(0,0,0,0.12)]' : 'bg-zinc-800/40 border-white/5 shadow-[0_0_20px_rgba(255,255,255,0.18)]'}`}
        >
          {renderSettingsCardHeader('Bluetooth and connectivity', <Icons.Printer size={22} />)}

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

            <div className={`rounded-xl border px-3 py-2.5 ${isLight ? 'bg-blue-50/80 border-blue-200/70' : 'bg-blue-500/10 border-blue-400/20'}`}>
              <span className={`app-subtext font-black ${isLight ? 'text-blue-900' : 'text-blue-200'}`}>
                Paper width: auto · {detectedPaperWidth}
              </span>
              <p className={`app-subtext mt-1 ${isLight ? 'text-black/55' : 'text-white/55'}`}>
                Detected from printer name when you connect (58mm standard, 25mm mini).
              </p>
            </div>

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
              <div className={`app-subtext text-[10px] opacity-45 p-4 rounded-xl text-center ${isLight ? 'text-black' : 'text-white'}`}>
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

      {showPasswordPanel && renderSettingsModal(
        <>
          <div className="flex items-center justify-between mb-3">
            <h4 className="settings-card-title text-base">Change password</h4>
            <button
              type="button"
              onClick={closePasswordPanel}
              aria-label="Close change password"
              className={`p-1.5 rounded-full ${isLight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
            >
              <Icons.X size={16} />
            </button>
          </div>
          <p className={`app-subtext text-[10px] mb-4 ${isLight ? 'text-black/50' : 'text-white/50'}`}>
            You can ask your admin if you&apos;ve forgotten your password.
          </p>
          <div className="space-y-2">
            <PasswordField
              isLight={isLight}
              value={currentPassword}
              onChange={setCurrentPassword}
              placeholder="Current password"
              autoComplete="current-password"
            />
            <PasswordField
              isLight={isLight}
              value={newPassword}
              onChange={setNewPassword}
              placeholder="New password"
              autoComplete="new-password"
            />
            <PasswordField
              isLight={isLight}
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Confirm new password"
              autoComplete="new-password"
            />
            {passwordError && (
              <p className="text-red-500 text-[11px] font-bold">{passwordError}</p>
            )}
            {passwordSuccess && (
              <p className="text-emerald-500 text-[11px] font-bold">Password updated.</p>
            )}
            <button
              type="button"
              onClick={() => void handleChangePasswordSubmit()}
              disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword}
              className={`w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center gap-2 ${
                isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'
              }`}
            >
              {isChangingPassword ? (
                <>
                  <span className="auth-spinner" aria-hidden="true" />
                  Updating…
                </>
              ) : (
                'Confirm changes'
              )}
            </button>
          </div>
        </>,
        closePasswordPanel,
        'Change password'
      )}

      {showSignOutConfirm && renderSettingsModal(
        <>
          <h4 className="settings-card-title text-base mb-3">Sign out</h4>
          <p className={`text-sm leading-relaxed mb-5 ${isLight ? 'text-black/75' : 'text-white/75'}`}>
            Are you sure you want to sign out? Don&apos;t worry — you won&apos;t lose any progress.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowSignOutConfirm(false)}
              className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all border ${
                isLight ? 'border-zinc-200 text-zinc-700' : 'border-white/15 text-white/80'
              }`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSignOutConfirm(false);
                handleClose();
                onLogout?.();
              }}
              className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all bg-red-500 text-white"
            >
              Sign out
            </button>
          </div>
        </>,
        () => setShowSignOutConfirm(false),
        'Sign out confirmation'
      )}
    </div>
  );
};

export default SettingsPanel;
