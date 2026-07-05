import React, { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import icalcLogo from '../assets/logo/icalc-logo.png';
import { AppAccount } from '../utils/auth';

type AuthMode = 'signup' | 'login';

const AUTH_MIN_LOADING_MS = 1200;
const AUTH_SUCCESS_HOLD_MS = 700;

interface AuthResult {
  error?: string;
  account?: AppAccount;
}

interface AuthOverlayProps {
  isLight: boolean;
  mode?: AuthMode;
  defaultUsername?: string;
  onSignup: (username: string, inviteCode: string) => Promise<AuthResult>;
  onLogin: (username: string, password: string) => Promise<AuthResult>;
  onAuthComplete: (account: AppAccount) => void;
}

const AuthOverlay: React.FC<AuthOverlayProps> = ({
  isLight,
  mode: initialMode = 'signup',
  defaultUsername = '',
  onSignup,
  onLogin,
  onAuthComplete,
}) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [time, setTime] = useState(new Date());
  const [username, setUsername] = useState(defaultUsername);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEntering, setIsEntering] = useState(false);

  const isLoading = isSubmitting || isEntering;
  const loadingLabel =
    isEntering
      ? 'Welcome back…'
      : mode === 'signup'
        ? 'Creating account…'
        : 'Signing in…';

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

  const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || isEntering) return;
    setError(null);

    flushSync(() => {
      setIsSubmitting(true);
    });

    const startedAt = Date.now();

    try {
      const result =
        mode === 'signup'
          ? await onSignup(username, secret)
          : await onLogin(username, secret);

      if (result.error) {
        setIsSubmitting(false);
        setError(result.error);
        return;
      }

      if (!result.account) {
        setIsSubmitting(false);
        setError('Could not complete sign in. Please try again.');
        return;
      }

      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, AUTH_MIN_LOADING_MS - elapsed);
      if (remaining > 0) await wait(remaining);

      flushSync(() => {
        setIsEntering(true);
      });

      if ('vibrate' in navigator) navigator.vibrate([10, 30]);
      await wait(AUTH_SUCCESS_HOLD_MS);
      onAuthComplete(result.account);
    } catch {
      setIsSubmitting(false);
      setError('Something went wrong. Please try again.');
    }
  };

  const timeString = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <div
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-between p-6 sm:p-12"
      role="main"
      aria-label={mode === 'signup' ? 'Sign up' : 'Sign in'}
      aria-busy={isLoading}
    >
      <div className="absolute top-8 left-8 sm:top-12 sm:left-12 flex items-center gap-3 select-none pointer-events-none">
        <div className={`unlock-logo-wrap shrink-0 w-12 h-12 sm:w-14 sm:h-14 ${isLoading ? 'auth-loading-logo' : ''}`}>
          <img src={icalcLogo} alt="iCalc logo" className="w-full h-full object-cover" draggable={false} />
        </div>
        <div className="text-4xl sm:text-5xl leading-none tracking-tighter font-black" aria-label="iCalc 26">
          <span className="italic text-white" style={{ fontFamily: 'Georgia, "Times New Roman", cursive' }}>i</span>
          <span className={isLight ? 'text-black' : 'text-white'}>Calc</span>
          <span className="unlock-brand-26">26</span>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center flex-1 w-full max-w-sm gap-6 pt-16">
        <div className={`text-center select-none pointer-events-none transition-opacity duration-300 ${isLoading ? 'opacity-40' : 'opacity-100'}`}>
          <p className="font-num-light text-5xl tracking-tighter tabular-nums opacity-80" style={{ color: textColor }}>
            {timeString}
          </p>
          <p className="app-subtext opacity-50 mt-1" style={{ color: textColor }}>
            {time.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
          </p>
        </div>

        <div className={`relative w-full rounded-2xl p-6 border shadow-2xl transition-all duration-300 ${panelClass} ${isLoading ? 'opacity-40 pointer-events-none' : ''}`}>
          <div className="flex rounded-full overflow-hidden border mb-5 text-[10px] font-black uppercase tracking-widest">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => { setMode('signup'); setError(null); setSecret(''); }}
              className={`flex-1 py-2 transition-all ${mode === 'signup' ? (isLight ? 'bg-black text-white' : 'bg-white text-black') : 'opacity-50'}`}
            >
              Sign up
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => { setMode('login'); setError(null); setSecret(''); }}
              className={`flex-1 py-2 transition-all ${mode === 'login' ? (isLight ? 'bg-black text-white' : 'bg-white text-black') : 'opacity-50'}`}
            >
              Sign in
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block">
              <span className="app-subtext opacity-60 text-[10px] font-black block mb-1.5">Username</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={isLoading}
                className={`w-full px-4 py-3 rounded-xl border outline-none font-bold text-sm disabled:opacity-50 ${inputClass}`}
                placeholder="Your name"
              />
            </label>

            <label className="block">
              <span className="app-subtext opacity-60 text-[10px] font-black block mb-1.5">
                {mode === 'signup' ? 'One-time code (7 characters)' : 'Password'}
              </span>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value.toUpperCase())}
                autoComplete={mode === 'signup' ? 'one-time-code' : 'current-password'}
                maxLength={mode === 'signup' ? 7 : 64}
                disabled={isLoading}
                className={`w-full px-4 py-3 rounded-xl border outline-none font-bold text-sm tracking-widest disabled:opacity-50 ${inputClass}`}
                placeholder={mode === 'signup' ? 'XXXXXXX' : '•••••••'}
              />
            </label>

            {mode === 'signup' && (
              <p className={`app-subtext text-[10px] leading-relaxed opacity-50 ${isLight ? 'text-black' : 'text-white'}`}>
                Use your one-time code to create an account. You can change your password later in Settings.
              </p>
            )}

            {error && (
              <p className="text-xs font-bold text-red-500" role="alert">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-3.5 rounded-xl font-black text-xs uppercase tracking-[0.35em] transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2.5 min-h-[46px] ${isLight ? 'bg-black text-white' : 'bg-white text-black'}`}
            >
              {mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>

      <p className={`app-subtext opacity-40 text-center pb-2 transition-opacity duration-300 ${isLoading ? 'opacity-20' : ''}`} style={{ color: textColor }}>
        @admin profile is added automatically to every account
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
                {isEntering ? 'Opening your workspace' : 'Verifying credentials'}
              </p>
            </div>

            <div className="w-full auth-loading-bar" aria-hidden="true">
              <div className="auth-loading-bar-fill" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthOverlay;