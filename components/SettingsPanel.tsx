import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
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
import { CartLineItem, NewProfileInput, UserProfile } from '../types';
import ProfileAvatar from './ProfileAvatar';
import ProfilePickerModal from './ProfilePickerModal';
import AdminProfilesPopup from './AdminProfilesPopup';
import { STANDBY_TIMER_OPTIONS } from '../hooks/useStandby';
import { ADMIN_PROFILE_NAME, ensureAdminProfile, isAdminProfile } from '../utils/auth';
import { EXPRESSION_VIEW_OPTIONS } from '../utils/expressionDisplay';
import { RECEIPT_LAYOUT_OPTIONS } from '../utils/receiptLayout';
import FluidSegmentControl from './FluidSegmentControl';
import FluidToggle from './FluidToggle';
import BusinessInfoReceiptCard from './BusinessInfoReceiptCard';
import PasswordField from './PasswordField';
import { formInputClass } from '../utils/formFields';
import { updateUserBusinessInfo } from '../utils/accessControl';
import { MorphPresence } from './MorphCrossfade';
import SettingsNotificationsInbox from './SettingsNotificationsInbox';
import type { AccountNotification } from '../types/accountNotifications';
import { pickPhotoFromGallery } from '../utils/nativeCamera';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { heartbeatProfilePresence, touchProfilePresence } from '../utils/profilePresence';


interface SettingsSlice {
  themeMode: 'light' | 'dark' | 'system';
  disableCalculatorCard?: boolean;
  calculatorSkin?: 'classic' | 'white' | 'black';
  layoutMode?: 'portrait' | 'landscape';
  layoutModeAuto?: boolean;
  invoiceSwitcherMode?: 'horizontal' | 'list';
  expressionViewMode?: 'auto' | 'list';
  receiptLayoutMode?: 'summary' | 'full';
  visionHubDrawerMode?: 'drag' | 'click';
  notificationStyle?: 'modal' | 'pill';

  standbyTimerSeconds?: number;
  profiles?: UserProfile[];
  activeProfileId?: string;
  businessName?: string;
  businessPhone?: string;
  businessAddress?: string;
  currency?: string;
  ghsCalculatorStyle?: 'ghs' | 'cedis';
  accountPlan?: 'premium' | 'regular';
}

const cloneSettings = (s: SettingsSlice): SettingsSlice =>
  JSON.parse(JSON.stringify(s)) as SettingsSlice;

const settingsFingerprint = (s: SettingsSlice): string =>
  JSON.stringify({
    themeMode: s.themeMode,
    disableCalculatorCard: !!s.disableCalculatorCard,
    calculatorSkin: s.calculatorSkin ?? 'classic',
    layoutMode: s.layoutMode ?? 'portrait',
    layoutModeAuto: s.layoutModeAuto !== false,
    invoiceSwitcherMode: s.invoiceSwitcherMode ?? 'horizontal',
    expressionViewMode: s.expressionViewMode ?? 'auto',
    receiptLayoutMode: s.receiptLayoutMode ?? 'summary',
    visionHubDrawerMode: s.visionHubDrawerMode ?? 'click',
    notificationStyle: s.notificationStyle ?? 'pill',
    standbyTimerSeconds: s.standbyTimerSeconds ?? 0,
    profiles: s.profiles ?? [],
    activeProfileId: s.activeProfileId ?? '',
    businessName: s.businessName ?? '',
    businessPhone: s.businessPhone ?? '',
    businessAddress: s.businessAddress ?? '',
    currency: s.currency,
    ghsCalculatorStyle: s.ghsCalculatorStyle ?? 'ghs',
    accountPlan: s.accountPlan ?? 'regular',
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
  accountUsername?: string;
  onChangePassword?: (current: string, newPassword: string) => Promise<{ error?: string; ok?: boolean }>;
  onLogout?: () => void;
  onVerifyAdminPassword?: (password: string) => Promise<{ error?: string; ok?: boolean }>;
  notifications?: AccountNotification[];
  notificationsUnreadCount?: number;
  onMarkNotificationsRead?: (ids: string[]) => void;
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
  notifications = [],
  notificationsUnreadCount = 0,
  onMarkNotificationsRead,
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

  // Printer connectivity states
  const [printerName, setPrinterName] = useState<string | null>(null);
  const [, setConnectedId] = useState<string | null>(null);
  const [knownPrinters, setKnownPrinters] = useState<KnownPrinter[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [printSuccess, setPrintSuccess] = useState(false);
  const [bluetoothSupport, setBluetoothSupport] = useState(getBluetoothSupport);
  const [usbSupport, setUsbSupport] = useState(getUsbSupport);
  const [networkSupport, setNetworkSupport] = useState(getNetworkPrinterSupport);
  const [printFormatSummary, setPrintFormatSummary] = useState<string | null>(null);
  const [wifiHost, setWifiHost] = useState('');
  const [wifiPort, setWifiPort] = useState('9100');
  const [wifiName, setWifiName] = useState('');
  const [showWifiForm, setShowWifiForm] = useState(false);
  const [detectedPaperWidth, setDetectedPaperWidth] = useState(() => printerInstance.paperWidth);
  const [isProfilePickerOpen, setIsProfilePickerOpen] = useState(false);
  const [showAdminProfiles, setShowAdminProfiles] = useState(false);
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
  const [showNotificationsInbox, setShowNotificationsInbox] = useState(false);
  const wasOpenRef = useRef(false);
  const appUpdate = useAppUpdate(isOpen);

  // Snapshot committed settings into draft when panel opens
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      const snap = cloneSettings(settings);
      baselineRef.current = snap;
      setBaselineFp(settingsFingerprint(snap));
      setDraft(snap);
      setBusinessSyncError(null);
      if (snap.activeProfileId) touchProfilePresence(snap.activeProfileId);
    }
    if (!isOpen) setShowAdminProfiles(false);
    wasOpenRef.current = isOpen;
  }, [isOpen, settings]);

  // Keep active profile last-seen fresh while Settings stays open
  useEffect(() => {
    if (!isOpen) return;
    const id = draft.activeProfileId || settings.activeProfileId || '';
    if (!id) return;
    heartbeatProfilePresence(id);
    const tick = window.setInterval(() => heartbeatProfilePresence(id), 30_000);
    return () => window.clearInterval(tick);
  }, [isOpen, draft.activeProfileId, settings.activeProfileId]);



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
      setPrintFormatSummary(printerInstance.getActivePrintFormat().summary);
    } else {
      setPrinterName(null);
      setConnectedId(null);
      setPrintFormatSummary(null);
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
    setUsbSupport(getUsbSupport());
    setNetworkSupport(getNetworkPrinterSupport());
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
      setPrintFormatSummary(printerInstance.getActivePrintFormat().summary);
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

  const handleUsbConnect = async () => {
    setIsScanning(true);
    setConnectingId(null);
    setErrorMessage(null);
    setPrintSuccess(false);
    try {
      const connectedName = await printerInstance.scanAndConnectUsb();
      setPrinterName(connectedName);
      setConnectedId(printerInstance.getConnectedDeviceId());
      setPrintFormatSummary(printerInstance.getActivePrintFormat().summary);
      await refreshPrinterState();
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
    setPrintSuccess(false);
    try {
      const port = parseInt(wifiPort, 10) || 9100;
      const connectedName = await printerInstance.connectNetworkPrinter({
        host: wifiHost,
        port,
        name: wifiName || undefined,
      });
      setPrinterName(connectedName);
      setConnectedId(printerInstance.getConnectedDeviceId());
      setPrintFormatSummary(printerInstance.getActivePrintFormat().summary);
      setShowWifiForm(false);
      await refreshPrinterState();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'WiFi printer connection failed.');
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
      setPrintFormatSummary(printerInstance.getActivePrintFormat().summary);
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
    setPrintFormatSummary(null);
    setPrintSuccess(false);
    void refreshPrinterState();
  };

  const printerCaps = getPrinterCapabilities();
  const transportLabel = (t?: string) =>
    t === 'usb' ? 'USB' : t === 'network' ? 'WiFi' : 'Bluetooth';

  const profiles = draft.profiles ?? [];
  const activeProfile =
    profiles.find((p) => p.id === draft.activeProfileId) ?? profiles[0] ?? null;
  const canEditBusinessInfo = isAdminProfile(activeProfile);

  const handleSelectProfile = (profileId: string) => {
    touchProfilePresence(profileId);
    patchDraft({ activeProfileId: profileId });
    // Profile switch applies immediately so active icons stay in sync across the app.
    _updateSettings({ activeProfileId: profileId });
  };

  const handleAddProfile = async ({ name, avatarUrl, email, phone, sellerType }: NewProfileInput) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.toLowerCase() === ADMIN_PROFILE_NAME.toLowerCase()) return;
    const profile: UserProfile = {
      id: crypto.randomUUID(),
      name: trimmed,
      avatarUrl,
      email: email.trim(),
      phone: phone.trim(),
      sellerType,
    };
    if (avatarUrl && (/^data:image\//i.test(avatarUrl) || /^blob:/i.test(avatarUrl))) {
      const saved = await import('../utils/accountMedia').then(({ persistProfileAvatar }) =>
        persistProfileAvatar({ profileId: profile.id, image: avatarUrl })
      );
      if (saved.ok) profile.avatarUrl = saved.imageRef;
    }
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
      }, 1200);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleUpdateProfileAvatar = (profileId: string, avatarUrl: string) => {
    patchDraft({
      profiles: profiles.map((p) => (p.id === profileId ? { ...p, avatarUrl } : p)),
    });
    void import('../utils/accountMedia').then(({ persistProfileAvatar }) => {
      void persistProfileAvatar({ profileId, image: avatarUrl }).then((saved) => {
        if (saved.ok === false) return;
        patchDraft({
          profiles: (draft.profiles ?? profiles).map((p) =>
            p.id === profileId ? { ...p, avatarUrl: saved.imageRef } : p
          ),
        });
      });
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
            className={`settings-security__btn w-full py-3.5 px-4 rounded-xl text-sm font-black active:scale-[0.98] transition-all ${
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
            Sign out
          </button>
        </div>
      </div>
    );
  };

  const handlePickActiveAvatar = async () => {
    if (!activeProfile) return;
    if (Capacitor.isNativePlatform()) {
      const result = await pickPhotoFromGallery();
      if (result.success && result.imageData) {
        handleUpdateProfileAvatar(activeProfile.id, result.imageData);
        return;
      }
      if (result.error) alert(result.error);
      return;
    }
    avatarFileInputRef.current?.click();
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
        fixed inset-0 z-[60] flex flex-col morph-panel
        ${isOpen ? 'morph-panel--in pointer-events-auto' : 'morph-panel--out pointer-events-none'}
        settings-panel ${isLight ? 'settings-panel--light text-black' : 'settings-panel--dark text-white'}
      `}
      role="dialog"
      aria-modal={isOpen}
      aria-labelledby="settings-title"
    >
      {/* Solid scrim so settings don't show underlying app background */}
      <div aria-hidden className={`settings-panel-scrim`} />

      <div
        className="settings-panel-header shrink-0 flex items-center justify-between gap-3"
        style={{
          paddingTop: 'max(1.25rem, env(safe-area-inset-top))',
          paddingLeft: 'max(1.25rem, env(safe-area-inset-left))',
          paddingRight: 'max(1.25rem, env(safe-area-inset-right))',
          paddingBottom: '0.75rem',
        }}
      >
        <h2 id="settings-title" className="settings-panel-title text-2xl font-black drop-shadow-sm min-w-0">
          Settings
        </h2>
        <div className="flex items-center gap-2 shrink-0">
          <MorphPresence show={isDirty}>
            {(visible) => (
              <div
                className={`settings-panel-actions morph-panel flex items-center gap-2 ${
                  visible ? 'morph-panel--in' : 'morph-panel--out'
                }`}
              >
                <button
                  type="button"
                  onClick={handleDiscard}
                  disabled={isSaving}
                  className="settings-panel-action settings-panel-action--discard"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  className="settings-panel-action settings-panel-action--save"
                >
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </MorphPresence>
          <button 
            ref={closeRef}
            onClick={handleClose} 
            aria-label="Close settings panel"
            className="settings-panel-close p-2.5 rounded-full transition-all active:scale-90"
          >
            <Icons.X size={24} />
          </button>
        </div>
      </div>
      
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-8 space-y-5 custom-scrollbar">

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
          <div className="relative flex flex-col items-center gap-3 p-8 pt-6">
            <div className="absolute top-4 right-4 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowAdminProfiles(true)}
                className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-all ${
                  isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/10 text-white'
                }`}
                aria-label="Profiles — tap to switch, hold for details"
                title="Profiles"
              >
                <Icons.Users size={20} />
              </button>
              <button
                type="button"
                onClick={() => setShowNotificationsInbox(true)}
                className={`relative shrink-0 w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-all ${
                  isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/10 text-white'
                } ${notificationsUnreadCount > 0 ? 'settings-noti-bell--unread' : ''}`}
                aria-label={`Notifications${notificationsUnreadCount > 0 ? `, ${notificationsUnreadCount} unread` : ''}`}
              >
                <Icons.Bell size={20} />
                {notificationsUnreadCount > 0 && (
                  <span className="noti-bell-indicator" aria-hidden="true" title="Unread notifications">
                    <span className="noti-bell-indicator__dot" />
                  </span>
                )}
              </button>
            </div>
            <ProfileAvatar
              profile={activeProfile}
              size={80}
              isLight={isLight}
              onClick={() => void handlePickActiveAvatar()}
              ariaLabel="Change profile photo from gallery"
            />
            <button
              type="button"
              onClick={() => setIsProfilePickerOpen(true)}
              className="text-xl font-black lowercase active:opacity-60 transition-opacity"
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
          canCreateMiniProfiles={
            (draft.accountPlan ?? settings.accountPlan ?? 'regular') === 'premium' ||
            isAdminProfile(activeProfile)
          }
        />

        <AdminProfilesPopup
          isOpen={showAdminProfiles && isOpen}
          onClose={() => setShowAdminProfiles(false)}
          isLight={isLight}
          profiles={profiles}
          activeProfileId={draft.activeProfileId ?? activeProfile?.id ?? ''}
          onSelectProfile={handleSelectProfile}
        />

        <SettingsNotificationsInbox
          isOpen={showNotificationsInbox && isOpen}
          onClose={() => setShowNotificationsInbox(false)}
          isLight={isLight}
          notifications={notifications}
          activeProfileId={draft.activeProfileId ?? activeProfile?.id ?? ''}
          isAdmin={isAdminProfile(activeProfile)}
          onMarkRead={onMarkNotificationsRead}
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
                value={
                  draft.invoiceSwitcherMode === 'list' ? 'list' : 'horizontal'
                }
                onChange={(invoiceSwitcherMode) =>
                  patchDraft({
                    invoiceSwitcherMode: invoiceSwitcherMode as 'horizontal' | 'list',
                  })
                }
                options={[
                  { id: 'horizontal', label: 'App switcher', icon: <Icons.Carousel size={14} /> },
                  { id: 'list', label: 'List', icon: <Icons.List size={14} /> },
                ]}
              />
            </div>

            {/* Expression view */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-black">Expression view</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  Auto wraps · List after each +
                </span>
              </div>
              <FluidSegmentControl
                isLight={isLight}
                size="sm"
                ariaLabel="Expression view mode"
                value={draft.expressionViewMode ?? 'auto'}
                onChange={(expressionViewMode) => patchDraft({ expressionViewMode })}
                options={EXPRESSION_VIEW_OPTIONS.map(({ id, label }) => ({ id, label }))}
              />
            </div>

            {/* Share & print receipt */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-black">Invoice print style</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  Share image and receipt layout
                </span>
              </div>
              <FluidSegmentControl
                isLight={isLight}
                size="sm"
                ariaLabel="Invoice print style"
                value={draft.receiptLayoutMode ?? 'summary'}
                onChange={(receiptLayoutMode) => patchDraft({ receiptLayoutMode })}
                options={RECEIPT_LAYOUT_OPTIONS.map(({ id, label }) => ({ id, label }))}
              />
            </div>

            {(draft.currency ?? currency ?? 'GHS') === 'GHS' && (
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-black">Calculator currency style</span>
                  <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                    Live result amounts
                  </span>
                </div>
                <FluidSegmentControl
                  isLight={isLight}
                  size="sm"
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
                <span className="text-sm font-black">Notifications</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  Popup blur card, or top pill banner
                </span>
              </div>
              <FluidSegmentControl
                isLight={isLight}
                size="sm"
                ariaLabel="Notification style"
                value={draft.notificationStyle ?? 'pill'}
                onChange={(notificationStyle) => patchDraft({ notificationStyle })}
                options={[
                  { id: 'modal', label: 'Popup' },
                  { id: 'pill', label: 'Banner' },
                ]}
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-black">Calculator UI</span>
                <span className={`app-subtext text-[10px] ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                  Classic framed, or flat white / black (no top bar or card)
                </span>
              </div>
              <FluidSegmentControl
                isLight={isLight}
                size="sm"
                ariaLabel="Calculator UI skin"
                value={draft.calculatorSkin ?? 'classic'}
                onChange={(calculatorSkin) =>
                  patchDraft({
                    calculatorSkin: calculatorSkin as 'classic' | 'white' | 'black',
                    // Flat skins always sit on the background (no card).
                    ...(calculatorSkin !== 'classic' ? { disableCalculatorCard: true } : {}),
                  })
                }
                options={[
                  { id: 'classic', label: 'Classic' },
                  { id: 'white', label: 'White' },
                  { id: 'black', label: 'Black' },
                ]}
              />
            </div>

            {(draft.calculatorSkin ?? 'classic') === 'classic' && (
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
            )}

          </div>
        </div>

        {/* Printer connectivity — USB → Bluetooth → WiFi */}
        <div
          ref={(el) => { sectionRefs.current[2] = el; }}
          className="settings-card p-6 shadow-2xl"
        >
          {renderSettingsCardHeader('Printers & connectivity', <Icons.Printer size={22} />)}

          <div className="space-y-4">
            <div className={`p-3 rounded-lg text-[11px] font-bold leading-normal border ${
              isLight ? 'bg-zinc-50 border-zinc-200 text-zinc-700' : 'bg-white/5 border-white/10 text-white/80'
            }`}>
              <div className="font-black mb-1">Auto-connect while using calculator</div>
              <div>USB first → Bluetooth (BLE) → WiFi / network (saved IPs)</div>
              <div className={`mt-1.5 ${isLight ? 'text-black/55' : 'text-white/55'}`}>
                Format: <span className="font-black">Fun Print</span> (photos, stickers, notes on pocket printers)
                and <span className="font-black">ESC/POS</span> text + raster on receipt printers. Detected from
                Bluetooth services, not the device name.
              </div>
              {printFormatSummary && (
                <div className="mt-1.5 text-green-600">Active: {printFormatSummary}</div>
              )}
            </div>

            {bluetoothSupport.message && (
              <div className={`p-3 rounded-lg text-xs font-bold leading-normal border ${
                bluetoothSupport.supported
                  ? 'bg-blue-500/10 border-blue-500/20 text-blue-600'
                  : 'bg-amber-500/10 border-amber-500/20 text-amber-600'
              }`}>
                {bluetoothSupport.message}
              </div>
            )}

            <div className={`rounded-xl border px-3 py-2.5 ${isLight ? 'bg-blue-50/80 border-blue-200/70' : 'bg-blue-500/10 border-blue-400/20'}`}>
              <span className={`app-subtext font-black ${isLight ? 'text-blue-900' : 'text-blue-200'}`}>
                Paper width: auto · {detectedPaperWidth}
              </span>
              <p className={`app-subtext mt-1 ${isLight ? 'text-black/55' : 'text-white/55'}`}>
                Fun Print pocket printers use 57/58mm (384 dots). Receipt printers: 58mm standard or 25mm mini.
              </p>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className={`app-subtext text-[10px] font-black ${isLight ? 'text-black' : 'text-white'}`}>
                {knownPrinters.length} device{knownPrinters.length !== 1 ? 's' : ''} known
              </span>
              <button
                type="button"
                onClick={() => void refreshPrinterState()}
                className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-lg active:scale-95 ${
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
                  <span className="app-subtext text-xs font-bold text-green-500">
                    Connected · {transportLabel(entry.saved.transport)}
                  </span>
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

            {knownPrinters.filter((e) => e.status !== 'connected').map((entry) => {
              const isBusy = connectingId === entry.saved.id;
              const needsBt = entry.saved.transport === 'ble' || !entry.saved.transport;
              const needsUsb = entry.saved.transport === 'usb';
              const disabled =
                isBusy ||
                isScanning ||
                (needsBt && !bluetoothSupport.supported) ||
                (needsUsb && !usbSupport.supported);
              return (
                <div
                  key={`known-${entry.saved.id}`}
                  className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${
                    isLight ? 'bg-zinc-50 border-zinc-200' : 'bg-white/5 border-white/5'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-black truncate">{entry.saved.name}</div>
                    <div className={`app-subtext text-[10px] font-bold mt-0.5 ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                      {transportLabel(entry.saved.transport)} ·{' '}
                      {entry.status === 'available' ? 'Ready' : 'Saved'}
                      {entry.saved.host ? ` · ${entry.saved.host}:${entry.saved.port ?? 9100}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => handleConnectSaved(entry.saved.id)}
                    disabled={disabled}
                    className="py-1.5 px-3 rounded-lg bg-blue-500 text-white text-xs font-black uppercase active:scale-95 disabled:opacity-50 transition-all shrink-0"
                  >
                    {isBusy ? '...' : 'Connect'}
                  </button>
                </div>
              );
            })}

            {knownPrinters.length === 0 && (
              <div className={`app-subtext text-[10px] opacity-45 p-4 rounded-xl text-center ${isLight ? 'text-black' : 'text-white'}`}>
                No printers yet. Connect USB, scan Bluetooth, or add a WiFi IP.
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleUsbConnect()}
              disabled={isScanning || connectingId !== null || !usbSupport.supported}
              className="w-full py-3.5 rounded-xl bg-violet-600 text-white text-xs font-black uppercase hover:bg-violet-700 active:scale-95 disabled:opacity-50 transition-all shadow-md"
            >
              {isScanning ? 'Connecting...' : 'Connect USB Printer'}
            </button>

            <button
              onClick={handleScanAndConnect}
              disabled={isScanning || connectingId !== null || !bluetoothSupport.supported}
              className="w-full py-3.5 rounded-xl bg-blue-500 text-white text-xs font-black uppercase hover:bg-blue-600 active:scale-95 disabled:opacity-50 transition-all shadow-md"
            >
              {isScanning ? 'Searching...' : knownPrinters.length > 0 ? 'Scan Bluetooth printer' : 'Scan & Connect Bluetooth'}
            </button>

            <button
              type="button"
              onClick={() => setShowWifiForm((v) => !v)}
              disabled={isScanning || connectingId !== null}
              className="w-full py-3.5 rounded-xl bg-teal-600 text-white text-xs font-black uppercase hover:bg-teal-700 active:scale-95 disabled:opacity-50 transition-all shadow-md"
            >
              {showWifiForm ? 'Hide WiFi form' : 'Add WiFi / Network Printer'}
            </button>

            {showWifiForm && (
              <div className={`space-y-2 p-3 rounded-xl border ${isLight ? 'bg-zinc-50 border-zinc-200' : 'bg-white/5 border-white/5'}`}>
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
                  className={`w-full px-3 py-2.5 rounded-lg border text-sm font-bold ${
                    isLight ? 'bg-white border-zinc-200 text-zinc-900' : 'bg-white/5 border-white/10 text-white'
                  }`}
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Port"
                    value={wifiPort}
                    onChange={(e) => setWifiPort(e.target.value)}
                    className={`w-24 px-3 py-2.5 rounded-lg border text-sm font-bold ${
                      isLight ? 'bg-white border-zinc-200 text-zinc-900' : 'bg-white/5 border-white/10 text-white'
                    }`}
                  />
                  <input
                    type="text"
                    placeholder="Name (optional)"
                    value={wifiName}
                    onChange={(e) => setWifiName(e.target.value)}
                    className={`flex-1 px-3 py-2.5 rounded-lg border text-sm font-bold ${
                      isLight ? 'bg-white border-zinc-200 text-zinc-900' : 'bg-white/5 border-white/10 text-white'
                    }`}
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

            <details className={`rounded-xl border px-3 py-2 ${isLight ? 'border-zinc-200' : 'border-white/10'}`}>
              <summary className={`text-[10px] font-black uppercase cursor-pointer ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                Print requirements
              </summary>
              <ul className={`mt-2 list-disc pl-4 space-y-1 text-[10px] font-bold ${isLight ? 'text-black/65' : 'text-white/65'}`}>
                {printerCaps.necessities.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>

            {printerName && (
              <button
                onClick={handlePrintReceipt}
                className={`w-full py-3 rounded-xl border text-xs font-black uppercase transition-all active:scale-95 ${
                  printSuccess
                    ? 'bg-green-500 text-white border-green-500'
                    : (isLight ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-900 border-white')
                }`}
              >
                {printSuccess ? 'Printed Successfully!' : 'Print Current Invoice'}
              </button>
            )}

            {errorMessage && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold leading-normal">
                {errorMessage}
              </div>
            )}
          </div>
        </div>

        {/* PWA + APK, with timeslapse update check */}
        {(() => {
          const {
            phase,
            target,
            progress,
            message,
            error: updateError,
            status,
            statusLoading,
            startPwa,
            startApk,
            restart,
          } = appUpdate;
          const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
          const isReady = phase === 'ready';
          const isBusy = phase === 'downloading';
          const statusKind = statusLoading ? 'loading' : status?.kind ?? 'unknown';
          const statusText = statusLoading
            ? 'Checking for updates…'
            : status?.message ?? '';
          const btnBase =
            'w-full py-3.5 px-4 rounded-xl font-semibold text-[12px] flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-70';

          return (
            <div className="settings-card p-6 shadow-2xl">
              {renderSettingsCardHeader('Get iCalc', <Icons.Download size={22} />)}
              <p className={`app-subtext text-[11px] font-medium mb-2 ${isLight ? 'text-black/60' : 'text-white/60'}`} style={{ letterSpacing: 0 }}>
                Home screen app (PWA) or Android APK.
              </p>
              {statusText && (
                <p
                  className={`text-[11px] font-semibold mb-3 ${
                    statusKind === 'update'
                      ? 'text-amber-500'
                      : statusKind === 'current'
                        ? isLight
                          ? 'text-emerald-600'
                          : 'text-emerald-400'
                        : isLight
                          ? 'text-black/45'
                          : 'text-white/45'
                  }`}
                  style={{ letterSpacing: 0 }}
                >
                  {statusText}
                </p>
              )}
              {(message || updateError) && (
                <p
                  className={`text-[11px] font-semibold mb-3 ${
                    isReady
                      ? isLight
                        ? 'text-emerald-600'
                        : 'text-emerald-400'
                      : phase === 'error'
                        ? 'text-red-500'
                        : isLight
                          ? 'text-black/45'
                          : 'text-white/45'
                  }`}
                  style={{ letterSpacing: 0 }}
                >
                  {updateError || message}
                </p>
              )}
              {isBusy && (
                <div
                  className={`h-2 rounded-full overflow-hidden mb-4 ${isLight ? 'bg-black/10' : 'bg-white/10'}`}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                >
                  <div className="h-full rounded-full bg-blue-500 transition-[width] duration-200" style={{ width: `${pct}%` }} />
                </div>
              )}
              {isReady ? (
                <button
                  type="button"
                  onClick={restart}
                  className={`${btnBase} bg-emerald-500 text-white`}
                  style={{ letterSpacing: 0 }}
                >
                  Restart
                </button>
              ) : (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={startPwa}
                    className={`${btnBase} ${isLight ? 'bg-blue-500 text-white' : 'bg-blue-500/90 text-white'}`}
                    style={{ letterSpacing: 0 }}
                  >
                    {isBusy && target === 'pwa' ? `PWA… ${pct}%` : 'Home screen (PWA)'}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={startApk}
                    className={`${btnBase} ${isLight ? 'bg-black text-white' : 'bg-white text-zinc-900'}`}
                    style={{ letterSpacing: 0 }}
                  >
                    <Icons.Download size={16} />
                    {isBusy && target === 'apk' ? `APK… ${pct}%` : 'Download APK'}
                  </button>
                </div>
              )}
            </div>
          );
        })()}

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
              className={`w-full py-3 rounded-xl text-[10px] font-black uppercase active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center gap-2 ${
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
              className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase active:scale-95 transition-all border ${
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
              className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase active:scale-95 transition-all bg-red-500 text-white"
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
