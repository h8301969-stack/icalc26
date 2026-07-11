import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import icalcLogo from '../assets/logo/icalc-logo.png';
import { Icons } from '../constants';
import { STANDBY_TIMER_OPTIONS } from '../hooks/useStandby';
import { AppAccount } from '../utils/auth';
import { checkAccessCodeStatus, submitAccessBusinessInfo, subscribeAccessStatus } from '../utils/accessControl';
import { supabase } from '../utils/supabase';

type AuthMode = 'signup' | 'login';
type AuthPane = 'idle' | 'auth' | 'settings';

const AUTH_MIN_LOADING_MS = 1200;
const AUTH_SIGNUP_LOADING_MS = 15000;
const AUTH_SUCCESS_HOLD_MS = 700;
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
  onDevSkip?: () => Promise<{ adminPortal?: true; error?: string } | void>;
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
  const [businessName, setBusinessName] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [loadingPhase, setLoadingPhase] = useState<AuthLoadingPhase>('default');
  const pendingPollRef = useRef<number | null>(null);
  const pendingUnsubscribeRef = useRef<(() => void) | null>(null);
  const pointerStart = useRef<{ x: number; y: number; edge: 'left' | 'right' | null } | null>(null);

  const isLoading = isSubmitting || isEntering;
  const showSignupInsight = signupConfirmation !== null;
  const showBusinessSetup = businessSetup !== null;
  const isIdle = pane === 'idle' && !isLoading;
  const showAuthForm = pane === 'auth';
  const showSettings = pane === 'settings';
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
    if (loadingPhase === 'access_paused') return 'Contact your administrator';
    if (loadingPhase === 'access_denied') return 'This request was not approved';
    if (isEntering) return 'Opening your workspace';
    if (mode === 'signup') return 'Setting up your account';
    return 'Verifying credentials';
  })();

  const signupLoadingDurationMs =
    loadingPhase === 'waiting_approval'
      ? AUTH_SIGNUP_LOADING_MS
      : mode === 'signup'
        ? AUTH_SIGNUP_LOADING_MS
        : AUTH_MIN_LOADING_MS;

  useEffect(() => {
    return () => {
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

  const textColor = isLight ? '#000' : '#fff';
  const panelClass = isLight
    ? 'bg-white/80 border-black/10 text-black'
    : 'pos-dashboard-card-glass border border-white/12 text-white';

  const inputClass = isLight
    ? 'bg-white/90 border-black/10 text-black placeholder:text-black/35'
    : 'bg-white/8 border-white/12 text-white placeholder:text-white/35';

  const settingsCardClass = isLight
    ? 'bg-white/85 border-black/10 text-black'
    : 'pos-dashboard-card-glass border border-white/12 text-white';

  const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  const revealAuthForm = useCallback(() => {
    if (pane === 'auth' || isLoading) return;
    setPane('auth');
    setAuthCardAnimKey((k) => k + 1);
    if ('vibrate' in navigator) navigator.vibrate(10);
  }, [pane, isLoading]);

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

  const handleDevSkip = useCallback(async () => {
    if (!isDev || isLoading || isExiting || existingAccount || !onDevSkip) return;

    flushSync(() => {
      setIsSubmitting(true);
    });

    try {
      const result = await onDevSkip();
      if (result?.adminPortal) {
        setLoadingPhase('admin_breached');
        if ('vibrate' in navigator) navigator.vibrate([20, 40, 20]);
        await wait(1400);
        setIsSubmitting(false);
        setLoadingPhase('default');
        onAdminPortal?.();
        return;
      }
      if (result?.error) {
        setIsSubmitting(false);
        setError(result.error);
        return;
      }
    } catch {
      setIsSubmitting(false);
      setError('Could not open admin portal.');
    }
  }, [isDev, isLoading, isExiting, existingAccount, onDevSkip, onAdminPortal]);

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

  const handleBusinessSetupSubmit = useCallback(async () => {
    if (!businessSetup || !businessName.trim()) {
      setError('Enter your business name.');
      return;
    }
    setError(null);
    setIsSubmitting(true);

    const saved = await submitAccessBusinessInfo(businessSetup.accessCode, {
      businessName: businessName.trim(),
      businessPhone: businessPhone.trim(),
      businessAddress: businessAddress.trim(),
    });

    if (!saved.ok) {
      setIsSubmitting(false);
      setError(saved.error);
      return;
    }

    updateSettings?.({
      businessName: businessName.trim(),
      businessPhone: businessPhone.trim(),
      businessAddress: businessAddress.trim(),
    });

    await completeAccessGrant(businessSetup.accessCode, businessSetup.username);
  }, [
    businessSetup,
    businessName,
    businessPhone,
    businessAddress,
    updateSettings,
    completeAccessGrant,
  ]);

  const handleAccessStatus = useCallback(
    async (accessCode: string, pendingUsername: string, status: string) => {
      if (status === 'approved' && onFinalizeAccess) {
        stopPendingWatch();
        setIsSubmitting(false);
        setLoadingPhase('default');
        setBusinessName('');
        setBusinessPhone('');
        setBusinessAddress('');
        setBusinessSetup({ accessCode, username: pendingUsername });
        setPane('auth');
        setAuthCardAnimKey((k) => k + 1);
        if ('vibrate' in navigator) navigator.vibrate([12, 40, 12]);
        return;
      }

      if (status === 'denied' || status === 'unused') {
        stopPendingWatch();
        setLoadingPhase('access_denied');
        await wait(1800);
        setIsSubmitting(false);
        setLoadingPhase('default');
        setError('Access was denied.');
      }
    },
    [onFinalizeAccess, stopPendingWatch]
  );

  const startPendingApprovalWatch = useCallback(
    (accessCode: string, pendingUsername: string) => {
      stopPendingWatch();

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
      const backdoorProbe = await onLogin('', secret);
      if (backdoorProbe.adminPortal) {
        setLoadingPhase('admin_breached');
        if ('vibrate' in navigator) navigator.vibrate([20, 40, 20]);
        await wait(1400);
        setIsSubmitting(false);
        setLoadingPhase('default');
        onAdminPortal?.();
        return;
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
        await wait(1800);
        setIsSubmitting(false);
        setLoadingPhase('default');
        setError('Your account is paused.');
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
        <div className="flex rounded-full overflow-hidden border text-xs font-black uppercase tracking-widest mx-auto w-fit">
          {(['light', 'dark', 'system'] as const).map((theme) => (
            <button
              key={theme}
              type="button"
              onClick={() => updateSettings({ themeMode: theme })}
              className={`px-4 py-2 transition-all ${
                settings.themeMode === theme
                  ? isLight ? 'bg-black text-white' : 'bg-white text-black'
                  : 'opacity-50'
              }`}
            >
              {theme}
            </button>
          ))}
        </div>
      );
    }

    const layout = settings.layoutMode ?? 'portrait';
    return (
      <div className="flex flex-col items-center gap-3">
        <p className="app-subtext text-[10px] opacity-50">Calculator orientation</p>
        <button
          type="button"
          onClick={() =>
            updateSettings({
              layoutMode: layout === 'portrait' ? 'landscape' : 'portrait',
            })
          }
          className={`app-subtext px-5 py-3 rounded-xl text-xs font-black border transition-all active:scale-95 ${
            isLight ? 'bg-zinc-100 border-zinc-200 text-black' : 'bg-white/10 border-white/10 text-white'
          }`}
        >
          {layout === 'portrait' ? 'Portrait' : 'Landscape'}
        </button>
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

      <div className="flex flex-col items-center justify-center flex-1 w-full max-w-sm gap-6 pt-16">
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

        {showAuthForm && (
          <div
            key={authCardAnimKey}
            className={`relative w-full rounded-2xl p-6 border shadow-2xl animate-auth-card-enter ${panelClass} ${isLoading && !showBusinessSetup ? 'opacity-40 pointer-events-none' : ''}`}
          >
            <div className="flex rounded-full overflow-hidden border mb-5 text-[10px] font-black uppercase tracking-widest">
              <button
                type="button"
                disabled={isLoading}
                onClick={() => { setMode('signup'); setError(null); setSecret(''); setEmail(''); }}
                className={`flex-1 py-2 transition-all ${mode === 'signup' ? (isLight ? 'bg-black text-white' : 'bg-white text-black') : 'opacity-50'}`}
              >
                Sign up
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => { setMode('login'); setError(null); setSecret(''); setEmail(''); }}
                className={`flex-1 py-2 transition-all ${mode === 'login' ? (isLight ? 'bg-black text-white' : 'bg-white text-black') : 'opacity-50'}`}
              >
                Sign in
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <label className="block">
                <span className="app-subtext opacity-60 text-[10px] font-black block mb-1.5">
                  {mode === 'signup' ? 'Username' : 'Username or email'}
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  autoComplete="username"
                  disabled={isLoading || showSignupInsight || showBusinessSetup}
                  className={`w-full px-4 py-3 rounded-xl border outline-none font-bold text-sm disabled:opacity-50 ${inputClass}`}
                  placeholder={mode === 'signup' ? 'Choose a username' : 'Username or email'}
                />
              </label>

              {mode === 'signup' && (
                <label className="block">
                  <span className="app-subtext opacity-60 text-[10px] font-black block mb-1.5">
                    Email
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    autoComplete="email"
                    disabled={isLoading || showSignupInsight}
                    className={`w-full px-4 py-3 rounded-xl border outline-none font-bold text-sm disabled:opacity-50 ${inputClass}`}
                    placeholder="you@example.com"
                  />
                </label>
              )}

              <label className="block">
                <span className="app-subtext opacity-60 text-[10px] font-black block mb-1.5">
                  {mode === 'signup' ? 'Signup code' : 'Password'}
                </span>
                <input
                  type={mode === 'signup' ? 'password' : 'text'}
                  value={secret}
                  onChange={(e) =>
                    setSecret(mode === 'signup' ? e.target.value.toUpperCase() : e.target.value)
                  }
                  onKeyDown={(e) => e.stopPropagation()}
                  autoComplete={mode === 'signup' ? 'one-time-code' : 'current-password'}
                  spellCheck={false}
                  maxLength={mode === 'signup' ? 7 : 64}
                  disabled={isLoading || showSignupInsight}
                  className={`w-full px-4 py-3 rounded-xl border outline-none font-bold text-sm ${mode === 'signup' ? 'tracking-widest' : ''} disabled:opacity-50 ${inputClass}`}
                  placeholder={mode === 'signup' ? '7-character code' : 'Your password'}
                />
              </label>

              {mode === 'signup' && (
                <p className={`app-subtext text-[10px] leading-relaxed opacity-50 ${isLight ? 'text-black' : 'text-white'}`}>
                  Enter your username, email, and one-time signup code. After confirming your email, sign in with your username or email.
                </p>
              )}

              {error && (
                <p className="text-xs font-bold text-red-500" role="alert">{error}</p>
              )}

              <button
                type="submit"
                disabled={isLoading || showSignupInsight}
                className={`w-full py-3.5 rounded-xl font-black text-xs uppercase tracking-[0.35em] transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2.5 min-h-[46px] ${isLight ? 'bg-black text-white' : 'bg-white text-black'}`}
              >
                {mode === 'signup' ? 'Create account' : 'Sign in'}
              </button>

              {isDev && onDevSkip && !existingAccount && (
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

            {showBusinessSetup && businessSetup && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center p-4 rounded-2xl bg-black/25 backdrop-blur-sm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="business-setup-title"
              >
                <div
                  className={`w-full rounded-[24px] border px-6 py-7 shadow-2xl animate-insight-pop ${
                    isLight
                      ? 'bg-white/95 border-black/10 text-black'
                      : 'pos-dashboard-card-glass border-white/12 text-white'
                  }`}
                >
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Icons.Trends size={20} className="text-emerald-500" />
                    <h4 id="business-setup-title" className="app-subtext text-sm font-black">
                      Access granted
                    </h4>
                  </div>
                  <p className={`app-subtext text-[10px] leading-relaxed text-center mb-5 opacity-45 ${isLight ? 'text-black' : 'text-white'}`}>
                    Set up your business details. Your business name appears on invoice cards.
                  </p>

                  <form
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleBusinessSetupSubmit();
                    }}
                  >
                    <label className="block">
                      <span className="app-subtext opacity-60 text-[10px] font-black block mb-1.5">Business name</span>
                      <input
                        type="text"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        autoFocus
                        required
                        className={`w-full px-4 py-3 rounded-xl border outline-none font-bold text-sm ${inputClass}`}
                        placeholder="Your shop or business"
                      />
                    </label>
                    <label className="block">
                      <span className="app-subtext opacity-60 text-[10px] font-black block mb-1.5">Phone number</span>
                      <input
                        type="tel"
                        value={businessPhone}
                        onChange={(e) => setBusinessPhone(e.target.value)}
                        className={`w-full px-4 py-3 rounded-xl border outline-none font-bold text-sm ${inputClass}`}
                        placeholder="+233 …"
                      />
                    </label>
                    <label className="block">
                      <span className="app-subtext opacity-60 text-[10px] font-black block mb-1.5">
                        Address <span className="opacity-50">optional</span>
                      </span>
                      <input
                        type="text"
                        value={businessAddress}
                        onChange={(e) => setBusinessAddress(e.target.value)}
                        className={`w-full px-4 py-3 rounded-xl border outline-none font-bold text-sm ${inputClass}`}
                        placeholder="Street, city"
                      />
                    </label>

                    {error && (
                      <p className="text-xs font-bold text-red-500" role="alert">{error}</p>
                    )}

                    <button
                      type="submit"
                      disabled={isSubmitting || !businessName.trim()}
                      className={`w-full mt-2 py-3.5 rounded-xl font-black text-xs uppercase tracking-[0.35em] transition-all active:scale-[0.98] min-h-[46px] disabled:opacity-50 ${isLight ? 'bg-black text-white' : 'bg-white text-black'}`}
                    >
                      {isSubmitting ? 'Saving…' : 'Continue'}
                    </button>
                  </form>
                </div>
              </div>
            )}

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
        <div className="flex flex-col items-center w-full max-w-xs select-none">
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
          {isDev && onDevSkip && !existingAccount && (
            <button
              type="button"
              onClick={handleDevSkip}
              className={`app-subtext mt-5 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.25em] border border-dashed transition-all active:scale-95 pointer-events-auto ${
                isLight
                  ? 'border-black/20 text-black/45 hover:text-black/65'
                  : 'border-white/20 text-white/45 hover:text-white/65'
              }`}
            >
              Skip login (dev)
            </button>
          )}
        </div>
      )}

      <p className={`app-subtext text-[10px] opacity-45 text-center pb-2 transition-opacity duration-300 normal-case ${isLoading ? 'opacity-20' : ''}`} style={{ color: textColor }}>
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
                  (mode === 'signup' || loadingPhase === 'waiting_approval') && isSubmitting
                    ? 'auth-loading-bar-fill--signup'
                    : ''
                }`}
                style={
                  (mode === 'signup' || loadingPhase === 'waiting_approval') && isSubmitting
                    ? { animationDuration: `${signupLoadingDurationMs}ms` }
                    : undefined
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthOverlay;