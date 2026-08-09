import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { Icons } from '../constants';
import {
  printerInstance,
  KnownPrinter,
  getPrinterSupport,
  normalizeBluetoothError,
  type PrinterScanPhase,
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
import {
  APP_VERSION,
  APK_INSTALL_URL,
  fetchLatestReleaseMeta,
  resolveInstallOffer,
  type AppInstallOffer,
} from '../utils/appVersion';
import BlurredBackground from './BlurredBackground';
import { AppLoadingInline, AppLoadingSpinner } from './AppLoading';
import { WALLPAPER_SLIDES } from '../utils/wallpapers';


interface SettingsSlice {
  themeMode: 'light' | 'dark' | 'system';
  disableCalculatorCard?: boolean;
  layoutMode?: 'portrait' | 'landscape';
  layoutModeAuto?: boolean;
  invoiceSwitcherMode?: 'horizontal' | 'list';
  expressionViewMode?: 'auto' | 'list';
  receiptLayoutMode?: 'summary' | 'full';
  visionHubDrawerMode?: 'click';

  standbyTimerSeconds?: number;
  hapticFeedback?: boolean;
  soundEffects?: boolean;
  profiles?: UserProfile[];
  activeProfileId?: string;
  businessName?: string;
  businessPhone?: string;
  businessAddress?: string;
  currency?: string;
  ghsCalculatorStyle?: 'ghs' | 'cedis';
  customWallpapers?: { image: string }[];
}

const cloneSettings = (s: SettingsSlice): SettingsSlice =>
  JSON.parse(JSON.stringify(s)) as SettingsSlice;

const settingsFingerprint = (s: SettingsSlice): string =>
  JSON.stringify({
    themeMode: s.themeMode,
    disableCalculatorCard: !!s.disableCalculatorCard,
    layoutMode: s.layoutMode ?? 'portrait',
    layoutModeAuto: s.layoutModeAuto !== false,
    invoiceSwitcherMode: s.invoiceSwitcherMode ?? 'horizontal',
    expressionViewMode: s.expressionViewMode ?? 'auto',
    receiptLayoutMode: s.receiptLayoutMode ?? 'summary',
    visionHubDrawerMode: 'click' as const,
    standbyTimerSeconds: s.standbyTimerSeconds ?? 0,
    hapticFeedback: s.hapticFeedback !== false,
    soundEffects: s.soundEffects !== false,
    profiles: s.profiles ?? [],
    activeProfileId: s.activeProfileId ?? '',
    businessName: s.businessName ?? '',
    businessPhone: s.businessPhone ?? '',
    businessAddress: s.businessAddress ?? '',
    currency: s.currency,
    ghsCalculatorStyle: s.ghsCalculatorStyle ?? 'ghs',
  });

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
  /** Autoswipe wallpaper slides; falls back to settings.customWallpapers / defaults. */
  wallpapers?: { image: string }[];
  accountUsername?: string;
  onChangePassword?: (current: string, newPassword: string) => Promise<{ error?: string; ok?: boolean }>;
  onLogout?: () => void;
  onVerifyAdminPassword?: (password: string) => Promise<{ error?: string; ok?: boolean }>;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ 
  isOpen, 
  onClose,
  focusSectionIndex = 0,
  settings,
  updateSettings: _updateSettings,
  onApplyAppearance,
  isLight: isLightProp,
  wallpapers: wallpapersProp,
  cartItems = [],
  runningTotal = 0,
  invoiceName = 'Walk-in Customer',
  currency = '¢',
  onInvoicePrinted,
  accountUsername,
  onChangePassword,
  onLogout,
  onVerifyAdminPassword,
}) => {
  // Draft settings — edits stay local until Save
  const [draft, setDraft] = useState<SettingsSlice>(() => cloneSettings(settings));
  const baselineRef = useRef<SettingsSlice>(cloneSettings(settings));
  /** State so Save/Discard hide immediately (ref-only baseline never re-renders). */
  const [baselineFp, setBaselineFp] = useState(() => settingsFingerprint(settings));
  const [isSaving, setIsSaving] = useState(false);
  const [businessSyncError, setBusinessSyncError] = useState<string | null>(null);

  const isDirty = useMemo(
    () => settingsFingerprint(draft) !== baselineFp,
    [draft, baselineFp]
  );

  // Preview theme from draft when not "system"
  const isLight =
    draft.themeMode === 'system'
      ? (isLightProp ?? false)
      : draft.themeMode === 'light';

  const wallpaperSlides = useMemo(() => {
    if (wallpapersProp?.length) return wallpapersProp;
    if (settings.customWallpapers?.length) return settings.customWallpapers;
    return WALLPAPER_SLIDES;
  }, [wallpapersProp, settings.customWallpapers]);

  // Bluetooth states
  const [printerName, setPrinterName] = useState<string | null>(null);
  const [, setConnectedId] = useState<string | null>(null);
  const [knownPrinters, setKnownPrinters] = useState<KnownPrinter[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanPhase, setScanPhase] = useState<PrinterScanPhase | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [printSuccess, setPrintSuccess] = useState(false);
  const [bluetoothSupport, setBluetoothSupport] = useState(getPrinterSupport);
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
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const wasOpenRef = useRef(false);
  const [installOffer, setInstallOffer] = useState<AppInstallOffer>(() =>
    resolveInstallOffer(Capacitor.isNativePlatform(), null)
  );
  const [installCheckLoading, setInstallCheckLoading] = useState(false);

  // Snapshot committed settings into draft when panel opens
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      const snap = cloneSettings(settings);
      baselineRef.current = snap;
      setBaselineFp(settingsFingerprint(snap));
      setDraft(snap);
      setBusinessSyncError(null);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, settings]);

  // Install / Update: live release meta (site + GitHub) so download always points at newest push
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setInstallCheckLoading(true);
    void fetchLatestReleaseMeta()
      .then((meta) => {
        if (cancelled) return;
        setInstallOffer(
          resolveInstallOffer(Capacitor.isNativePlatform(), meta?.version ?? null, meta)
        );
      })
      .finally(() => {
        if (!cancelled) setInstallCheckLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const section = sectionRefs.current[focusSectionIndex];
    if (!section) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusSectionIndex, isOpen]);

  const patchDraft = useCallback((patch: Partial<SettingsSlice>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setBusinessSyncError(null);
  }, []);

  const handleDiscard = useCallback(() => {
    // Hide Save/Discard immediately by aligning draft to baseline
    const snap = cloneSettings(baselineRef.current);
    setDraft(snap);
    setBaselineFp(settingsFingerprint(snap));
    setBusinessSyncError(null);
  }, []);

  const handleSave = useCallback(async () => {
    // Hide Save/Discard immediately on click (optimistic clean state)
    const savedSnap = cloneSettings(draft);
    const prevBaseline = baselineRef.current;
    baselineRef.current = savedSnap;
    setBaselineFp(settingsFingerprint(savedSnap));
    setBusinessSyncError(null);
    setIsSaving(true);
    const startedAt = Date.now();

    try {
      _updateSettings(savedSnap);

      const businessChanged =
        (savedSnap.businessName ?? '') !== (prevBaseline.businessName ?? '') ||
        (savedSnap.businessPhone ?? '') !== (prevBaseline.businessPhone ?? '') ||
        (savedSnap.businessAddress ?? '') !== (prevBaseline.businessAddress ?? '');

      if (businessChanged) {
        const result = await updateUserBusinessInfo({
          businessName: savedSnap.businessName ?? '',
          businessPhone: savedSnap.businessPhone ?? '',
          businessAddress: savedSnap.businessAddress ?? '',
        });
        if (result.ok === false) {
          setBusinessSyncError(result.error);
          // Re-surface dirty so user can fix / retry Save
          baselineRef.current = prevBaseline;
          setBaselineFp(settingsFingerprint(prevBaseline));
          return;
        }
      }

      onApplyAppearance?.();
    } finally {
      // Keep "Saving…" visible at least 0.3s (loading window: 0.3s–1s)
      const SAVE_LOADING_MIN_MS = 300;
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, SAVE_LOADING_MIN_MS - elapsed);
      if (remaining > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
      }
      setIsSaving(false);
    }
  }, [draft, _updateSettings, onApplyAppearance]);

  const handleClose = useCallback(() => {
    // Closing discards unsaved edits
    if (isDirty) {
      const snap = cloneSettings(baselineRef.current);
      setDraft(snap);
      setBaselineFp(settingsFingerprint(snap));
    }
    const panel = panelRef.current;
    const active = document.activeElement as HTMLElement | null;
    if (panel?.contains(active)) {
      active.blur();
    }
    onClose();
  }, [onClose, isDirty]);

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
    setBluetoothSupport(getPrinterSupport());
    void refreshPrinterState();

    const bt = navigator.bluetooth;
    const onAvailability = () => setBluetoothSupport(getPrinterSupport());
    bt?.addEventListener?.('availabilitychanged', onAvailability);
    return () => bt?.removeEventListener?.('availabilitychanged', onAvailability);
  }, [isOpen, refreshPrinterState]);

  const scanPhaseLabel = (phase: PrinterScanPhase | null): string => {
    if (!phase || phase === 'done') return 'Connecting…';
    if (phase === 'usb') return 'Searching USB…';
    if (phase === 'classic') return 'Searching paired Bluetooth…';
    if (phase === 'bluetooth') return 'Searching Bluetooth…';
    if (phase === 'wifi') return 'Searching Wi‑Fi…';
    return 'Searching…';
  };

  const handleScanAndConnect = async () => {
    setIsScanning(true);
    setScanPhase('usb');
    setConnectingId(null);
    setErrorMessage(null);
    setPrintSuccess(false);
    try {
      const connectedName = await printerInstance.scanAndConnect((phase) => setScanPhase(phase));
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
      setScanPhase(null);
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

  const profiles = draft.profiles ?? [];
  const activeProfile =
    profiles.find((p) => p.id === draft.activeProfileId) ?? profiles[0] ?? null;
  const canEditBusinessInfo = isAdminProfile(activeProfile);

  const handleSelectProfile = (profileId: string) => {
    patchDraft({ activeProfileId: profileId });
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
    patchDraft({
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
      }, 800); // loading/success hold within 0.4s–2s
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleUpdateProfileAvatar = (profileId: string, avatarUrl: string) => {
    patchDraft({
      profiles: profiles.map((p) => (p.id === profileId ? { ...p, avatarUrl } : p)),
    });
  };

  const handleBusinessFieldChange = useCallback(
    (patch: Partial<Pick<SettingsSlice, 'businessName' | 'businessPhone' | 'businessAddress'>>) => {
      patchDraft(patch);
    },
    [patchDraft]
  );

  const closePasswordPanel = useCallback(() => {
    setShowPasswordPanel(false);
    setPasswordError(null);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }, []);

  const renderSettingsModal = (children: React.ReactNode, onClose: () => void, label: string) => (
    <div className="settings-modal-overlay absolute inset-0 z-[20] flex items-center justify-center p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/45 morph-scrim morph-scrim--in"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`settings-modal-card relative w-full max-w-sm rounded-2xl border p-5 shadow-2xl fluid-pop-in ${
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
      <h3 className="settings-card-title">{title}</h3>
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
          <h4 className="settings-card-title">Security</h4>
        </div>
        <p className={`settings-security__account app-subtext text-[11px] mb-4 ${isLight ? 'text-black/50' : 'text-white/50'}`}>
          Signed in as <span className="font-bold">{accountUsername}</span>
        </p>
        <div className="settings-security__actions flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => setShowPasswordPanel(true)}
            className={`settings-security__btn w-full py-3.5 px-4 rounded-xl text-sm font-black tracking-tight transition-all ${
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
            className={`settings-security__btn settings-security__btn--signout w-full py-3 px-4 rounded-xl text-sm font-bold transition-all border ${
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

      const printProfile =
        profiles.find((p) => p.id === draft.activeProfileId) ?? profiles[0] ?? null;
      const ok = await printerInstance.printInvoice(
        titleToPrint,
        itemsToPrint,
        totalToPrint,
        currency,
        printProfile?.name,
        draft.receiptLayoutMode ?? 'summary'
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
        fixed inset-0 z-[500] flex flex-col morph-panel
        ${isOpen ? 'morph-panel--in pointer-events-auto' : 'morph-panel--out pointer-events-none'}
        settings-panel ${isLight ? 'settings-panel--light text-black' : 'settings-panel--dark text-white'}
      `}
      role="dialog"
      aria-modal={isOpen}
      aria-labelledby="settings-title"
    >
      {/* Blurred autoswipe wallpaper sits under the glass cards (works over calc + POS chrome). */}
      <BlurredBackground
        contained
        isLight={isLight}
        wallpapers={wallpaperSlides}
        isUnlocked
      />

      <div
        className="settings-panel-header relative z-10 shrink-0 flex items-center justify-between gap-3"
        style={{
          paddingTop: 'max(1.25rem, env(safe-area-inset-top))',
          paddingLeft: 'max(1.25rem, env(safe-area-inset-left))',
          paddingRight: 'max(1.25rem, env(safe-area-inset-right))',
          paddingBottom: '0.75rem',
        }}
      >
        <h2 id="settings-title" className="settings-panel-title text-2xl font-black tracking-tight drop-shadow-sm min-w-0">
          Settings
        </h2>
        <div
          className={`settings-header-actions shrink-0 ${
            isDirty || isSaving ? 'settings-header-actions--dirty' : ''
          }`}
        >
          {/* Close ↔ Save/Discard morph cluster */}
          <div
            className={`settings-header-actions__cluster ${
              isDirty || isSaving
                ? 'settings-header-actions__cluster--dirty'
                : 'settings-header-actions__cluster--clean'
            }`}
            aria-live="polite"
          >
            <div className="settings-header-actions__dirty" aria-hidden={!(isDirty || isSaving)}>
              <button
                type="button"
                onClick={handleDiscard}
                disabled={isSaving || !(isDirty || isSaving)}
                tabIndex={isDirty || isSaving ? 0 : -1}
                className="settings-panel-action settings-panel-action--discard"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving || !(isDirty || isSaving)}
                tabIndex={isDirty || isSaving ? 0 : -1}
                className="settings-panel-action settings-panel-action--save"
                aria-busy={isSaving}
              >
                {isSaving ? (
                  <span className="inline-flex items-center gap-1.5">
                    <AppLoadingSpinner size="sm" label="Saving" />
                    Saving…
                  </span>
                ) : (
                  'Save'
                )}
              </button>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={handleClose}
              aria-label="Close settings panel"
              tabIndex={isDirty || isSaving ? -1 : 0}
              disabled={isDirty || isSaving}
              className="settings-panel-close p-2.5 rounded-full"
            >
              <Icons.X size={24} />
            </button>
          </div>
        </div>
      </div>
      
      <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto px-5 pb-8 space-y-5 custom-scrollbar">

        {/* Profile */}
        <div
          ref={(el) => { sectionRefs.current[0] = el; }}
          className="settings-card overflow-hidden shadow-2xl"
        >
          {(accountUsername || draft.businessName?.trim()) && (
            <BusinessInfoReceiptCard
              variant="settings"
              badgeLabel="Business"
              businessName={draft.businessName?.trim() || ''}
              businessPhone={draft.businessPhone}
              businessAddress={draft.businessAddress}
              className="w-full"
              editable={canEditBusinessInfo}
              isLight={isLight}
              onBusinessNameChange={(value) => handleBusinessFieldChange({ businessName: value })}
              onBusinessPhoneChange={(value) => handleBusinessFieldChange({ businessPhone: value })}
              onBusinessAddressChange={(value) => handleBusinessFieldChange({ businessAddress: value })}
            />
          )}
          {businessSyncError && (
            <p className="px-4 py-2 text-red-500 text-[11px] font-bold">{businessSyncError}</p>
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
          activeProfileId={draft.activeProfileId ?? activeProfile?.id ?? ''}
          onSelectProfile={handleSelectProfile}
          onAddProfile={handleAddProfile}
          onUpdateProfileAvatar={handleUpdateProfileAvatar}
          onVerifyAdminPassword={onVerifyAdminPassword}
        />

        {/* Appearance Settings */}
        <div
          ref={(el) => { sectionRefs.current[1] = el; }}
          className="settings-card p-6 shadow-2xl"
        >
          {renderSettingsCardHeader('Appearance', isLight ? <Icons.Sun size={22} /> : <Icons.Moon size={22} />)}

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-black">Theme</span>
              <FluidSegmentControl
                isLight={isLight}
                ariaLabel="Theme mode"
                value={draft.themeMode}
                onChange={(themeMode) => patchDraft({ themeMode })}
                options={[
                  { id: 'light', label: 'Light', icon: <Icons.Sun size={14} /> },
                  { id: 'dark', label: 'Dark', icon: <Icons.Moon size={14} /> },
                  { id: 'system', label: 'Auto' },
                ]}
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-black">Haptics</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  Vibration on presses and unlock
                </span>
              </div>
              <FluidToggle
                isLight={isLight}
                ariaLabel="Haptic feedback"
                checked={draft.hapticFeedback !== false}
                onChange={(hapticFeedback) => patchDraft({ hapticFeedback })}
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-black">Sounds</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  Click and swipe audio cues
                </span>
              </div>
              <FluidToggle
                isLight={isLight}
                ariaLabel="Sound effects"
                checked={draft.soundEffects !== false}
                onChange={(soundEffects) => patchDraft({ soundEffects })}
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-black">Layout</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  {draft.layoutModeAuto !== false ? 'Auto from device orientation' : 'Manual layout override'}
                </span>
              </div>
              <FluidSegmentControl
                isLight={isLight}
                ariaLabel="Layout orientation"
                value={draft.layoutMode ?? 'portrait'}
                onChange={(layoutMode) => patchDraft({ layoutMode, layoutModeAuto: false })}
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
                value={draft.invoiceSwitcherMode === 'list' ? 'list' : 'horizontal'}
                onChange={(invoiceSwitcherMode) => patchDraft({ invoiceSwitcherMode })}
                options={[
                  { id: 'horizontal', label: 'Horizontal', icon: <Icons.Carousel size={14} /> },
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
                value={draft.expressionViewMode ?? 'auto'}
                onChange={(expressionViewMode) => patchDraft({ expressionViewMode })}
                options={EXPRESSION_VIEW_OPTIONS.map(({ id, label }) => ({ id, label }))}
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
                value={draft.receiptLayoutMode ?? 'summary'}
                onChange={(receiptLayoutMode) => patchDraft({ receiptLayoutMode })}
                options={RECEIPT_LAYOUT_OPTIONS.map(({ id, label }) => ({ id, label }))}
              />
            </div>

            {(draft.currency ?? currency ?? 'GHS') === 'GHS' && (
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
                  value={draft.ghsCalculatorStyle ?? 'ghs'}
                  onChange={(ghsCalculatorStyle) => patchDraft({ ghsCalculatorStyle })}
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
                value={String(draft.standbyTimerSeconds ?? 0)}
                onChange={(id) => patchDraft({ standbyTimerSeconds: Number(id) })}
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
                checked={!!draft.disableCalculatorCard}
                onChange={(disableCalculatorCard) => patchDraft({ disableCalculatorCard })}
                ariaLabel="Calculator on background"
                offLabel="Card"
                onLabel="Background"
              />
            </div>

          </div>
        </div>

        {/* Bluetooth and connectivity */}
        <div
          ref={(el) => { sectionRefs.current[2] = el; }}
          className="settings-card p-6 shadow-2xl"
        >
          {renderSettingsCardHeader('Printers and connectivity', <Icons.Printer size={22} />)}

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
                Auto sequence · paper {detectedPaperWidth}
              </span>
              <p className={`app-subtext mt-1 ${isLight ? 'text-black/55' : 'text-white/55'}`}>
                USB → paired Bluetooth → BLE → Wi‑Fi. Connects to the first printer found, then stops.
                Paper width is auto-detected when possible.
              </p>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className={`app-subtext text-[10px] font-black ${isLight ? 'text-black' : 'text-white'}`}>
                {knownPrinters.length} device{knownPrinters.length !== 1 ? 's' : ''} known
              </span>
              <button
                type="button"
                onClick={() => void refreshPrinterState()}
                className={`text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg ${
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
                  className="py-1.5 px-3 rounded-lg bg-red-500/10 text-red-500 text-xs font-black uppercase hover:bg-red-500/20 transition-all shrink-0"
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
                        className="py-1.5 px-3 rounded-lg bg-blue-500 text-white text-xs font-black uppercase disabled:opacity-50 transition-all shrink-0"
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
                        className="py-1.5 px-3 rounded-lg bg-blue-500 text-white text-xs font-black uppercase disabled:opacity-50 transition-all shrink-0"
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
              className="w-full py-3.5 rounded-xl bg-blue-500 text-white text-xs font-black uppercase tracking-widest hover:bg-blue-600 disabled:opacity-50 transition-all shadow-md"
            >
              {isScanning ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <AppLoadingSpinner size="sm" label="Searching" />
                  {scanPhaseLabel(scanPhase)}
                </span>
              ) : knownPrinters.length > 0 ? (
                'Scan for printer (USB → BT → Wi‑Fi)'
              ) : (
                'Scan & Connect (USB → BT → Wi‑Fi)'
              )}
            </button>

            {/* Test Invoice / Print Action */}
            {printerName && (
              <button
                onClick={handlePrintReceipt}
                className={`w-full py-3 rounded-xl border text-xs font-black uppercase tracking-widest transition-all ${
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

        {/* Install (web) / Update status (installed app) */}
        <div className="settings-card p-6 shadow-2xl">
          {Capacitor.isNativePlatform() ? (
            <>
              {renderSettingsCardHeader(
                installOffer.kind === 'update' ? 'Update app' : 'App status',
                <Icons.Download size={22} />
              )}
              {installCheckLoading ? (
                <div className="py-3">
                  <AppLoadingInline label="Checking for updates" isLight={isLight} size="md" />
                </div>
              ) : installOffer.kind === 'update' ? (
                <>
                  <p className="update-available-neon mb-2" aria-live="polite">
                    Update available
                  </p>
                  <p className={`app-subtext text-[10px] mb-4 opacity-55 ${isLight ? 'text-black' : 'text-white'}`}>
                    You have v{installOffer.current} · latest is v{installOffer.version}
                    {installOffer.build ? ` (build ${installOffer.build})` : ''}
                  </p>
                  <a
                    href={installOffer.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-3.5 px-4 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all bg-blue-500 text-white shadow-[0_0_24px_rgba(59,130,246,0.45)]"
                  >
                    <Icons.Download size={16} />
                    Update {installOffer.version}
                  </a>
                  <p className={`app-subtext text-[10px] mt-3 opacity-50 ${isLight ? 'text-black' : 'text-white'}`}>
                    Don&apos;t worry, updating will do in background, while you still work.
                  </p>
                </>
              ) : (
                <>
                  <p
                    className={`no-update-available mb-1 ${isLight ? 'text-black' : 'text-white'}`}
                    aria-live="polite"
                  >
                    No update available
                  </p>
                  <p className={`app-subtext text-[10px] opacity-50 ${isLight ? 'text-black' : 'text-white'}`}>
                    You&apos;re on the latest install · v{APP_VERSION}
                  </p>
                </>
              )}
            </>
          ) : (
            <>
              {renderSettingsCardHeader(
                installOffer.kind === 'update' ? 'Update app' : 'Get app on phone',
                <Icons.Download size={22} />
              )}
              <p className={`app-subtext text-[10px] mb-1 ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                {installOffer.kind === 'update'
                  ? `New version available — update to ${installOffer.version}`
                  : 'Click to install app for free'}
              </p>
              <p className={`app-subtext text-[10px] mb-4 opacity-50 ${isLight ? 'text-black' : 'text-white'}`}>
                {installCheckLoading ? (
                  <AppLoadingInline label="Checking for updates" isLight={isLight} />
                ) : installOffer.kind === 'update' ? (
                  `You have ${installOffer.current} · latest is ${installOffer.version}${
                    installOffer.build ? ` (build ${installOffer.build})` : ''
                  }`
                ) : (
                  `Version ${installOffer.version}${
                    installOffer.build ? ` · build ${installOffer.build}` : ''
                  }`
                )}
              </p>
              <a
                href={installOffer.kind === 'current' ? APK_INSTALL_URL : installOffer.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`w-full py-3.5 px-4 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
                  isLight ? 'bg-blue-500 text-white' : 'bg-blue-500/90 text-white'
                }`}
              >
                <Icons.Download size={16} />
                {installOffer.kind === 'update'
                  ? `Update ${installOffer.version}`
                  : `Install ${installOffer.version}`}
              </a>
              {installOffer.kind === 'update' && (
                <p className={`app-subtext text-[10px] mt-3 opacity-50 ${isLight ? 'text-black' : 'text-white'}`}>
                  Don&apos;t worry, updating will do in background, while you still work.
                </p>
              )}
            </>
          )}
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
              className={`w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40 flex items-center justify-center gap-2 ${
                isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'
              }`}
            >
              {isChangingPassword ? (
                <>
                  <AppLoadingSpinner size="sm" label="Updating password" />
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
              className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${
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
              className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all bg-red-500 text-white"
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
