import React, { useState, useMemo, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import { safeEvaluate, sanitizeClipboardExpression } from './utils/calculator';
import CalcButton from './components/CalcButton';
import HistoryPanel from './components/HistoryPanel';
import InvoiceDragHandle from './components/InvoiceDragHandle';
import SettingsPanel from './components/SettingsPanel';
import SearchPanel from './components/SearchPanel';
import BlurredBackground from './components/BlurredBackground';
import POSDashboard from './components/POSDashboard';
import AuthOverlay from './components/AuthOverlay';
import AdminCodeDashboard from './components/AdminCodeDashboard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Icons } from './constants';
import { useSettings } from './hooks/useSettings';
import { useHistory } from './hooks/useHistory';
import { useCalculator } from './hooks/useCalculator';

import { useStandby } from './hooks/useStandby';
import { useEdgeSwipe } from './hooks/useGestures';
import { useScreenOrientation } from './hooks/useScreenOrientation';
import { getDeviceClass } from './utils/devicePreferences';
import {
  computeAutoLandscapeLayout,
  computeAutoPortraitLayout,
  computePresetLayout,
  EXPRESSION_CHAR_WIDTH_RATIO,
} from './utils/expressionLayout';
import {
  mapPointerToExpressionIndex,
  scrollCursorIntoView,
} from './utils/expressionCursor';

const SETTINGS_SECTION_COUNT = 3;
import { useAuth } from './hooks/useAuth';
import { useSupabaseDataSync } from './hooks/useSupabaseDataSync';
import { useDataMemorySync } from './hooks/useDataMemorySync';
import { useSyncStatus } from './hooks/useSyncStatus';
import {
  AppAccount,
  createAdminProfile,
  ensureAdminProfile,
  getAccounts,
  getAuthSession,
  isAdminProfile,
} from './utils/auth';
import { SyncStatusIndicator } from './components/SyncStatusIndicator';
import AccountToastHost from './components/AccountToastHost';
import { useAccountNotifications } from './hooks/useAccountNotifications';

import { usePOS, InventoryItem } from './hooks/usePOS';
import { useInvoice } from './hooks/useInvoice';
import { buildPosExpressionFromItems } from './utils/posExpression';
import {
  buildExpressionRenderSlices,
  getExpressionViewPreset,
  normalizeExpressionViewMode,
  getUnidentifiedPriceRanges,
  splitExpressionAtPlus,
} from './utils/expressionDisplay';
import { CartLineItem, InvoiceActionLog, InvoicePrintLog, SavedInvoice } from './types';
import { usePOSDashboardData } from './hooks/usePOSDashboardData';
import { clearAppSessionData, isCloudUserAccount } from './utils/freshAppSession';
import { mergeAccountProfiles } from './utils/supabaseAuth';
import {
  applyShopTelegramLocally,
  bindAccountToOwnerTelegram,
  hasOwnerTelegramLink,
  isTelegramDbConnected,
} from './utils/telegramDb';
import { fetchMyShopTelegram } from './utils/accessControl';
import { printerInstance } from './utils/bluetoothPrinter';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

const AppContent: React.FC = () => {
  const {
    account,
    authReady,
    adminSessionToken,
    isAdminPortal,
    signup,
    login,
    logout,
    skipDevAuthAsAdmin,
    syncProfiles,
    changePassword,
    verifyPassword,
    finalizeApprovedAccess,
    closeAdminPortal,
    hideAdminPortal,
  } = useAuth();
  const { settings, updateSettings, triggerHaptic, isLight, formatCurrency, activeProfile } = useSettings({
    userId: account?.id ?? null,
    authReady,
  });
  const calculatorSkin = settings.calculatorSkin ?? 'classic';
  const isFlatCalcSkin = calculatorSkin === 'white' || calculatorSkin === 'black';
  const disableCard = isFlatCalcSkin || !!settings.disableCalculatorCard;
  /** Flat white/black skins force their own keypad contrast regardless of theme. */
  const calcIsLight = calculatorSkin === 'white' ? true : calculatorSkin === 'black' ? false : isLight;
  const isLandscape = settings.layoutMode === 'landscape';
  const { history, setHistory, saveResult } = useHistory();
  const {
    items,
    setItems,
    purchases,
    setPurchases,
    wholesales,
    activeWholesaleId,
    setActiveWholesaleId,
    renameWholesale,
    addWholesale,
    archivedWholesales,
    archiveWholesale,
    restoreWholesale,
  } = usePOS(history);
  const {
    suppliers,
    setSuppliers,
    requests,
    setRequests,
    restocks,
    setRestocks,
  } = usePOSDashboardData();
  const {
    expression, calcError, inputChar,
    toggleSign, finalize, handleUndo, handleRedo, clearExpression, deleteLast,
    addInventoryItem, pasteExpression, cursorPos, setCursorPos, setExpression
  } = useCalculator(saveResult, triggerHaptic);

  const syncStatus = useSyncStatus();

  const displayResult = expression === '0' ? '0' : safeEvaluate(expression);
  const liveResultParts = useMemo(() => {
    const num = parseFloat(displayResult) || 0;
    const val = num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (settings.currency === 'GHS') {
      if (settings.ghsCalculatorStyle === 'cedis') {
        return { amount: `¢${val}`, suffix: '' };
      }
      return { amount: val, suffix: 'ghs' };
    }
    return { amount: formatCurrency(displayResult), suffix: '' };
  }, [displayResult, formatCurrency, settings.currency, settings.ghsCalculatorStyle]);
  const showLiveResult = displayResult !== '0' && displayResult !== '0.00';
  const isDraggingCursor = useRef(false);
  const activeProfileName = useMemo(() => activeProfile?.name ?? 'Staff', [activeProfile]);
  const canViewTransactions = isAdminProfile(activeProfile);
  const {
    invoiceName,
    setInvoiceName,
    cartItems,
    actionLogs,
    runningTotal,
    saveCurrentInvoiceAndStartNew,
    saveCurrentToPast,
    switchToInvoice,
    printLogs,
    pastLogs,
    recordPrint,
    resolveUnidentifiedPrice,
    hydrateInvoiceState,
    replaceInvoiceHistory,
    getInvoiceExpression,
    getSavedInvoices,
  } = useInvoice(expression, items, settings.currency, activeProfileName);

  // Auto 30d local / Telegram archive — no Settings UI; runs in background when linked.
  useDataMemorySync({
    accountId: account?.id ?? null,
    authReady,
    pastLogs,
    printLogs,
    inventory: items,
    settings,
    wholesales,
    activeWholesaleId,
    getSavedInvoices,
    replaceInvoiceHistory,
  });

  /** Record a sale when Print is used (invoice switcher or Vision Hub drawer). */
  const handleDrawerInvoicePrinted = useCallback(
    (name: string, total: string, items: CartLineItem[]) => {
      recordPrint(name, total, items);
    },
    [recordPrint]
  );

  const handleInvoiceHydrated = useCallback(
    (data: {
      invoiceName: string;
      expression: string;
      pastLogs: InvoiceActionLog[];
      printLogs: InvoicePrintLog[];
      savedInvoices: SavedInvoice[];
    }) => {
      hydrateInvoiceState({
        invoiceName: data.invoiceName,
        pastLogs: data.pastLogs,
        printLogs: data.printLogs,
        savedInvoices: data.savedInvoices,
      });
      setExpression(data.expression);
      setCursorPos(data.expression === '0' ? 0 : data.expression.length);
    },
    [hydrateInvoiceState, setExpression, setCursorPos]
  );

  useSupabaseDataSync({
    userId: account?.id ?? null,
    authReady,
    history,
    setHistory,
    inventory: items,
    setInventory: setItems,
    purchases,
    setPurchases,
    suppliers,
    setSuppliers,
    requests,
    setRequests,
    restocks,
    setRestocks,
    invoiceName,
    expression,
    pastLogs,
    printLogs,
    getSavedInvoices,
    onInvoiceHydrated: handleInvoiceHydrated,
  });

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isCalculatorEntering, setIsCalculatorEntering] = useState(false);
  // Don't flash signup/login when a session already exists — wait for restore.
  const [authOverlayMounted, setAuthOverlayMounted] = useState(() => !getAuthSession());
  const sessionBootstrappedRef = useRef(false);
  const isAdminPortalRef = useRef(false);
  const accountIdRef = useRef<string | null>(null);
  /** After admin portal / Calc — force Bot API paste before calculator. */


  useEffect(() => {
    accountIdRef.current = account?.id ?? null;
  }, [account?.id]);

  const accountNotifications = useAccountNotifications({
    accountId: account?.id ?? null,
    profiles: settings.profiles ?? [],
    activeProfileId: settings.activeProfileId ?? '',
    notificationStyle: settings.notificationStyle ?? 'pill',
    enabled: !!account && isUnlocked,
  });

  const emitAccountNotification = accountNotifications.emit;
  const handleAccountNotify = useCallback(
    (input: {
      kind: 'item_added' | 'item_restocked' | 'price_updated' | 'stock_updated' | 'image_updated';
      title: string;
      body: string;
    }) => {
      const actorProfileId = settings.activeProfileId ?? '';
      if (!actorProfileId) return;
      emitAccountNotification({
        ...input,
        actorProfileId,
      });
    },
    [emitAccountNotification, settings.activeProfileId]
  );

  const closeAllPanels = useCallback(() => {
    setIsHistoryOpen(false);
    setIsPOSOpen(false);
    setIsSettingsOpen(false);
    setIsSearchOpen(false);
    setSearchQuery('');
  }, []);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
    setSettingsSectionIndex(0);
  }, []);

  /** Bind owner/shared Telegram if present; shops never paste — admin sets it on approve. */
  const ensureLocalTelegramBinding = useCallback((acc: AppAccount | null | undefined): void => {
    if (!acc?.id) return;
    if (hasOwnerTelegramLink()) {
      bindAccountToOwnerTelegram(acc.id);
      return;
    }
    if (isTelegramDbConnected(acc.id)) return;
  }, []);

  /** Logged-in path: land on calculator (close POS/settings/history overlays). */
  const openCalculatorHome = useCallback(
    (opts?: { animate?: boolean }) => {
      if (isAdminPortalRef.current) return;
      closeAllPanels();
      setAuthOverlayMounted(false);
      if (opts?.animate) setIsCalculatorEntering(true);
      setIsUnlocked(true);
    },
    [closeAllPanels]
  );

  /** Foreground resume: keep whatever screen the user left (do not close panels). */
  const resumeWhereLeftOff = useCallback(() => {
    if (isAdminPortalRef.current) return;
    setAuthOverlayMounted(false);
    setIsUnlocked(true);
  }, []);

  // While using the calculator: auto-scan printers USB → Bluetooth → WiFi.
  useEffect(() => {
    if (!authReady || !account || !isUnlocked) {
      printerInstance.stopBackgroundAutoConnect();
      return;
    }
    printerInstance.startBackgroundAutoConnect(40000);
    return () => {
      printerInstance.stopBackgroundAutoConnect();
    };
  }, [authReady, account, isUnlocked]);

  const lockScreen = useCallback(() => {
    closeAllPanels();
    printerInstance.stopBackgroundAutoConnect();
    setIsUnlocked(false);
    setAuthOverlayMounted(true);
  }, [closeAllPanels]);

  const handleQuickUnlock = useCallback(() => {
    setIsCalculatorEntering(true);
    setIsUnlocked(true);
    setAuthOverlayMounted(false);
    triggerHaptic(2);
  }, [triggerHaptic]);

  useStandby(isUnlocked, settings.standbyTimerSeconds ?? 0, lockScreen);

  // Keep portal ref in sync for resume handlers (avoid stale closures).
  useEffect(() => {
    isAdminPortalRef.current = isAdminPortal;
  }, [isAdminPortal]);

  // Cold start only: signed-in users skip auth once. Later account hydrates must not reset UI.
  // Telegram Bot API is admin-only (approve); shops auto-pull — never blocked on a paste UI.
  useEffect(() => {
    if (!authReady) return;

    if (account) {
      ensureLocalTelegramBinding(account);
      if (!isAdminPortal && !sessionBootstrappedRef.current) {
        openCalculatorHome({ animate: true });
      } else if (!isAdminPortal && !isUnlocked) {
        resumeWhereLeftOff();
      }
      sessionBootstrappedRef.current = true;
      return;
    }

    // Confirmed signed out after auth is ready — show auth overlay only then.
    setIsUnlocked(false);
    setAuthOverlayMounted(true);
    sessionBootstrappedRef.current = true;
  }, [authReady, account, isAdminPortal, isUnlocked, openCalculatorHome, resumeWhereLeftOff, ensureLocalTelegramBinding]);

  // Admin portal always runs as the @admin profile.
  useEffect(() => {
    if (!isAdminPortal) return;
    const profiles = ensureAdminProfile(settings.profiles ?? []);
    const admin = profiles.find((p) => isAdminProfile(p)) ?? createAdminProfile();
    if (settings.activeProfileId === admin.id) return;
    updateSettings({
      profiles,
      activeProfileId: admin.id,
    });
  }, [isAdminPortal, settings.profiles, settings.activeProfileId, updateSettings]);

  // Background → foreground: restore session UI without closing POS/settings/history.
  useEffect(() => {
    if (!authReady || !account) return;

    const onVisibility = () => {
      if (document.visibilityState === 'visible') resumeWhereLeftOff();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', resumeWhereLeftOff);

    let removeCap: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      void CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) resumeWhereLeftOff();
      }).then((handle) => {
        removeCap = () => {
          void handle.remove();
        };
      });
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', resumeWhereLeftOff);
      removeCap?.();
    };
  }, [authReady, account, resumeWhereLeftOff]);

  // Keep account profiles durable: merge cloud ∪ local, upsert to cloud, never drop users.
  useEffect(() => {
    if (!account) return;
    const settingsProfiles = settings.profiles ?? [];
    const settingsActiveId = settings.activeProfileId ?? '';
    const merged = mergeAccountProfiles(account.profiles, settingsProfiles);
    const mergedActive = merged.some((p) => p.id === settingsActiveId)
      ? settingsActiveId
      : merged.some((p) => p.id === account.activeProfileId)
        ? account.activeProfileId
        : merged[0]?.id ?? '';

    const settingsSame =
      JSON.stringify(ensureAdminProfile(settingsProfiles)) === JSON.stringify(merged) &&
      settingsActiveId === mergedActive;
    if (!settingsSame) {
      updateSettings({ profiles: merged, activeProfileId: mergedActive });
      return;
    }

    const accountSame =
      account.activeProfileId === mergedActive &&
      JSON.stringify(account.profiles) === JSON.stringify(merged);
    if (accountSame) return;

    void syncProfiles(merged, mergedActive).then((synced) => {
      if (
        JSON.stringify(synced) !== JSON.stringify(merged) ||
        !synced.some((p) => p.id === mergedActive)
      ) {
        const nextActive = synced.some((p) => p.id === mergedActive)
          ? mergedActive
          : synced[0]?.id ?? '';
        updateSettings({ profiles: synced, activeProfileId: nextActive });
      }
    });
  }, [account, settings.profiles, settings.activeProfileId, syncProfiles, updateSettings]);

  const handleAuthSuccess = useCallback((acc: NonNullable<typeof account>) => {
    // Cloud accounts: do NOT wipe local React state here. Clearing used to race an empty
    // push to Supabase and made every re-login look like a brand-new account.
    // useSupabaseDataSync hydrates from the same user_id database after auth.
    if (isCloudUserAccount(acc.id)) {
      // Drop stale guest/local storage keys only; hydrate replaces in-memory state.
      clearAppSessionData();
    }
    const mergedProfiles = mergeAccountProfiles(acc.profiles, settings.profiles ?? []);
    const nextActive = mergedProfiles.some((p) => p.id === acc.activeProfileId)
      ? acc.activeProfileId
      : mergedProfiles.some((p) => p.id === settings.activeProfileId)
        ? settings.activeProfileId
        : mergedProfiles[0]?.id ?? '';
    updateSettings({
      profiles: mergedProfiles,
      activeProfileId: nextActive,
    });
    triggerHaptic(2);

    const unlock = () => {
      setIsCalculatorEntering(true);
      setIsUnlocked(true);
      setAuthOverlayMounted(false);
    };

    // Prefer Telegram already on device; else silently pull shop bot saved at admin approve.
    // Shops never paste Bot API — if missing, unlock anyway (archive stays idle until linked).
    ensureLocalTelegramBinding(acc);
    if (isTelegramDbConnected(acc.id)) {
      unlock();
      return;
    }

    void fetchMyShopTelegram().then((remote) => {
      if (remote.ok) {
        applyShopTelegramLocally(acc.id, remote.botToken, remote.chatId);
      }
      unlock();
    });
  }, [updateSettings, triggerHaptic, settings.profiles, settings.activeProfileId, ensureLocalTelegramBinding]);

  /** Local guest login for `npm run dev` — no Bot API paste. */
  const handleDevSkip = useCallback(async () => {
    const guest = skipDevAuthAsAdmin();
    if (!guest) {
      return { error: 'Dev skip only works during npm run dev.' };
    }
    updateSettings({ accountPlan: 'premium' });
    ensureLocalTelegramBinding(guest);
    return { account: guest };
  }, [skipDevAuthAsAdmin, updateSettings, ensureLocalTelegramBinding]);

  const handleAdminReturnToCalc = useCallback(() => {
    hideAdminPortal();
    closeAllPanels();

    let acc = account;
    if (!acc && import.meta.env.DEV) {
      acc = skipDevAuthAsAdmin();
      if (acc) updateSettings({ accountPlan: 'premium' });
    }

    if (acc) ensureLocalTelegramBinding(acc);

    setAuthOverlayMounted(false);
    setIsCalculatorEntering(true);
    setIsUnlocked(true);
    triggerHaptic(2);
  }, [
    hideAdminPortal,
    closeAllPanels,
    triggerHaptic,
    account,
    skipDevAuthAsAdmin,
    updateSettings,
    ensureLocalTelegramBinding,
  ]);

  const handleSignup = useCallback(async (username: string, email: string, inviteCode: string) => {
    const result = await signup(username, email, inviteCode);
    if (result.error) return { error: result.error };
    if (result.pendingEmailConfirmation) {
      return {
        pendingEmailConfirmation: true,
        confirmationEmail: result.confirmationEmail,
      };
    }
    if (result.pendingApproval) {
      return {
        pendingApproval: true,
        accessCode: result.accessCode,
        username: result.username,
      };
    }
    if (!result.account) return { error: 'Could not create account.' };
    return { account: result.account };
  }, [signup]);

  const handleLogin = useCallback(async (username: string, password: string) => {
    const result = await login(username, password);
    if (result.error) return { error: result.error };
    if (result.adminPortal) return { adminPortal: true };
    if (result.pendingApproval) {
      return {
        pendingApproval: true,
        accessCode: result.accessCode,
        username: result.username,
      };
    }
    if (result.paused) return { paused: true };
    if (!result.account) return { error: 'Could not sign in.' };
    return { account: result.account };
  }, [login]);

  const handleFinalizeAccess = useCallback(async (accessCode: string, username: string) => {
    const result = await finalizeApprovedAccess(accessCode, username);
    if (result.error) return { error: result.error };
    if (!result.account) return { error: 'Could not grant access.' };
    return { account: result.account };
  }, [finalizeApprovedAccess]);

  /** Show AdminCodeDashboard (generate codes). Caller must already set admin session token. */
  const handleAdminPortal = useCallback(() => {
    const profiles = ensureAdminProfile(settings.profiles ?? []);
    const admin = profiles.find((p) => isAdminProfile(p)) ?? createAdminProfile();
    updateSettings({
      profiles,
      activeProfileId: admin.id,
    });
    triggerHaptic(2);
    setIsUnlocked(false);
    setAuthOverlayMounted(false);
  }, [settings.profiles, updateSettings, triggerHaptic]);


  const handleLogout = useCallback(() => {
    logout();
    lockScreen();
  }, [logout, lockScreen]);

  const handleChangePassword = useCallback(async (current: string, newPass: string) => {
    const result = await changePassword(current, newPass);
    if (result.error) return { error: result.error };
    triggerHaptic(2);
    return { ok: true };
  }, [changePassword, triggerHaptic]);

  const handleVerifyAdminPassword = useCallback(async (password: string) => {
    const result = await verifyPassword(password);
    if (result.error) return { error: result.error };
    triggerHaptic(2);
    return { ok: true };
  }, [verifyPassword, triggerHaptic]);

  const handleUpdateSettings = useCallback(<K extends keyof typeof settings>(
    keyOrPatch: K | Partial<typeof settings>,
    value?: typeof settings[K]
  ) => {
    if (typeof keyOrPatch === 'string') updateSettings({ [keyOrPatch]: value } as Partial<typeof settings>);
    else updateSettings(keyOrPatch);
  }, [updateSettings]);

  const authMode = getAccounts().length > 0 || account ? 'login' : 'signup';
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isHistoryPanelActive, setIsHistoryPanelActive] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPOSOpen, setIsPOSOpen] = useState(false);
  const [isPlusAnimating, setIsPlusAnimating] = useState(false);
  const [isHomeAnimating, setIsHomeAnimating] = useState(false);
  const [isSettingsAnimating, setIsSettingsAnimating] = useState(false);
  const [settingsSectionIndex, setSettingsSectionIndex] = useState(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchAnchorRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const plusNewInvoicePendingRef = useRef(false);
  
  const displayContentRef = useRef<HTMLPreElement>(null);
  const expressionScrollRef = useRef<HTMLDivElement>(null);
  const expressionAreaRef = useRef<HTMLDivElement>(null);
  const expressionColumnRef = useRef<HTMLDivElement>(null);
  const expressionToolbarRef = useRef<HTMLDivElement>(null);
  const baseDisplayFontSize = isLandscape ? 32 : 36;
  const expressionViewMode = normalizeExpressionViewMode(settings.expressionViewMode);
  const expressionViewPreset = getExpressionViewPreset(expressionViewMode);
  const [expressionAvailWidth, setExpressionAvailWidth] = useState(0);
  const [expressionAvailHeight, setExpressionAvailHeight] = useState(0);
  const [devicePortrait, setDevicePortrait] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches
  );
  const edgePadding = disableCard ? '6%' : '0.625rem';
  const keypadEdge = '2%';
  const keypadGap = disableCard ? 'max(3px, 1.2%)' : '6px';
  const keypadScale = 0.9;
  const expressionLayout = useMemo(() => {
    if (expressionViewPreset) {
      return computePresetLayout(
        expression,
        expressionAvailWidth,
        expressionAvailHeight,
        baseDisplayFontSize,
        expressionViewPreset.charsPerLine,
        expressionViewPreset.visibleLines,
        isLandscape,
        expressionViewPreset.breakAtPlus
      );
    }
    if (isLandscape) {
      return computeAutoLandscapeLayout(
        expression,
        expressionAvailWidth,
        expressionAvailHeight,
        baseDisplayFontSize
      );
    }
    return computeAutoPortraitLayout(expression, expressionAvailWidth, baseDisplayFontSize);
  }, [
    expression,
    expressionAvailWidth,
    expressionAvailHeight,
    baseDisplayFontSize,
    expressionViewPreset,
    isLandscape,
  ]);

  const charsPerLine = expressionLayout.charsPerLine;
  const displayFontSize = expressionLayout.displayFontSize;
  const expressionViewportMaxHeight = expressionLayout.viewportMaxHeight;
  const expressionBreakAtPlus = expressionLayout.breakAtPlus;
  const expressionLineHeight = expressionLayout.lineHeight;

  const liveResultFontSize = displayFontSize * 1.2 * 0.92;
  const liveResultSlotMinHeight = baseDisplayFontSize * 1.2 * 0.92 * 1.2;

  useScreenOrientation(
    settings.layoutMode ?? 'portrait',
    settings.layoutModeAuto !== false,
    isUnlocked
  );

  const forceLandscapeRotate =
    isLandscape &&
    settings.layoutModeAuto === false &&
    getDeviceClass() === 'mobile' &&
    devicePortrait;

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const onChange = () => setDevicePortrait(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const mapPointerFallback = useCallback((clientX: number, clientY: number) => {
    const pre = displayContentRef.current;
    if (!pre || expression === '0') return 0;

    const lines = expressionBreakAtPlus
      ? splitExpressionAtPlus(expression).flatMap(
          (segment) => segment.match(new RegExp(`.{1,${charsPerLine}}`, 'g')) ?? [segment]
        )
      : expression.match(new RegExp(`.{1,${charsPerLine}}`, 'g')) ?? [expression];
    const preRect = pre.getBoundingClientRect();
    const lineHeight = displayFontSize * expressionLineHeight;
    const lineIndex = Math.max(
      0,
      Math.min(lines.length - 1, Math.floor((clientY - preRect.top) / lineHeight))
    );
    const charsBeforeLine = lines.slice(0, lineIndex).join('').length;
    const line = lines[lineIndex] ?? '';
    const charPosInLine = expressionBreakAtPlus
      ? Math.round(((clientX - preRect.left) / preRect.width) * line.length)
      : Math.round(
          (clientX - (preRect.right - line.length * displayFontSize * EXPRESSION_CHAR_WIDTH_RATIO)) /
            (displayFontSize * EXPRESSION_CHAR_WIDTH_RATIO)
        );

    return Math.max(
      0,
      Math.min(expression.length, charsBeforeLine + Math.max(0, Math.min(line.length, charPosInLine)))
    );
  }, [expression, charsPerLine, displayFontSize, expressionLineHeight, expressionBreakAtPlus]);

  const mapPointerToCursorPos = useCallback((clientX: number, clientY: number) => {
    const pre = displayContentRef.current;
    if (!pre || expression === '0') return 0;
    return mapPointerToExpressionIndex(
      pre,
      clientX,
      clientY,
      expression.length,
      mapPointerFallback
    );
  }, [expression, mapPointerFallback]);

  const updateCursorFromPointer = useCallback((clientX: number, clientY: number) => {
    const nextPos = mapPointerToCursorPos(clientX, clientY);
    setCursorPos(nextPos);
    const scrollEl = expressionScrollRef.current;
    const pre = displayContentRef.current;
    if (scrollEl && pre) {
      scrollCursorIntoView(scrollEl, pre, nextPos);
    }
  }, [mapPointerToCursorPos, setCursorPos]);

  const inventoryPrices = useMemo(
    () => items.map((item) => item.price),
    [items]
  );

  const unidentifiedPriceRanges = useMemo(
    () => getUnidentifiedPriceRanges(expression, inventoryPrices),
    [expression, inventoryPrices]
  );

  const expressionCursorPos = cursorPos ?? expression.length;
  const scrollExpressionToBottom =
    !expressionBreakAtPlus &&
    (expression === '0' || expressionCursorPos >= expression.length);

  const expressionRenderSlices = useMemo(
    () => buildExpressionRenderSlices(expression, expressionCursorPos, unidentifiedPriceRanges),
    [expression, expressionCursorPos, unidentifiedPriceRanges]
  );

  const hasUnidentifiedPrices = unidentifiedPriceRanges.length > 0;
  const [unidentifiedPriceBlinkRed, setUnidentifiedPriceBlinkRed] = useState(false);
  const flashUnidentifiedPriceRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!hasUnidentifiedPrices) {
      setUnidentifiedPriceBlinkRed(false);
      flashUnidentifiedPriceRef.current = null;
      return;
    }

    const BLINK_PERIOD_MS = 15000;
    const BLINK_DURATION_MS = 200;
    let offTimer: ReturnType<typeof setTimeout> | undefined;

    const flash = () => {
      setUnidentifiedPriceBlinkRed(true);
      if (offTimer !== undefined) clearTimeout(offTimer);
      offTimer = setTimeout(() => {
        setUnidentifiedPriceBlinkRed(false);
        offTimer = undefined;
      }, BLINK_DURATION_MS);
    };

    flashUnidentifiedPriceRef.current = flash;
    const intervalId = setInterval(flash, BLINK_PERIOD_MS);

    return () => {
      clearInterval(intervalId);
      if (offTimer !== undefined) clearTimeout(offTimer);
      flashUnidentifiedPriceRef.current = null;
      setUnidentifiedPriceBlinkRed(false);
    };
  }, [hasUnidentifiedPrices]);

  const triggerUnidentifiedPriceBlink = useCallback(() => {
    flashUnidentifiedPriceRef.current?.();
  }, []);

  // Keep movable blinker (cursor) within expression bounds
  useEffect(() => {
    if (cursorPos !== null && cursorPos > expression.length) {
      setCursorPos(expression.length);
    }
  }, [expression, cursorPos, setCursorPos]);

  useLayoutEffect(() => {
    const scrollEl = expressionScrollRef.current;
    const pre = displayContentRef.current;
    if (!scrollEl || !pre) return;

    if (scrollExpressionToBottom && !isDraggingCursor.current) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }

    scrollCursorIntoView(scrollEl, pre, expressionCursorPos);
  }, [
    expression,
    expressionCursorPos,
    displayFontSize,
    charsPerLine,
    scrollExpressionToBottom,
    expressionBreakAtPlus,
    isLandscape,
  ]);

  useEffect(() => {
    const measure = () => {
      const container = expressionScrollRef.current;
      const area = expressionAreaRef.current;
      const toolbar = expressionToolbarRef.current;
      if (container) {
        setExpressionAvailWidth(container.clientWidth * 0.84);
      }
      if (isLandscape && area && toolbar) {
        const gap = 2;
        const height =
          toolbar.getBoundingClientRect().top - area.getBoundingClientRect().top - gap;
        setExpressionAvailHeight(Math.max(120, height));
      } else if (area) {
        setExpressionAvailHeight(area.clientHeight);
      }
    };

    measure();

    const ro = new ResizeObserver(measure);
    if (expressionScrollRef.current) ro.observe(expressionScrollRef.current);
    if (expressionAreaRef.current) ro.observe(expressionAreaRef.current);
    if (expressionColumnRef.current) ro.observe(expressionColumnRef.current);
    if (expressionToolbarRef.current) ro.observe(expressionToolbarRef.current);

    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isLandscape, disableCard, expressionViewPreset]);
  
  const isCalculatorActive = isUnlocked && !isPOSOpen && !isSettingsOpen;
  const isAnyModalOpen = isHistoryOpen || isPOSOpen || isSearchOpen || isSettingsOpen;
  // Settings sits on the blurred autoswipe wallpaper — hide the calculator chrome.
  const isCalculatorHidden = isHistoryPanelActive || isPOSOpen || isSettingsOpen;

  const calcEdgeSwipeEnabled =
    isUnlocked && !isPOSOpen && !isHistoryPanelActive && !isSearchOpen && !isHistoryOpen;

  const handleCalcRightEdgeSwipe = useCallback(() => {
    if (!calcEdgeSwipeEnabled) return;
    triggerHaptic();
    if (!isSettingsOpen) {
      setSettingsSectionIndex(0);
      setIsSettingsOpen(true);
      setIsSettingsAnimating(true);
      return;
    }
    setSettingsSectionIndex((i) => (i + 1) % SETTINGS_SECTION_COUNT);
  }, [calcEdgeSwipeEnabled, isSettingsOpen, triggerHaptic]);

  const handleCalcLeftEdgeSwipe = useCallback(() => {
    if (!isUnlocked || isPOSOpen || isHistoryPanelActive) return;
    triggerHaptic();
    if (isSettingsOpen) {
      closeSettings();
    }
    setIsCalculatorEntering(true);
  }, [isUnlocked, isPOSOpen, isHistoryPanelActive, isSettingsOpen, triggerHaptic, closeSettings]);

  const calcEdgeSwipe = useEdgeSwipe(
    {
      onSwipeFromLeftEdge: handleCalcLeftEdgeSwipe,
      onSwipeFromRightEdge: handleCalcRightEdgeSwipe,
    },
    calcEdgeSwipeEnabled || isSettingsOpen
  );

  const closeSearch = () => {
    setIsSearchOpen(false);
    setSearchQuery('');
    searchInputRef.current?.blur();
  };

  const handleSearchInvoiceSelect = (name: string) => {
    setInvoiceName(name);
    closeSearch();
    triggerHaptic();
  };

  const handleSearchInventorySelect = (item: InventoryItem) => {
    addInventoryItem(item.price);
    closeSearch();
  };

  const handleNewInvoice = () => {
    saveCurrentInvoiceAndStartNew();
    clearExpression();
    triggerHaptic(1);
  };

  const handleSelectInvoice = useCallback((
    name: string,
    items: CartLineItem[],
    options?: { keepOpen?: boolean }
  ) => {
    if (name !== invoiceName) {
      saveCurrentToPast();
    }
    switchToInvoice(name);
    const expr = getInvoiceExpression(name) || buildPosExpressionFromItems(items);
    setExpression(expr);
    setCursorPos(expr === '0' ? 0 : expr.length);
    if (!options?.keepOpen) {
      setIsHistoryOpen(false);
    }
    triggerHaptic();
  }, [invoiceName, saveCurrentToPast, switchToInvoice, getInvoiceExpression, setExpression, setCursorPos, triggerHaptic]);

  useEffect(() => {
    if (!isCalculatorActive || isSearchOpen) {
      setIsHistoryOpen(false);
    }
  }, [isCalculatorActive, isSearchOpen]);

  // Declarative keypad definition (clean, no repetition)
  type KeyDef = {
    label: string;
    action: string;
    variant?: 'primary' | 'secondary';
    wide?: boolean;
    ariaLabel?: string;
  };

  const keypad: KeyDef[] = [
    { label: 'AC', action: 'AC', variant: 'secondary', ariaLabel: 'All Clear' },
    { label: '+/-', action: '±', variant: 'secondary', ariaLabel: 'Toggle positive or negative sign' },
    { label: '%', action: '%', variant: 'secondary', ariaLabel: 'Percent' },
    { label: '÷', action: '/', variant: 'primary', ariaLabel: 'Divide' },

    { label: '7', action: '7' },
    { label: '8', action: '8' },
    { label: '9', action: '9' },
    { label: '×', action: '*', variant: 'primary', ariaLabel: 'Multiply' },

    { label: '4', action: '4' },
    { label: '5', action: '5' },
    { label: '6', action: '6' },
    { label: '-', action: '-', variant: 'primary', ariaLabel: 'Subtract' },

    { label: '1', action: '1' },
    { label: '2', action: '2' },
    { label: '3', action: '3' },
    { label: '+', action: '+', variant: 'primary', ariaLabel: 'Add' },

    { label: '0', action: '0', wide: true },
    { label: '.', action: '.' },
    { label: '=', action: '=', variant: 'primary', ariaLabel: 'Equals' },
  ];

  const handleKeypad = (action: string) => {
    if (action === 'AC') return clearExpression();
    if (action === '±') return toggleSign();
    if (action === '=') {
      triggerUnidentifiedPriceBlink();
      return finalize();
    }
    inputChar(action);
  };

  const copyExpressionToClipboard = useCallback(async (text?: string) => {
    const raw = text ?? (expression === '0' ? '' : expression);
    const sanitized = sanitizeClipboardExpression(raw);
    if (!sanitized) return;
    try {
      await navigator.clipboard.writeText(sanitized);
      triggerHaptic();
    } catch {
      // Clipboard API unavailable
    }
  }, [expression, triggerHaptic]);

  const handleExpressionCopy = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const selection = window.getSelection()?.toString() ?? '';
    const raw = selection || (expression === '0' ? '' : expression);
    const sanitized = sanitizeClipboardExpression(raw);
    if (!sanitized) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    e.clipboardData.setData('text/plain', sanitized);
    triggerHaptic();
  }, [expression, triggerHaptic]);

  const handleExpressionPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const raw = e.clipboardData.getData('text/plain');
    pasteExpression(raw);
  }, [pasteExpression]);

  // Keyboard support for accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key;

    if (key === 'Escape' && isSearchOpen) {
      closeSearch();
      e.preventDefault();
      return;
    }

    if (!isUnlocked) return;

    if (isAnyModalOpen) return;

    if (e.ctrlKey || e.metaKey) {
      if (key.toLowerCase() === 'c') {
        void copyExpressionToClipboard();
        e.preventDefault();
        return;
      }
      if (key.toLowerCase() === 'v') {
        e.preventDefault();
        void navigator.clipboard.readText().then(pasteExpression).catch(() => {});
        return;
      }
    }
    
    // Numbers
    if (/^\d$/.test(key)) {
      inputChar(key);
      e.preventDefault();
    }
    // Operators
    else if (key === '+' || key === '-' || key === '*' || key === '/') {
      inputChar(key);
      e.preventDefault();
    }
    // Decimal point
    else if (key === '.') {
      inputChar('.');
      e.preventDefault();
    }
    // Enter or = for equals
    else if (key === 'Enter' || key === '=') {
      triggerUnidentifiedPriceBlink();
      finalize();
      e.preventDefault();
    }
    // Backspace for delete
    else if (key === 'Backspace') {
      deleteLast();
      e.preventDefault();
    }
    else if (key === 'Escape') {
      clearExpression();
      e.preventDefault();
    }
  };

  return (
    <div className={`relative flex items-center justify-center h-dvh w-full overflow-hidden font-sans transition-colors duration-200 ${isLight ? 'bg-[#f2f2f7]' : 'bg-black'}`}
         onKeyDown={handleKeyDown}
         role="main">
      <BlurredBackground isLight={isLight} wallpapers={settings.customWallpapers} isUnlocked={isUnlocked} />
      {authOverlayMounted && !(account && isUnlocked) ? (
        <AuthOverlay
          isLight={isLight}
          mode={authMode}
          defaultUsername={account?.username ?? ''}
          existingAccount={account}
          settings={settings}
          updateSettings={updateSettings}
          onSignup={handleSignup}
          onLogin={handleLogin}
          onAuthComplete={(acc) => {
            handleAuthSuccess(acc);
          }}
          onAdminPortal={handleAdminPortal}
          onFinalizeAccess={handleFinalizeAccess}
          onDevSkip={import.meta.env.DEV ? handleDevSkip : undefined}
          onQuickUnlock={account ? handleQuickUnlock : undefined}
          onExitComplete={() => setAuthOverlayMounted(false)}
        />
      ) : null}
      {isUnlocked && (
      <>
      <div
        className={`fixed inset-0 z-20 flex items-center justify-center transition-all duration-700 cubic-bezier(0.16, 1, 0.3, 1) opacity-100 scale-100 ${isCalculatorHidden ? 'opacity-0 invisible pointer-events-none' : ''} ${isCalculatorEntering ? 'animate-auth-calc-enter' : ''} ${isPlusAnimating ? 'animate-insight-pop-screen' : ''} ${forceLandscapeRotate ? 'calc-force-landscape' : ''}`}
        onPointerDown={calcEdgeSwipe.onPointerDown}
        onPointerUp={calcEdgeSwipe.onPointerUp}
        onPointerCancel={calcEdgeSwipe.onPointerCancel}
        onAnimationEnd={(e) => {
          // Only handle animations on this layer (not bubbling from children)
          if (e.target !== e.currentTarget) return;
          const name = e.animationName || '';
          if (name.includes('auth-calc-enter') || isCalculatorEntering) {
            setIsCalculatorEntering(false);
          }
          if (name.includes('insight-pop-screen') || isPlusAnimating) {
            setIsPlusAnimating(false);
            if (plusNewInvoicePendingRef.current) {
              plusNewInvoicePendingRef.current = false;
              handleNewInvoice();
            }
          }
        }}
      >
        <div 
          className={`relative flex flex-col overflow-hidden transition-all duration-500 ${
            isLandscape
              ? disableCard
                ? 'w-[98%] h-[94%] sm:w-[96vw] sm:h-[92vh]'
                : 'w-[94%] h-[90vh] sm:w-[92vw] max-w-[920px] max-h-[640px] rounded-[26px]'
              : disableCard
                ? 'w-[97%] h-[98%] sm:w-[95vw] sm:h-[96vh]'
                : 'w-[94%] h-[96%] sm:w-[90vw] sm:h-[90vh] max-w-[430px] max-h-[932px] rounded-[26px]'
          } ${
            isFlatCalcSkin
              ? calculatorSkin === 'white'
                ? 'bg-white text-black'
                : 'bg-black text-white'
              : disableCard
                ? `bg-transparent ${isLight ? 'text-black' : 'text-white'}`
                : `${isLight ? 'bg-white/40 shadow-2xl text-black' : 'bg-white/10 shadow-2xl text-white'} backdrop-blur-(--glass-blur,24px)`
          }`}
          style={{
            paddingTop: isFlatCalcSkin
              ? 'max(0.35rem, env(safe-area-inset-top))'
              : 'max(0.75rem, env(safe-area-inset-top))',
            paddingRight: 'max(0.625rem, env(safe-area-inset-right))',
            paddingBottom: 'max(1rem, calc(1rem + env(safe-area-inset-bottom)))',
            paddingLeft: 'max(0.625rem, env(safe-area-inset-left))'
          }}
        >
          {isSearchOpen && !isFlatCalcSkin && (
            <div
              className={`absolute inset-x-0 bottom-0 z-40 transition-all duration-300 pointer-events-none ${isLight ? 'bg-[#f2f2f7]' : 'bg-[#0a0a0c]'}`}
              style={{ top: '3.25rem' }}
              aria-hidden="true"
            />
          )}

          {/* Classic only: top search / new-invoice / settings bar. Flat white/black skins omit it. */}
          {!isFlatCalcSkin && (
          <div
            className="flex items-center z-50 relative pointer-events-none shrink-0"
            style={{
              paddingTop: 'max(0.2rem, calc(1rem - 1.5%))',
              paddingLeft: 'max(0.2rem, calc(1rem - 1%))',
              paddingRight: 'max(0.2rem, calc(1rem - 1%))',
              gap: 'max(0.15rem, calc(0.625rem - 0.8%))',
            }}
          >
            <button
              onClick={() => {
                if (isPlusAnimating) return;
                triggerHaptic(1);
                plusNewInvoicePendingRef.current = true;
                setIsPlusAnimating(true);
              }}
              className={`pointer-events-auto h-8 w-8 shrink-0 rounded-full flex items-center justify-center transition-all duration-300 ${isSearchOpen ? 'blur-[2px] opacity-35' : ''} ${isLight ? 'bg-white/60 border-black/5 hover:bg-white/80 text-black' : 'bg-black/20 border-white/10 hover:bg-black/40 text-white'}`}
              style={{ boxShadow: isLight ? '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)' : '0 0 12px rgba(255,255,255,0.6), 0 0 4px rgba(255,255,255,0.3)' }}
              title="New Invoice"
              aria-label="Start new invoice"
            >
              <Icons.Plus size={16} />
            </button>

            <div
              ref={searchAnchorRef}
              className={`relative flex-1 min-w-0 z-[60] pointer-events-auto ${isSearchOpen ? 'isolate' : ''}`}
            >
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchOpen(true)}
                placeholder="Search"
                aria-label="Search invoices and inventory"
                aria-expanded={isSearchOpen}
                aria-controls="search-results-panel"
                className={`w-full py-1.5 px-4 text-center text-sm rounded-full outline-none border transition-all duration-300 blur-0 ${
                  isSearchOpen
                    ? 'bg-zinc-600 border-zinc-500/60 text-white placeholder-white/50 shadow-lg opacity-100'
                    : isLight
                      ? 'bg-white/60 border-black/5 text-black placeholder-black/30'
                      : 'bg-black/20 border-white/10 text-white placeholder-white/30'
                }`}
                style={
                  isSearchOpen
                    ? {
                        boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
                        WebkitTextFillColor: '#ffffff',
                        caretColor: '#ffffff',
                      }
                    : { boxShadow: isLight ? '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)' : '0 0 12px rgba(255,255,255,0.6), 0 0 4px rgba(255,255,255,0.3)' }
                }
              />
              <SearchPanel
                isOpen={isSearchOpen}
                query={searchQuery}
                onClose={closeSearch}
                isLight={isLight}
                currency={settings.currency}
                invoiceName={invoiceName}
                runningTotal={runningTotal}
                actionLogs={actionLogs}
                inventory={items}
                onSelectInvoice={handleSearchInvoiceSelect}
                onSelectInventory={handleSearchInventorySelect}
                anchorRef={searchAnchorRef}
              />
            </div>
 
            <div
              className={`flex items-center shrink-0 pointer-events-auto transition-all duration-300 ${isSearchOpen ? 'blur-[2px] opacity-35' : ''}`}
              style={{ gap: 'max(0.1rem, calc(0.375rem - 0.8%))' }}
            >
              <button 
                onClick={() => { setIsPOSOpen(true); triggerHaptic(); setIsHomeAnimating(true); }} 
                onAnimationEnd={() => setIsHomeAnimating(false)}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-all ${isHomeAnimating ? 'animate-plus-trigger' : ''} ${isLight ? 'bg-white/60 border-black/5 hover:bg-white/80 text-black' : 'bg-black/20 border-white/10 hover:bg-black/40 text-white'}`} 
                style={{ boxShadow: isLight ? '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)' : '0 0 12px rgba(255,255,255,0.6), 0 0 4px rgba(255,255,255,0.3)' }}
                title="Dashboard"
              >
                <Icons.Home size={16} />
              </button>
              <button 
                onClick={() => { setIsSettingsOpen(true); triggerHaptic(); setIsSettingsAnimating(true); }} 
                onAnimationEnd={() => setIsSettingsAnimating(false)}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-all ${isSettingsAnimating ? 'animate-plus-trigger' : ''} ${isLight ? 'bg-white/60 border-black/5 hover:bg-white/80 text-black' : 'bg-black/20 border-white/10 hover:bg-black/40 text-white'}`} 
                style={{ boxShadow: isLight ? '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)' : '0 0 12px rgba(255,255,255,0.6), 0 0 4px rgba(255,255,255,0.3)' }}
                title="Settings"
              >
                <Icons.Settings size={16} />
              </button>
            </div>
          </div>
          )}

          <div
            className={`relative z-40 flex justify-center items-center shrink-0 pointer-events-none select-none overflow-hidden pb-0.5 pt-0 transition-opacity duration-300 ${isSearchOpen ? 'blur-xl opacity-40' : ''} ${showLiveResult ? '' : 'opacity-0'}`}
            style={{
              paddingLeft: edgePadding,
              paddingRight: edgePadding,
              minHeight: `${liveResultSlotMinHeight}px`,
            }}
            aria-live="polite"
            aria-hidden={!showLiveResult}
            aria-label={showLiveResult ? `Live result: ${liveResultParts.amount}${liveResultParts.suffix}` : undefined}
          >
            {showLiveResult && (
              <div
                className={`
                  font-num tracking-[-0.04em] leading-none truncate max-w-full
                  ${isLight ? 'live-result-green-light' : 'live-result-green'}
                  animate-live-glow-pulse animate-live-spring-loop
                `}
                style={{
                  fontSize: `${liveResultFontSize}px`,
                }}
              >
                <span className="font-num-bold">{liveResultParts.amount}</span>
                {liveResultParts.suffix && (
                  <span className="font-num-light">{liveResultParts.suffix}</span>
                )}
              </div>
            )}
          </div>

          {/* ── Calculator body (portrait stack / landscape split) ── */}
          <div className={`flex-1 flex min-h-0 overflow-hidden ${isLandscape ? 'flex-row' : 'flex-col'}`}>
            {isLandscape && (
              <div
                className={`relative z-10 shrink-0 grid grid-cols-4 grid-rows-5 min-h-0 overflow-hidden transition-all duration-300 ${isSearchOpen ? 'blur-xl opacity-40' : ''}`}
                style={{
                  width: '52%',
                  gap: keypadGap,
                  paddingLeft: keypadEdge,
                  paddingRight: keypadEdge,
                  paddingBottom: keypadEdge,
                  paddingTop: keypadEdge,
                  transform: `translateY(-3%) scale(${keypadScale})`,
                  transformOrigin: 'left bottom',
                }}
              >
                {keypad.map((btn, idx) => (
                  <CalcButton
                    key={`land-${idx}`}
                    label={btn.label}
                    onClick={() => handleKeypad(btn.action)}
                    variant={btn.variant}
                    wide={btn.wide}
                    accentColor={settings.accentColor}
                    isLight={calcIsLight}
                    flat={isFlatCalcSkin}
                    ariaLabel={btn.ariaLabel}
                    large={disableCard}
                  />
                ))}
              </div>
            )}

            <div ref={expressionColumnRef} className={`flex flex-col min-h-0 min-w-0 ${isLandscape ? 'flex-1 gap-0' : 'flex-1 gap-3'}`}>
              {/* Display area */}
              <div
                className={`flex-1 flex flex-col items-center overflow-hidden min-h-0 transition-all duration-300 ${calcIsLight ? 'text-black' : 'text-white'} ${isSearchOpen ? 'blur-xl opacity-40' : ''}`}
                style={{
                  paddingTop: isLandscape ? '0' : '0.35rem',
                  paddingBottom: isLandscape ? '0' : '0.15rem',
                  paddingLeft: edgePadding,
                  paddingRight: edgePadding,
                }}
              >
                {calcError && (
                  <div className="text-sm text-red-500 mb-1 text-center truncate max-w-full px-[8%] shrink-0" role="alert">
                    {calcError}
                  </div>
                )}

                <div
                  ref={expressionAreaRef}
                  className={`relative w-full max-w-full flex-1 min-h-0 flex flex-col ${isLandscape ? 'h-full' : ''}`}
                  style={{
                    ...(isLandscape
                      ? { flex: '1 1 auto', minHeight: 0, height: '100%' }
                      : expressionViewportMaxHeight
                        ? { maxHeight: `${expressionViewportMaxHeight}px` }
                        : {}),
                  }}
                >
                  <div
                  ref={expressionScrollRef}
                  className={`calc-expression-scroll no-scrollbar w-full max-w-full flex-1 min-h-0 cursor-text select-text pointer-events-auto flex flex-col ${expressionBreakAtPlus ? 'text-left' : 'text-right'}`}
                  onCopy={handleExpressionCopy}
                  onPaste={handleExpressionPaste}
                  tabIndex={0}
                  style={{
                    paddingTop: isLandscape ? '0.1rem' : '0.15rem',
                    paddingBottom: isLandscape ? '0.1rem' : '0.5rem',
                    paddingLeft: '8%',
                    paddingRight: '8%',
                    boxSizing: 'border-box',
                    scrollBehavior: 'auto',
                    ...(expressionViewportMaxHeight
                      ? { maxHeight: `${expressionViewportMaxHeight}px` }
                      : {}),
                  }}
                  aria-label={`Expression: ${expression}`}
                  onPointerDown={(e) => {
                    if (expression === '0') return;
                    isDraggingCursor.current = true;
                    expressionScrollRef.current?.setPointerCapture(e.pointerId);
                    updateCursorFromPointer(e.clientX, e.clientY);
                  }}
                  onPointerMove={(e) => {
                    if (expression === '0') return;
                    if (!isDraggingCursor.current && e.buttons === 0) return;
                    isDraggingCursor.current = true;
                    updateCursorFromPointer(e.clientX, e.clientY);
                  }}
                  onPointerUp={(e) => {
                    isDraggingCursor.current = false;
                    if (expressionScrollRef.current?.hasPointerCapture(e.pointerId)) {
                      expressionScrollRef.current.releasePointerCapture(e.pointerId);
                    }
                  }}
                  onPointerCancel={(e) => {
                    isDraggingCursor.current = false;
                    if (expressionScrollRef.current?.hasPointerCapture(e.pointerId)) {
                      expressionScrollRef.current.releasePointerCapture(e.pointerId);
                    }
                  }}
                >
                  <div
                    className={`min-h-full w-full flex flex-col ${expressionBreakAtPlus ? 'justify-start' : 'justify-end'}`}
                  >
                    <pre
                      ref={displayContentRef}
                      className={`calc-expression-display font-num-light w-full max-w-full break-all ${isLight ? 'text-black' : 'text-white'}`}
                      style={{
                        fontSize: `${displayFontSize}px`,
                        color: isLight ? '#000000' : '#ffffff',
                        transition: 'font-size 0.2s ease-out',
                        letterSpacing: '-0.03em',
                        lineHeight: expressionLineHeight,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        margin: 0,
                        textAlign: expressionBreakAtPlus ? 'left' : 'right',
                      }}
                    >
                      {expression === '0' ? (
                        <span
                          key={`caret-empty-${expressionCursorPos}`}
                          data-expression-cursor
                          className="inline-block align-middle animate-blink bg-current cursor-grab active:cursor-grabbing touch-none"
                          style={{
                            width: '3px',
                            height: `${displayFontSize * 1.05}px`,
                            opacity: 0.9,
                          }}
                          role="slider"
                          aria-label="Move cursor"
                          aria-valuemin={0}
                          aria-valuemax={1}
                          aria-valuenow={expressionCursorPos}
                        />
                      ) : (
                        (() => {
                          let charOffset = 0;
                          return expressionRenderSlices.map((slice, idx) => {
                            const sliceEnd = charOffset + slice.text.length;
                            const lineBreakAfter =
                              expressionBreakAtPlus && sliceEnd > 0 && expression[sliceEnd - 1] === '+';
                            charOffset = sliceEnd;
                            return (
                          <React.Fragment key={`${idx}-${slice.text}-${slice.showCursorAfter}`}>
                            {slice.role === 'price' ? (
                              <span
                                className={
                                  slice.unidentified
                                    ? 'calc-unidentified-price font-num-bold'
                                    : 'font-num-bold'
                                }
                                style={
                                  slice.unidentified && unidentifiedPriceBlinkRed
                                    ? { color: '#ef4444' }
                                    : undefined
                                }
                              >
                                {slice.text}
                              </span>
                            ) : slice.role === 'quantity' || slice.role === 'separator' ? (
                              <span className="font-num-light">{slice.text}</span>
                            ) : (
                              slice.text
                            )}
                            {slice.showCursorAfter && (
                              <span
                                key={`caret-${expressionCursorPos}-${idx}`}
                                data-expression-cursor
                                className="inline-block align-middle animate-blink bg-current cursor-grab active:cursor-grabbing touch-none"
                                style={{
                                  width: '3px',
                                  height: `${displayFontSize * 1.05}px`,
                                  marginLeft: '-1px',
                                  marginRight: '-1px',
                                  opacity: 0.9,
                                }}
                                role="slider"
                                aria-label="Move cursor"
                                aria-valuemin={0}
                                aria-valuemax={expression.length}
                                aria-valuenow={expressionCursorPos}
                              />
                            )}
                            {lineBreakAfter && <br />}
                          </React.Fragment>
                            );
                          });
                        })()
                      )}
                    </pre>
                  </div>
                </div>
                </div>
              </div>

              {/* Action toolbar */}
              <div
                ref={expressionToolbarRef}
                className={`calc-expression-toolbar relative z-50 isolate shrink-0 flex justify-between gap-1.5 py-[0.34rem] rounded-full border transition-all duration-300 self-center ${isSearchOpen ? 'blur-xl opacity-40' : ''} ${isLight ? 'bg-white border-black/8 text-black' : 'bg-[#141414] border-white/14 text-white'}`}
                style={{
                  width: '80%',
                  marginBottom: isLandscape ? '0.35rem' : '0.5rem',
                  marginTop: isLandscape ? '0.35rem' : '0.15rem',
                  boxShadow: isLight ? '0 4px 16px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)' : '0 4px 16px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.25)',
                }}
              >
                <button onClick={handleUndo} className="flex-1 py-[0.34rem] flex justify-center hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all" title="Undo"><Icons.Undo size={14} /></button>
                <button onClick={handleRedo} className="flex-1 py-[0.34rem] flex justify-center hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all" title="Redo"><Icons.Redo size={14} /></button>
                <button onClick={() => setIsPOSOpen(true)} className="flex-1 py-[0.34rem] flex justify-center hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all" title="Trends"><Icons.Trends size={14} /></button>
                <button onClick={deleteLast} className="flex-1 py-[0.34rem] flex justify-center hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all" title="Delete"><Icons.Delete size={14} /></button>
              </div>
            </div>

            {!isLandscape && (
              <div
                className={`relative z-30 shrink-0 grid grid-cols-4 grid-rows-5 min-h-0 overflow-hidden transition-opacity duration-300 ${isSearchOpen ? 'blur-xl opacity-40' : ''}`}
                style={{
                  flex: '1.3 0 0%',
                  gap: keypadGap,
                  paddingLeft: keypadEdge,
                  paddingRight: keypadEdge,
                  paddingBottom: keypadEdge,
                  transform: `translateY(-3%) scale(${keypadScale})`,
                  transformOrigin: 'center bottom',
                }}
              >
                {keypad.map((btn, idx) => (
                  <CalcButton
                    key={`port-${idx}`}
                    label={btn.label}
                    onClick={() => handleKeypad(btn.action)}
                    variant={btn.variant}
                    wide={btn.wide}
                    accentColor={settings.accentColor}
                    isLight={calcIsLight}
                    flat={isFlatCalcSkin}
                    ariaLabel={btn.ariaLabel}
                    large={disableCard}
                  />
                ))}
              </div>
            )}
          </div>

          <InvoiceDragHandle
            disabled={!isCalculatorActive || isAnyModalOpen}
            edgePinned
            onDragOpen={() => {
              if (!isCalculatorActive) return;
              triggerHaptic();
              setIsHistoryOpen(true);
            }}
          />

        </div>
      </div>

      {/* Full-screen over blurred idle/autoswipe wallpaper */}
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={closeSettings}
        focusSectionIndex={settingsSectionIndex}
        settings={settings}
        isLight={isLight}
        updateSettings={handleUpdateSettings}
        cartItems={cartItems}
        runningTotal={parseFloat(runningTotal) || 0}
        invoiceName={invoiceName}
        currency={settings.currency}
        accountUsername={account?.username}
        onChangePassword={handleChangePassword}
        onLogout={handleLogout}
        onVerifyAdminPassword={handleVerifyAdminPassword}
        notifications={accountNotifications.items}
        notificationsUnreadCount={accountNotifications.unreadCount}
        onMarkNotificationsRead={accountNotifications.markRead}
      />

      <HistoryPanel
        isOpen={isHistoryOpen && isCalculatorActive}
        onClose={() => setIsHistoryOpen(false)}
        isLight={isLight}
        wallpapers={settings.customWallpapers}
        currency={settings.currency}
        invoiceName={invoiceName}
        onInvoiceNameChange={setInvoiceName}
        cartItems={cartItems}
        actionLogs={actionLogs}
        runningTotal={runningTotal}
        printLogs={printLogs}
        profiles={settings.profiles ?? []}
        activeProfileId={settings.activeProfileId ?? ''}
        onInvoicePrinted={handleDrawerInvoicePrinted}
        onSelectInvoice={handleSelectInvoice}
        switcherMode={
          settings.invoiceSwitcherMode === 'list' ? 'list' : 'horizontal'
        }
        onSwitcherModeChange={(mode) =>
          updateSettings({
            invoiceSwitcherMode: mode === 'list' ? 'list' : 'horizontal',
          })
        }
        onActiveChange={setIsHistoryPanelActive}
        shareReceiptSettings={{
          layoutMode: settings.receiptLayoutMode ?? 'summary',
        }}
        businessName={settings.businessName ?? ''}
        businessPhone={settings.businessPhone ?? ''}
        businessAddress={settings.businessAddress ?? ''}
      />
      <POSDashboard
        history={history}
        items={items}
        setItems={setItems}
        purchases={purchases}
        setPurchases={setPurchases}
        suppliers={suppliers}
        setSuppliers={setSuppliers}
        requests={requests}
        setRequests={setRequests}
        restocks={restocks}
        setRestocks={setRestocks}
        wholesales={wholesales}
        activeWholesaleId={activeWholesaleId}
        setActiveWholesaleId={setActiveWholesaleId}
        renameWholesale={renameWholesale}
        addWholesale={addWholesale}
        archivedWholesales={archivedWholesales}
        archiveWholesale={archiveWholesale}
        restoreWholesale={restoreWholesale}
        invoiceActionLogs={actionLogs}
        invoiceName={invoiceName}
        cartItems={cartItems}
        runningTotal={runningTotal}
        printLogs={printLogs}
        currency={settings.currency}
        isOpen={isPOSOpen}
        onClose={() => setIsPOSOpen(false)}
        isLight={isLight}
        accentColor={settings.accentColor}
        formatCurrency={formatCurrency}
        settings={settings}
        updateSettings={handleUpdateSettings}
        onInvoicePrinted={handleDrawerInvoicePrinted}
        onResolveUnidentifiedPrice={resolveUnidentifiedPrice}
        canViewTransactions={canViewTransactions}
        accountUsername={account?.username}
        accountId={account?.id ?? null}
        onChangePassword={handleChangePassword}
        onLogout={handleLogout}
        onVerifyAdminPassword={handleVerifyAdminPassword}
        onAccountNotify={handleAccountNotify}
      />
      {isUnlocked && <AccountToastHost isLight={isLight} api={accountNotifications} />}
      <SyncStatusIndicator
        syncState={syncStatus.syncState}
        isLight={isLight}
        onRetry={syncStatus.retryAllFailed}
      />
      </>
      )}
      {isAdminPortal && adminSessionToken && (
        <AdminCodeDashboard
          isLight={isLight}
          adminToken={adminSessionToken}
          adminProfile={
            (settings.profiles ?? []).find((p) => isAdminProfile(p)) ?? createAdminProfile()
          }
          onClose={() => {
            closeAdminPortal();
            if (account) {
              openCalculatorHome({ animate: false });
            } else {
              setAuthOverlayMounted(true);
              setIsUnlocked(false);
            }
          }}
          onReturnToCalc={handleAdminReturnToCalc}
        />
      )}
    </div>
  );
};

const App: React.FC = () => (
  <ErrorBoundary
    fallback={(error, retry) => (
      <div className="flex items-center justify-center h-dvh w-full bg-black p-4">
        <div className="max-w-md text-center text-white">
          <h1 className="text-2xl font-bold mb-4">⚠️ App Error</h1>
          <p className="text-gray-300 mb-6 font-mono text-sm wrap-break-word">
            {error.message}
          </p>
          <button
            onClick={retry}
            aria-label="Retry application"
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            Retry
          </button>
        </div>
      </div>
    )}
  >
    <AppContent />
  </ErrorBoundary>
);

export default App;
