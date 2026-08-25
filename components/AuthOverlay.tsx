import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import icalcLogo from '../assets/logo/icalc-logo.png';
import { Icons } from '../constants';
import { STANDBY_TIMER_OPTIONS } from '../hooks/useStandby';
import { AppAccount } from '../utils/auth';
import {
  checkAccessCodeStatus,
  fetchAccessCodeBusinessInfo,
  fetchMyShopTelegram,
  subscribeAccessStatus,
  type AccessBusinessInfo,
} from '../utils/accessControl';
import BusinessInfoReceiptCard from './BusinessInfoReceiptCard';
import FluidSegmentControl from './FluidSegmentControl';
import { MorphCrossfade } from './MorphCrossfade';
import PasswordField from './PasswordField';
import { supabase } from '../utils/supabase';
import { FORM_FIELD_LABEL, formInputClass } from '../utils/formFields';
import {
  applyShopTelegramLocally,
  bindAccountToOwnerTelegram,
  hasOwnerTelegramLink,
  isTelegramDbConnected,
} from '../utils/telegramDb';

/** Silently apply shop Telegram saved by admin on approve — shops never paste Bot API. */
async function ensureShopTelegramLinked(
  accountId: string,
  fromApprove?: { botToken?: string; chatId?: string } | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!accountId) return { ok: false, error: 'Not signed in.' };
  if (isTelegramDbConnected(accountId)) return { ok: true };
  if (hasOwnerTelegramLink()) {
    bindAccountToOwnerTelegram(accountId);
    return { ok: true };
  }
  const token = fromApprove?.botToken?.trim() ?? '';
  const chatId = fromApprove?.chatId?.trim() ?? '';
  if (token && chatId) {
    applyShopTelegramLocally(accountId, token, chatId);
    return { ok: true };
  }
  const remote = await fetchMyShopTelegram();
  if (remote.ok) {
    applyShopTelegramLocally(accountId, remote.botToken, remote.chatId);
    return { ok: true };
  }
  return {
    ok: false,
    error: 'Telegram not linked yet. Admin must set Bot API + chat ID when approving.',
  };
}

type AuthMode = 'signup' | 'login';
type AuthPane = 'idle' | 'auth' | 'settings';

/** Cap artificial loading/hold delays (real network time can still run longer). */
const AUTH_MIN_LOADING_MS = 600;
const AUTH_SIGNUP_LOADING_MS = 600;
const AUTH_ADMIN_PORTAL_LOADING_MS = 600;
const AUTH_SUCCESS_HOLD_MS = 600;
const AUTH_MODE_MS = 200;
const EDGE_ZONE_PX = 56;
const EDGE_SWIPE_MIN = 48;
const TAP_THRESHOLD = 14;

const LOCK_SETTINGS_SECTIONS = ['idle', 'appearance', 'layout'] as const;
type LockSettingsSection = (typeof LOCK_SETTINGS_SECTIONS)[number];

interface AuthSettingsSlice {
  themeMode: 'light' | 'dark' | 'system';
  layoutMode?: 'portrait' | 'landscape';
  standbyTimerSeconds?: number;
  businessName?: string;
  businessPhone?: string;
  businessAddress?: string;
  accountPlan?: 'premium' | 'regular';
}

type AuthLoadingPhase =
  | 'default'
  | 'admin_breached'
  | 'waiting_approval'
  | 'access_paused'
  | 'access_denied';

interface AuthResult {
  error?: string;
  account?: AppAccount;
  pendingEmailConfirmation?: boolean;
  confirmationEmail?: string;
  pendingApproval?: boolean;
  accessCode?: string;
  username?: string;
  adminPortal?: boolean;
  paused?: boolean;
}

interface AuthOverlayProps {
  isLight: boolean;
  mode?: AuthMode;
  defaultUsername?: string;
  existingAccount?: AppAccount | null;
  settings?: AuthSettingsSlice;
  updateSettings?: (patch: Partial<AuthSettingsSlice>) => void;
  onSignup: (username: string, email: string, inviteCode: string) => Promise<AuthResult>;
  onLogin: (username: string, password: string) => Promise<AuthResult>;
  onAuthComplete: (account: AppAccount) => void;
  onAdminPortal?: () => void;
  onFinalizeAccess?: (accessCode: string, username: string) => Promise<AuthResult>;
  onDevSkip?: () => Promise<{
    account?: AppAccount;
    adminPortal?: true;
    error?: string;
  } | null | undefined>;
  onQuickUnlock?: () => void;
  onExitComplete?: () => void;
}

const AuthOverlay: React.FC<AuthOverlayProps> = ({
  isLight,
  mode: initialMode = 'signup',
  defaultUsername = '',
  existingAccount = null,
  settings,
  updateSettings,
  onSignup,
  onLogin,
  onAuthComplete,
  onAdminPortal,
  onFinalizeAccess,
  onDevSkip,
  onQuickUnlock,
  onExitComplete,
}) => {
  const isDev = import.meta.env.DEV;
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [time, setTime] = useState(new Date());
  const [username, setUsername] = useState(defaultUsername);
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEntering, setIsEntering] = useState(false);
  const [pane, setPane] = useState<AuthPane>('idle');
  const [settingsSectionIndex, setSettingsSectionIndex] = useState(0);
  const [settingsAnimKey, setSettingsAnimKey] = useState(0);
  const [authCardAnimKey, setAuthCardAnimKey] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  const [signupConfirmation, setSignupConfirmation] = useState<{ email: string } | null>(null);
  const [businessSetup, setBusinessSetup] = useState<{ accessCode: string; username: string } | null>(null);
  const [receivedBusinessInfo, setReceivedBusinessInfo] = useState<AccessBusinessInfo | null>(null);
  const [businessInfoLoading, setBusinessInfoLoading] = useState(false);
  const [adminInfoName, setAdminInfoName] = useState('');
  const [adminInfoPhone, setAdminInfoPhone] = useState('');
  const [adminInfoAddress, setAdminInfoAddress] = useState('');
  const [loadingPhase, setLoadingPhase] = useState<AuthLoadingPhase>('default');
  const pendingPollRef = useRef<number | null>(null);
  const pendingUnsubscribeRef = useRef<(() => void) | null>(null);
  const pausedPollRef = useRef<number | null>(null);
  const pointerStart = useRef<{ x: number; y: number; edge: 'left' | 'right' | null } | null>(null);
  const authBodyShellRef = useRef<HTMLDivElement>(null);
  const authBodyMeasureRef = useRef<HTMLDivElement>(null);
  const authHeightAnimRef = useRef<number | null>(null);
  const settledBodyHeightRef = useRef(0);
  const prevErrorRef = useRef<string | null>(null);
  const [modeFieldsOut, setModeFieldsOut] = useState(false);
  const [cardModePulse, setCardModePulse] = useState(false);

  const isLoading = isSubmitting || isEntering;
  const showSignupInsight = signupConfirmation !== null;
  const showBusinessSetup = businessSetup !== null;
  const isIdle = pane === 'idle' && !isLoading && !showBusinessSetup;
  const showAuthForm = pane === 'auth' && !showBusinessSetup;
  const showSettings = pane === 'settings' && !showBusinessSetup;
  const settingsSection: LockSettingsSection =
    LOCK_SETTINGS_SECTIONS[settingsSectionIndex % LOCK_SETTINGS_SECTIONS.length];

  const loadingLabel = (() => {
    if (loadingPhase === 'admin_breached') return 'admin breached';
    if (loadingPhase === 'waiting_approval') return 'waiting for admin to grant access';
    if (loadingPhase === 'access_paused') return 'account paused';
    if (loadingPhase === 'access_denied') return 'access denied';
    if (isEntering) return 'Welcome back…';
    if (mode === 'signup') return 'Creating your account…';
    return 'Signing in…';
  })();

  const loadingSubtext = (() => {
    if (loadingPhase === 'admin_breached') return 'Opening admin profile dashboard';
    if (loadingPhase === 'waiting_approval') return 'Stay on this screen — access refreshes automatically';
    if (loadingPhase === 'access_paused') return 'Stay on this screen — signing in when access is restored';
    if (loadingPhase === 'access_denied') return 'This request was not approved';
    if (isEntering) return 'Opening your workspace';
    if (mode === 'signup') return 'Setting up your account';
    return 'Verifying credentials';
  })();

  const signupLoadingDurationMs =
    loadingPhase === 'waiting_approval' || loadingPhase === 'access_paused'
      ? AUTH_SIGNUP_LOADING_MS
      : mode === 'signup'
        ? AUTH_SIGNUP_LOADING_MS
        : AUTH_MIN_LOADING_MS;

  const loadingBarDurationMs =
    loadingPhase === 'admin_breached'
      ? AUTH_ADMIN_PORTAL_LOADING_MS
      : signupLoadingDurationMs;

  const useTimedLoadingBar =
    isSubmitting &&
    (loadingPhase === 'admin_breached' ||
      mode === 'signup' ||
      loadingPhase === 'waiting_approval' ||
      loadingPhase === 'access_paused');

  const stopPausedWatch = useCallback(() => {
    if (pausedPollRef.current !== null) {
      window.clearInterval(pausedPollRef.current);
      pausedPollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPausedWatch();
      if (pendingPollRef.current !== null) {
        window.clearInterval(pendingPollRef.current);
      }
      pendingUnsubscribeRef.current?.();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setUsername(defaultUsername);
  }, [defaultUsername]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  /** Smoothly animate auth form shell height to match measured content. */
  const animateAuthBodyHeight = useCallback((fromHeight?: number) => {
    const shell = authBodyShellRef.current;
    const measure = authBodyMeasureRef.current;
    if (!shell || !measure) return;

    if (authHeightAnimRef.current !== null) {
      window.clearTimeout(authHeightAnimRef.current);
      authHeightAnimRef.current = null;
    }

    const measuredFrom = measure.getBoundingClientRect().height;
    const lockedHeight =
      shell.style.height && shell.style.height !== 'auto'
        ? parseFloat(shell.style.height)
        : NaN;
    const from =
      fromHeight ??
      (settledBodyHeightRef.current > 0
        ? settledBodyHeightRef.current
        : Number.isFinite(lockedHeight)
          ? lockedHeight
          : measuredFrom);
    const to = measure.scrollHeight;

    if (Math.abs(to - from) < 1) {
      shell.style.height = 'auto';
      shell.style.overflow = '';
      shell.classList.remove('auth-mode-shell--animating');
      settledBodyHeightRef.current = to;
      return;
    }

    shell.style.overflow = 'hidden';
    shell.style.height = `${from}px`;
    shell.classList.remove('auth-mode-shell--animating');

    // Force reflow so the browser registers the start height before transitioning.
    void shell.offsetHeight;

    shell.classList.add('auth-mode-shell--animating');
    shell.style.height = `${to}px`;

    authHeightAnimRef.current = window.setTimeout(() => {
      shell.classList.remove('auth-mode-shell--animating');
      shell.style.height = 'auto';
      shell.style.overflow = '';
      settledBodyHeightRef.current = measure.scrollHeight;
      authHeightAnimRef.current = null;
    }, AUTH_MODE_MS + 40);
  }, []);

  const handleAuthModeChange = useCallback(
    (next: AuthMode) => {
      if (next === mode) return;

      const shell = authBodyShellRef.current;
      const measure = authBodyMeasureRef.current;
      const fromHeight =
        measure?.getBoundingClientRect().height ?? settledBodyHeightRef.current;

      if (shell && fromHeight > 0) {
        shell.style.overflow = 'hidden';
        shell.style.height = `${fromHeight}px`;
        settledBodyHeightRef.current = fromHeight;
      }

      setModeFieldsOut(true);
      setCardModePulse(true);
      setError(null);
      setSecret('');
      setEmail('');
      setMode(next);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          animateAuthBodyHeight(fromHeight);
          // Brief settle so the content ease-in is visible after the mode swap.
          window.setTimeout(() => setModeFieldsOut(false), 50);
          window.setTimeout(() => setCardModePulse(false), AUTH_MODE_MS);
        });
      });
    },
    [mode, animateAuthBodyHeight]
  );

  // Record settled height when the auth form first mounts / becomes visible.
  useLayoutEffect(() => {
    if (!showAuthForm) return;
    const measure = authBodyMeasureRef.current;
    if (!measure || authHeightAnimRef.current !== null) return;
    settledBodyHeightRef.current = measure.scrollHeight;
  }, [showAuthForm]);

  // Smooth card resize when error text appears/clears.
  useLayoutEffect(() => {
    if (!showAuthForm) return;
    const hadError = Boolean(prevErrorRef.current);
    const hasError = Boolean(error);
    if (prevErrorRef.current === error) return;
    prevErrorRef.current = error;
    if (hadError === hasError) return;
    animateAuthBodyHeight(settledBodyHeightRef.current);
  }, [error, showAuthForm, animateAuthBodyHeight]);

  useEffect(() => {
    return () => {
      if (authHeightAnimRef.current !== null) {
        window.clearTimeout(authHeightAnimRef.current);
      }
    };
  }, []);

  const textColor = isLight ? '#000' : '#fff';
  const panelClass = isLight
    ? 'bg-white/80 border-black/10 text-black'
    : 'pos-dashboard-card-glass border border-white/12 text-white';

  const settingsCardClass = isLight
    ? 'bg-white/85 border-black/10 text-black'
    : 'pos-dashboard-card-glass border border-white/12 text-white';

  const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  const revealAuthForm = useCallback(() => {
    // Already signed in (lock screen): never open signup/login — unlock instead.
    if (existingAccount) {
      if (!isLoading && !isExiting) {
        setIsExiting(true);
        if ('vibrate' in navigator) navigator.vibrate([10, 30]);
        onQuickUnlock?.();
      }
      return;
    }
    if (pane === 'auth' || isLoading) return;
    setPane('auth');
    setAuthCardAnimKey((k) => k + 1);
    if ('vibrate' in navigator) navigator.vibrate(10);
  }, [existingAccount, pane, isLoading, isExiting, onQuickUnlock]);

  const openSettings = useCallback((sectionIndex = 0) => {
    if (isLoading) return;
    setSettingsSectionIndex(sectionIndex);
    setSettingsAnimKey((k) => k + 1);
    setPane('settings');
    if ('vibrate' in navigator) navigator.vibrate(10);
  }, [isLoading]);

  const cycleSettingsSection = useCallback(() => {
    if (!showSettings || isLoading) return;
    setSettingsSectionIndex((i) => (i + 1) % LOCK_SETTINGS_SECTIONS.length);
    setSettingsAnimKey((k) => k + 1);
    if ('vibrate' in navigator) navigator.vibrate(8);
  }, [showSettings, isLoading]);

  const returnToIdle = useCallback(() => {
    if (isLoading) return;
    setPane('idle');
    setError(null);
  }, [isLoading]);

  const initiateCalculator = useCallback(() => {
    if (isLoading || isExiting || !existingAccount) return;
    setIsExiting(true);
    if ('vibrate' in navigator) navigator.vibrate([10, 30]);
    onQuickUnlock?.();
  }, [existingAccount, isLoading, isExiting, onQuickUnlock]);

  const handleContinue = useCallback(() => {
    if (existingAccount) {
      initiateCalculator();
      return;
    }
    revealAuthForm();
  }, [existingAccount, initiateCalculator, revealAuthForm]);

  const handleRightEdgeSwipe = useCallback(() => {
    if (showSettings) {
      cycleSettingsSection();
      return;
    }
    if (pane === 'auth') {
      openSettings(0);
      return;
    }
    openSettings(0);
  }, [showSettings, pane, cycleSettingsSection, openSettings]);

  const handleLeftEdgeSwipe = useCallback(() => {
    if (showSettings || pane === 'auth') {
      returnToIdle();
      return;
    }
    initiateCalculator();
  }, [showSettings, pane, returnToIdle, initiateCalculator]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (isLoading) return;
    const width = window.innerWidth;
    const x = e.clientX;
    let edge: 'left' | 'right' | null = null;
    if (x <= EDGE_ZONE_PX) edge = 'left';
    else if (x >= width - EDGE_ZONE_PX) edge = 'right';
    pointerStart.current = { x, y: e.clientY, edge };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointerStart.current || isLoading) {
      pointerStart.current = null;
      return;
    }

    const dx = e.clientX - pointerStart.current.x;
    const dy = e.clientY - pointerStart.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const horizontal = Math.abs(dx) > Math.abs(dy);

    if (pointerStart.current.edge === 'right' && horizontal && dx <= -EDGE_SWIPE_MIN) {
      handleRightEdgeSwipe();
    } else if (pointerStart.current.edge === 'left' && horizontal && dx >= EDGE_SWIPE_MIN) {
      handleLeftEdgeSwipe();
    } else if (isIdle && !pointerStart.current.edge && (dist <= TAP_THRESHOLD || dist >= EDGE_SWIPE_MIN)) {
      handleContinue();
    }

    pointerStart.current = null;
  };

  const onPointerCancel = () => {
    pointerStart.current = null;
  };

  /** After admin session is opened: go straight to generate-code page (Bot API is set on approve only). */
  const finishAdminPortalEntry = useCallback(async () => {
    setLoadingPhase('admin_breached');
    if ('vibrate' in navigator) navigator.vibrate([20, 40, 20]);
    await wait(AUTH_ADMIN_PORTAL_LOADING_MS);
    setIsSubmitting(false);
    setLoadingPhase('default');
    onAdminPortal?.();
  }, [onAdminPortal, wait]);

  const handleDevSkip = useCallback(async () => {
    if (!isDev || isLoading || isExiting || !onDevSkip) return;
    // Skip → calculator only (never Bot API paste, never generate-code page).

    flushSync(() => {
      setIsSubmitting(true);
      setError(null);
    });

    try {
      const result = await onDevSkip();
      if (result?.error) {
        setIsSubmitting(false);
        setError(result.error);
        return;
      }
      if (result?.account) {
        if (hasOwnerTelegramLink()) {
          bindAccountToOwnerTelegram(result.account.id);
        }
        flushSync(() => setIsEntering(true));
        if ('vibrate' in navigator) navigator.vibrate([10, 30]);
        await wait(AUTH_SUCCESS_HOLD_MS);
        flushSync(() => {
          setIsEntering(false);
          setIsSubmitting(false);
          setIsExiting(true);
        });
        onAuthComplete(result.account);
        return;
      }
      setIsSubmitting(false);
      setError('Dev skip did not return a session.');
    } catch {
      setIsSubmitting(false);
      setError('Could not skip auth in dev.');
    }
  }, [isDev, isLoading, isExiting, onDevSkip, onAuthComplete, wait]);

  const dismissSignupConfirmation = useCallback(() => {
    const confirmedEmail = signupConfirmation?.email ?? '';
    setSignupConfirmation(null);
    setSecret('');
    setMode('login');
    setError(null);
    if (confirmedEmail) setUsername(confirmedEmail);
    if ('vibrate' in navigator) navigator.vibrate(8);
  }, [signupConfirmation?.email]);

  const stopPendingWatch = useCallback(() => {
    if (pendingPollRef.current !== null) {
      window.clearInterval(pendingPollRef.current);
      pendingPollRef.current = null;
    }
    pendingUnsubscribeRef.current?.();
    pendingUnsubscribeRef.current = null;
  }, []);

  const completeAccessGrant = useCallback(
    async (accessCode: string, pendingUsername: string) => {
      if (!onFinalizeAccess) return;
      const finalized = await onFinalizeAccess(accessCode, pendingUsername);
      if (finalized.error || !finalized.account) {
        setIsSubmitting(false);
        setLoadingPhase('default');
        setError(finalized.error ?? 'Could not complete access.');
        return;
      }
      flushSync(() => {
        setIsEntering(true);
        setLoadingPhase('default');
      });
      if ('vibrate' in navigator) navigator.vibrate([10, 30]);
      await wait(AUTH_SUCCESS_HOLD_MS);
      flushSync(() => {
        setIsEntering(false);
        setIsSubmitting(false);
        setIsExiting(true);
        setBusinessSetup(null);
      });
      onAuthComplete(finalized.account);
    },
    [onAuthComplete, onFinalizeAccess]
  );

  useEffect(() => {
    if (!businessSetup) {
      setReceivedBusinessInfo(null);
      setBusinessInfoLoading(false);
      setAdminInfoName('');
      setAdminInfoPhone('');
      setAdminInfoAddress('');
      return;
    }

    let cancelled = false;
    setBusinessInfoLoading(true);
    setError(null);

    void fetchAccessCodeBusinessInfo(businessSetup.accessCode).then((result) => {
      if (cancelled) return;
      const info: AccessBusinessInfo =
        result.ok === true
          ? result.info
          : { businessName: '', businessPhone: '', businessAddress: '' };
      setReceivedBusinessInfo(info);
      setAdminInfoName(info.businessName);
      setAdminInfoPhone(info.businessPhone);
      setAdminInfoAddress(info.businessAddress);
      if (result.ok === false) {
        setError(null);
      }
      setBusinessInfoLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [businessSetup]);

  /** After approve: save business details + silently apply Telegram admin already set. */
  const finishWithBusinessAccount = useCallback(
    async (account: AppAccount) => {
      const name = adminInfoName.trim();
      if (!name) {
        setError('Business name is required.');
        return;
      }

      setError(null);
      setIsSubmitting(true);

      const linked = await ensureShopTelegramLinked(account.id, {
        botToken: receivedBusinessInfo?.telegramBotToken,
        chatId: receivedBusinessInfo?.telegramChatId,
      });
      if (linked.ok === false) {
        setIsSubmitting(false);
        setError(linked.error);
        return;
      }

      let accountPlan: 'premium' | 'regular' =
        settings?.accountPlan === 'premium' ? 'premium' : 'regular';
      try {
        const { data: planRow } = await supabase
          .from('user_settings')
          .select('account_plan')
          .eq('user_id', account.id)
          .maybeSingle();
        if (planRow?.account_plan === 'premium') accountPlan = 'premium';
      } catch {
        // keep current
      }

      updateSettings?.({
        businessName: name,
        businessPhone: adminInfoPhone.trim(),
        businessAddress: adminInfoAddress.trim(),
        accountPlan,
      });

      flushSync(() => {
        setIsEntering(true);
        setLoadingPhase('default');
      });
      if ('vibrate' in navigator) navigator.vibrate([10, 30]);
      await wait(AUTH_SUCCESS_HOLD_MS);
      flushSync(() => {
        setIsEntering(false);
        setIsSubmitting(false);
        setIsExiting(true);
        setBusinessSetup(null);
      });
      onAuthComplete(account);
    },
    [
      adminInfoName,
      adminInfoPhone,
      adminInfoAddress,
      receivedBusinessInfo,
      updateSettings,
      onAuthComplete,
      settings?.accountPlan,
      wait,
    ]
  );

  const handleBusinessReceiveContinue = useCallback(async () => {
    if (!businessSetup) return;

    setError(null);
    setIsSubmitting(true);

    if (!onFinalizeAccess) {
      setIsSubmitting(false);
      setError('Cannot complete access.');
      return;
    }
    const finalized = await onFinalizeAccess(businessSetup.accessCode, businessSetup.username);
    if (finalized.error || !finalized.account) {
      setIsSubmitting(false);
      setError(finalized.error ?? 'Could not complete access.');
      return;
    }

    await finishWithBusinessAccount(finalized.account);
  }, [businessSetup, onFinalizeAccess, finishWithBusinessAccount]);

  const handleAccessStatus = useCallback(
    async (accessCode: string, pendingUsername: string, status: string) => {
      if (status === 'approved' && onFinalizeAccess) {
        stopPendingWatch();
        setIsSubmitting(false);
        setLoadingPhase('default');
        setReceivedBusinessInfo(null);
        setBusinessSetup({ accessCode, username: pendingUsername });
        setPane('auth');
        setAuthCardAnimKey((k) => k + 1);
        if ('vibrate' in navigator) navigator.vibrate([12, 40, 12]);
        return;
      }

      if (status === 'denied' || status === 'unused') {
        stopPendingWatch();
        setLoadingPhase('access_denied');
        await wait(600);
        setIsSubmitting(false);
        setLoadingPhase('default');
        setError('Access was denied.');
      }
    },
    [onFinalizeAccess, stopPendingWatch]
  );

  const startPausedAccessWatch = useCallback(
    (loginIdentifier: string, loginPassword: string) => {
      stopPausedWatch();
      const attempt = async () => {
        const result = await onLogin(loginIdentifier, loginPassword);
        if (result.account) {
          stopPausedWatch();
          stopPendingWatch();
          setLoadingPhase('default');
          await ensureShopTelegramLinked(result.account.id);
          flushSync(() => setIsEntering(true));
          if ('vibrate' in navigator) navigator.vibrate([10, 30]);
          await wait(AUTH_SUCCESS_HOLD_MS);
          flushSync(() => {
            setIsEntering(false);
            setIsSubmitting(false);
            setIsExiting(true);
          });
          onAuthComplete(result.account);
          return;
        }
        if (result.error && !result.paused && !result.pendingApproval) {
          stopPausedWatch();
          setLoadingPhase('default');
          setIsSubmitting(false);
          setError(result.error);
        }
      };
      void attempt();
      pausedPollRef.current = window.setInterval(() => void attempt(), 3000);
    },
    [onAuthComplete, onLogin, stopPausedWatch, stopPendingWatch]
  );

  const startPendingApprovalWatch = useCallback(
    (accessCode: string, pendingUsername: string) => {
      stopPendingWatch();
      stopPausedWatch();

      const poll = async () => {
        const status = await checkAccessCodeStatus(accessCode);
        if (!status.ok) return;
        await handleAccessStatus(accessCode, pendingUsername, status.status);
      };

      void poll();

      void supabase.auth.getSession().then(({ data }) => {
        const userId = data.session?.user.id;
        if (userId) {
          pendingUnsubscribeRef.current = subscribeAccessStatus(userId, (status) => {
            void handleAccessStatus(accessCode, pendingUsername, status);
          });
        }
        pendingPollRef.current = window.setInterval(() => void poll(), userId ? 15000 : 3000);
      });
    },
    [handleAccessStatus, stopPendingWatch]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || isEntering || showSignupInsight || showBusinessSetup) return;
    setError(null);
    setSignupConfirmation(null);
    setLoadingPhase('default');

    flushSync(() => {
      setIsSubmitting(true);
    });

    const startedAt = Date.now();
    const minLoadingMs = mode === 'signup' ? AUTH_SIGNUP_LOADING_MS : AUTH_MIN_LOADING_MS;

    try {
      // Admin portal: only probe when password looks like the admin code (not every login).
      const secretTrim = secret.trim();
      const looksLikeAdminCode =
        secretTrim.toLowerCase().startsWith('irocky-stack') ||
        (import.meta.env.DEV && secretTrim === '1234');
      if (mode === 'login' && looksLikeAdminCode) {
        const backdoorProbe = await onLogin('', secret);
        if (backdoorProbe.adminPortal) {
          await finishAdminPortalEntry();
          return;
        }
      }

      const result =
        mode === 'signup'
          ? await onSignup(username, email, secret)
          : await onLogin(username, secret);

      if (result.error) {
        setIsSubmitting(false);
        setError(result.error);
        return;
      }

      if (result.paused) {
        setLoadingPhase('access_paused');
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, AUTH_MIN_LOADING_MS - elapsed);
        if (remaining > 0) await wait(remaining);
        startPausedAccessWatch(username.trim(), secret);
        return;
      }

      if (result.pendingApproval && result.accessCode) {
        setLoadingPhase('waiting_approval');
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, AUTH_SIGNUP_LOADING_MS - elapsed);
        if (remaining > 0) await wait(remaining);
        startPendingApprovalWatch(result.accessCode, result.username ?? username.trim());
        return;
      }

      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, minLoadingMs - elapsed);
      if (remaining > 0) await wait(remaining);

      if (result.pendingEmailConfirmation) {
        setIsSubmitting(false);
        setSignupConfirmation({
          email: result.confirmationEmail ?? (email.trim() || username.trim()),
        });
        if ('vibrate' in navigator) navigator.vibrate([12, 40, 12]);
        return;
      }

      if (!result.account) {
        setIsSubmitting(false);
        setError('Could not complete sign in. Please try again.');
        return;
      }

      // Returning login: silently pull Telegram admin saved on approve (never paste).
      await ensureShopTelegramLinked(result.account.id);

      flushSync(() => {
        setIsEntering(true);
      });

      if ('vibrate' in navigator) navigator.vibrate([10, 30]);
      await wait(AUTH_SUCCESS_HOLD_MS);

      flushSync(() => {
        setIsEntering(false);
        setIsSubmitting(false);
        setIsExiting(true);
      });
      onAuthComplete(result.account);
    } catch {
      setIsSubmitting(false);
      setLoadingPhase('default');
      setError('Something went wrong. Please try again.');
    }
  };

  const renderSettingsSection = () => {
    if (!settings || !updateSettings) return null;

    if (settingsSection === 'idle') {
      return (
        <div className="space-y-3">
          <p className="app-subtext text-[10px] opacity-50">Standby timer before the idle screen returns.</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {STANDBY_TIMER_OPTIONS.map((option) => {
              const isActive = (settings.standbyTimerSeconds ?? 0) === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateSettings({ standbyTimerSeconds: option.value })}
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
      );
    }

    if (settingsSection === 'appearance') {
      return (
        <div className="flex justify-center">
          <FluidSegmentControl
            isLight={isLight}
            ariaLabel="Theme mode"
            value={settings.themeMode}
            onChange={(themeMode) => updateSettings({ themeMode })}
            options={[
              { id: 'light', label: 'Light' },
              { id: 'dark', label: 'Dark' },
              { id: 'system', label: 'Auto' },
            ]}
          />
        </div>
      );
    }

    const layout = settings.layoutMode ?? 'portrait';
    return (
      <div className="flex flex-col items-center gap-3">
        <p className="app-subtext text-[10px] opacity-50">Calculator orientation</p>
        <FluidSegmentControl
          isLight={isLight}
          ariaLabel="Layout orientation"
          value={layout}
          onChange={(layoutMode) => updateSettings({ layoutMode })}
          options={[
            { id: 'portrait', label: 'Portrait' },
            { id: 'landscape', label: 'Landscape' },
          ]}
        />
      </div>
    );
  };

  const settingsTitle =
    settingsSection === 'idle'
      ? 'Idle Screen'
      : settingsSection === 'appearance'
        ? 'Appearance'
        : 'Layout';

  const settingsIcon =
    settingsSection === 'idle'
      ? <Icons.Moon size={20} />
      : settingsSection === 'appearance'
        ? (isLight ? <Icons.Sun size={20} /> : <Icons.Moon size={20} />)
        : <Icons.Scientific size={20} />;

  const timeString = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <div
      className={`auth-screen fixed inset-0 z-[1000] flex flex-col items-center justify-between p-6 sm:p-12 transition-all duration-700 cubic-bezier(0.16, 1, 0.3, 1) ${!isLoading && !isExiting ? 'touch-none' : ''} ${isExiting ? 'opacity-0 scale-125 pointer-events-none' : 'opacity-100 scale-100'}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onTransitionEnd={() => {
        if (isExiting) onExitComplete?.();
      }}
      role="main"
      aria-busy={isLoading}
    >
      <div className="absolute top-8 left-8 sm:top-12 sm:left-12 flex items-center gap-3 select-none pointer-events-none">
        <div className={`unlock-logo-wrap shrink-0 w-12 h-12 sm:w-14 sm:h-14 ${isLoading ? 'auth-loading-logo' : ''}`}>
          <img src={icalcLogo} alt="iCalc logo" className="w-full h-full object-cover" draggable={false} />
        </div>
        <div className="font-brand text-4xl sm:text-5xl leading-none tracking-tighter font-black" aria-label="iCalc 26">
          <span className="italic text-white font-bold">i</span>
          <span className={isLight ? 'text-black' : 'text-white'}>Calc</span>
          <span className="unlock-brand-26">26</span>
        </div>
      </div>

      <div className={`flex flex-col items-center justify-center flex-1 w-full max-w-sm gap-6 pt-16 ${showAuthForm ? 'pb-24' : 'pb-10'}`}>
        {!showSettings && (
          <div className={`text-center select-none pointer-events-none transition-opacity duration-300 ${isLoading ? 'opacity-40' : 'opacity-100'}`}>
            <p className="font-num-light text-5xl tracking-tighter tabular-nums opacity-80" style={{ color: textColor }}>
              {timeString}
            </p>
            <p className="app-subtext opacity-50 mt-1" style={{ color: textColor }}>
              {time.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
          </div>
        )}

        {showSettings && settings && updateSettings && (
          <div
            key={settingsAnimKey}
            className={`relative w-full rounded-2xl p-6 border shadow-2xl ${settingsCardClass} ${
              settingsAnimKey === 1 ? 'animate-auth-settings-enter' : 'animate-auth-settings-cycle'
            }`}
          >
            <div className="flex items-center justify-center gap-2 mb-4">
              {settingsIcon}
              <h3 className="app-subtext text-sm font-black">{settingsTitle}</h3>
            </div>
            {renderSettingsSection()}
            <div className="flex justify-center gap-1.5 mt-5">
              {LOCK_SETTINGS_SECTIONS.map((section, idx) => (
                <div
                  key={section}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === settingsSectionIndex % LOCK_SETTINGS_SECTIONS.length
                      ? 'w-4 bg-blue-500'
                      : `w-1.5 ${isLight ? 'bg-black/15' : 'bg-white/20'}`
                  }`}
                  aria-hidden="true"
                />
              ))}
            </div>
          </div>
        )}

        {showAuthForm && !existingAccount && (
          <div
            key={authCardAnimKey}
            className={`auth-card-mode relative z-20 w-full rounded-2xl p-6 border shadow-2xl animate-auth-card-enter ${
              cardModePulse ? 'auth-card-mode--pulse' : ''
            } ${panelClass} ${isLoading && !showBusinessSetup ? 'opacity-40 pointer-events-none' : ''}`}
          >
            <FluidSegmentControl
              fullWidth
              isLight={isLight}
              disabled={isLoading || showSignupInsight || showBusinessSetup}
              ariaLabel="Authentication mode"
              className="mb-5 text-[10px] font-black uppercase tracking-widest"
              value={mode}
              onChange={handleAuthModeChange}
              options={[
                { id: 'signup', label: 'Sign up' },
                { id: 'login', label: 'Sign in' },
              ]}
            />

            <div ref={authBodyShellRef} className="auth-mode-shell">
              <div
                ref={authBodyMeasureRef}
                className={`auth-mode-fields ${modeFieldsOut ? 'auth-mode-fields--out' : ''}`}
              >
                <form onSubmit={handleSubmit} className="space-y-3">
                  <label className="block">
                    <span className={FORM_FIELD_LABEL}>
                      <MorphCrossfade
                        active={mode}
                        options={[
                          { id: 'signup', label: 'Username' },
                          { id: 'login', label: 'Username or email' },
                        ]}
                      />
                    </span>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      autoComplete="username"
                      disabled={isLoading || showSignupInsight || showBusinessSetup}
                      className={`${formInputClass(isLight)} transition-all duration-300`}
                      placeholder={mode === 'signup' ? 'Choose a username' : 'Username or email'}
                    />
                  </label>

                  <div
                    className={`auth-mode-collapse ${
                      mode === 'signup' ? 'auth-mode-collapse--open' : 'auth-mode-collapse--closed'
                    }`}
                  >
                    <div className="auth-mode-collapse__inner">
                      <label className="block">
                        <span className={FORM_FIELD_LABEL}>Email</span>
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          autoComplete="email"
                          tabIndex={mode === 'signup' ? 0 : -1}
                          disabled={isLoading || showSignupInsight || mode !== 'signup'}
                          className={formInputClass(isLight)}
                          placeholder="you@example.com"
                        />
                      </label>
                    </div>
                  </div>

                  <label className="block">
                    <span className={FORM_FIELD_LABEL}>
                      <MorphCrossfade
                        active={mode}
                        options={[
                          { id: 'signup', label: 'Signup code' },
                          { id: 'login', label: 'Password' },
                        ]}
                      />
                    </span>
                    <PasswordField
                      isLight={isLight}
                      value={secret}
                      onChange={(value) =>
                        setSecret(mode === 'signup' ? value.toUpperCase() : value)
                      }
                      onKeyDown={(e) => e.stopPropagation()}
                      autoComplete={mode === 'signup' ? 'one-time-code' : 'current-password'}
                      spellCheck={false}
                      maxLength={mode === 'signup' ? 7 : 64}
                      disabled={isLoading || showSignupInsight}
                      mono={mode === 'signup'}
                      inputClassName={`transition-all duration-300 ${mode === 'signup' ? 'tracking-widest' : ''}`}
                      placeholder={mode === 'signup' ? '7-character code' : 'Your password'}
                    />
                  </label>

                  <div
                    className={`auth-mode-collapse ${
                      mode === 'signup' ? 'auth-mode-collapse--open' : 'auth-mode-collapse--closed'
                    }`}
                  >
                    <div className="auth-mode-collapse__inner">
                      <p
                        className={`app-subtext text-[10px] leading-relaxed opacity-50 ${
                          isLight ? 'text-black' : 'text-white'
                        }`}
                      >
                        Use your username, email, and the 7-character signup code.
                        Confirm your email, then sign in.
                      </p>
                    </div>
                  </div>

                  <div
                    className={`auth-mode-collapse ${
                      error ? 'auth-mode-collapse--open' : 'auth-mode-collapse--closed'
                    }`}
                  >
                    <div className="auth-mode-collapse__inner">
                      <p className="text-xs font-bold text-red-500" role="alert">
                        {error ?? '\u00a0'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || showSignupInsight}
                    className={`w-full py-3.5 rounded-xl font-black text-xs uppercase tracking-[0.35em] transition-all duration-300 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2.5 min-h-[46px] ${
                      isLight ? 'bg-black text-white' : 'bg-white text-black'
                    }`}
                  >
                    <MorphCrossfade
                      center
                      active={mode}
                      options={[
                        { id: 'signup', label: 'Create account' },
                        { id: 'login', label: 'Sign in' },
                      ]}
                    />
                  </button>

                  {isDev && onDevSkip && (
                    <button
                      type="button"
                      onClick={handleDevSkip}
                      disabled={isLoading || showSignupInsight}
                      className={`w-full py-3 rounded-xl font-black text-[10px] uppercase tracking-[0.3em] transition-all active:scale-[0.98] disabled:opacity-40 border border-dashed ${
                        isLight
                          ? 'border-black/20 text-black/50 hover:text-black/70'
                          : 'border-white/20 text-white/50 hover:text-white/70'
                      }`}
                    >
                      Skip (dev)
                    </button>
                  )}
                </form>
              </div>
            </div>

            {showSignupInsight && signupConfirmation && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center p-4 rounded-2xl bg-black/25 backdrop-blur-sm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="signup-insight-title"
              >
                <div
                  className={`w-full rounded-[24px] border px-6 py-7 shadow-2xl animate-insight-pop ${
                    isLight
                      ? 'bg-white/95 border-black/10 text-black'
                      : 'pos-dashboard-card-glass border-white/12 text-white'
                  }`}
                >
                  <div className="flex items-center justify-center gap-2 mb-4">
                    <Icons.Trends size={20} className="text-blue-500" />
                    <h4 id="signup-insight-title" className="app-subtext text-sm font-black">
                      Confirm your email
                    </h4>
                  </div>
                  <p className={`app-subtext text-[10px] leading-relaxed text-center opacity-45 ${isLight ? 'text-black' : 'text-white'}`}>
                    We sent a confirmation link to{' '}
                    <span className="font-black">{signupConfirmation.email}</span>.
                    Open your email, tap the link to verify your account, then come back here and sign in.
                  </p>
                  <ol className={`app-subtext text-[10px] leading-relaxed mt-4 space-y-2 list-decimal list-inside opacity-70 ${isLight ? 'text-black' : 'text-white'}`}>
                    <li>Check your inbox (and spam folder).</li>
                    <li>Tap the confirmation link in the email.</li>
                    <li>Return to iCalc and sign in with your username or email.</li>
                  </ol>
                  <button
                    type="button"
                    onClick={dismissSignupConfirmation}
                    className={`w-full mt-6 py-3.5 rounded-xl font-black text-xs uppercase tracking-[0.35em] transition-all active:scale-[0.98] ${isLight ? 'bg-black text-white' : 'bg-white text-black'}`}
                  >
                    Got it
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {isIdle && (
        <div className="relative z-10 shrink-0 flex flex-col items-center w-full max-w-xs select-none mb-2">
          <p
            className="app-subtext text-[10px] animate-swipe-hint-pulse opacity-45 text-center pointer-events-none"
            style={{ color: textColor }}
          >
            Click or swipe to continue
          </p>
          <div className="flex items-center gap-3 opacity-30 mt-4 pointer-events-none" style={{ color: textColor }}>
            <Icons.History size={20} />
            <div className="w-1 h-1 rounded-full bg-current" />
            <Icons.Scientific size={20} />
            <div className="w-1 h-1 rounded-full bg-current" />
            <Icons.Trends size={20} />
          </div>
          {isDev && onDevSkip && (
            <button
              type="button"
              onClick={handleDevSkip}
              disabled={isLoading || isExiting}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              className={`app-subtext mt-5 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.25em] border border-dashed transition-all active:scale-95 pointer-events-auto disabled:opacity-40 ${
                isLight
                  ? 'border-black/20 text-black/45 hover:text-black/65'
                  : 'border-white/20 text-white/45 hover:text-white/65'
              }`}
              aria-label="Skip login for development"
            >
              Skip login (dev)
            </button>
          )}
          {error && (
            <p className="mt-2 text-[10px] font-bold text-red-500 text-center max-w-[16rem] px-2" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {/* Anchored low so it never sits on the auth card (0.0.10-style clearance) */}
      <p
        className={`absolute left-0 right-0 z-0 app-subtext text-[10px] opacity-45 text-center normal-case pointer-events-none transition-opacity duration-300 ${
          isLoading ? 'opacity-20' : ''
        }`}
        style={{
          color: textColor,
          bottom: 'max(1.75rem, calc(env(safe-area-inset-bottom) + 1.25rem))',
        }}
      >
        © 2026 iCalc
      </p>

      {isLoading && (
        <div
          className={`auth-loading-overlay fixed inset-0 z-[1001] flex items-center justify-center p-6 ${isLight ? 'auth-loading-overlay--light' : ''}`}
          role="status"
          aria-live="polite"
          aria-label={loadingLabel}
        >
          <div
            className={`auth-loading-card relative w-full max-w-xs rounded-[28px] border px-8 py-10 flex flex-col items-center gap-6 ${
              isLight
                ? 'bg-white/85 border-black/10 text-black'
                : 'pos-dashboard-card-glass border-white/12 text-white'
            }`}
          >
            <div className="relative w-[88px] h-[88px]">
              <div className="auth-loading-ring auth-loading-ring--outer" aria-hidden="true" />
              <div className="auth-loading-ring auth-loading-ring--inner" aria-hidden="true" />
              <div className="absolute inset-[18px] rounded-[14px] overflow-hidden auth-loading-logo shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
                <img src={icalcLogo} alt="" className="w-full h-full object-cover" draggable={false} />
              </div>
            </div>

            <div className="text-center space-y-2">
              <p className={`auth-loading-status text-sm font-black tracking-tight ${isLight ? 'text-black' : 'text-white'}`}>
                {loadingLabel}
              </p>
              <p className={`app-subtext text-[10px] font-bold ${isLight ? 'text-black/45' : 'text-white/45'}`}>
                {loadingSubtext}
              </p>
            </div>

            <div className="w-full auth-loading-bar" aria-hidden="true">
              <div
                className={`auth-loading-bar-fill ${
                  useTimedLoadingBar ? 'auth-loading-bar-fill--signup' : ''
                }`}
                style={
                  useTimedLoadingBar
                    ? { animationDuration: `${loadingBarDurationMs}ms` }
                    : undefined
                }
              />
            </div>
          </div>
        </div>
      )}

      {/* After admin approves: shop confirms business details only — never Bot API. */}
      {showBusinessSetup && businessSetup && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="business-setup-title"
        >
          <div
            className={`w-full max-w-[min(360px,94vw)] overflow-hidden rounded-2xl border shadow-2xl animate-insight-pop ${
              isLight
                ? 'bg-white border-black/10 text-black'
                : 'bg-zinc-900 border-white/12 text-white'
            }`}
          >
            <div className="px-5 pt-5 pb-2 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Icons.Trends size={20} className="text-emerald-500" />
                <h4 id="business-setup-title" className="app-subtext text-sm font-black">
                  You’re in — shop details
                </h4>
              </div>
              <p
                className={`app-subtext text-[10px] leading-relaxed opacity-55 ${isLight ? 'text-black' : 'text-white'}`}
                style={{ letterSpacing: 0 }}
              >
                Your code was approved. Confirm shop details to continue.
              </p>
            </div>

            {businessInfoLoading ? (
              <div className="px-5 pb-6 flex flex-col items-center gap-3">
                <span className="auth-spinner" aria-hidden="true" />
                <p className="app-subtext text-[10px] opacity-45">One moment…</p>
              </div>
            ) : (
              <div className="px-5 pb-5 pt-2 space-y-3">
                {receivedBusinessInfo?.businessName ? (
                  <BusinessInfoReceiptCard
                    variant="modal"
                    badgeLabel="From admin"
                    businessName={receivedBusinessInfo.businessName}
                    businessPhone={receivedBusinessInfo.businessPhone}
                    businessAddress={receivedBusinessInfo.businessAddress}
                    className="w-full"
                  />
                ) : null}

                <label className="block">
                  <span className={FORM_FIELD_LABEL}>Business name *</span>
                  <input
                    type="text"
                    value={adminInfoName}
                    onChange={(e) => setAdminInfoName(e.target.value)}
                    className={formInputClass(isLight)}
                    placeholder="Shop / business name"
                    autoComplete="organization"
                    autoFocus
                  />
                </label>
                <label className="block">
                  <span className={FORM_FIELD_LABEL}>Phone</span>
                  <input
                    type="tel"
                    value={adminInfoPhone}
                    onChange={(e) => setAdminInfoPhone(e.target.value)}
                    className={formInputClass(isLight)}
                    placeholder="Optional"
                    autoComplete="tel"
                  />
                </label>
                <label className="block">
                  <span className={FORM_FIELD_LABEL}>Address</span>
                  <input
                    type="text"
                    value={adminInfoAddress}
                    onChange={(e) => setAdminInfoAddress(e.target.value)}
                    className={formInputClass(isLight)}
                    placeholder="Optional"
                    autoComplete="street-address"
                  />
                </label>

                {error && (
                  <p className="text-xs font-bold text-red-500 text-center" role="alert">
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  disabled={isSubmitting || !adminInfoName.trim()}
                  onClick={() => void handleBusinessReceiveContinue()}
                  className={`w-full py-3.5 rounded-xl font-black text-xs uppercase tracking-[0.25em] transition-all active:scale-[0.98] min-h-[46px] disabled:opacity-50 ${isLight ? 'bg-black text-white' : 'bg-white text-black'}`}
                >
                  {isSubmitting ? 'Opening…' : 'Continue'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthOverlay;