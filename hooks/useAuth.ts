import { useCallback, useEffect, useState } from 'react';
import {
  AppAccount,
  changeAccountPassword,
  ensureAdminProfile,
  getAccountById,
  getAuthSession,
  hashPassword,
  loginAccount,
  logoutAccount,
  setAuthSession,
  getOrCreateDevGuestAccount,
  getOrCreateDevGuestAccountAsAdmin,
  updateAccountProfiles,
} from '../utils/auth';
import { UserProfile } from '../types';
import {
  isAccessControlEnabled,
  getStoredAdminSession,
  recordUserPasswordChange,
  tryOpenDevAdminSession,
} from '../utils/accessControl';
import { isCloudBackendEnabled, isSupabaseConfigured, supabase } from '../utils/supabase';
import {
  attemptBackdoorLogin,
  completeApprovedSignup,
  getSupabaseSessionAccount,
  loginWithSupabase,
  logoutSupabase,
  resolveAccountEmail,
  signupWithSupabase,
  syncProfilesToSupabase,
} from '../utils/supabaseAuth';

const persistLocalSession = (account: AppAccount) => {
  setAuthSession({ accountId: account.id, username: account.username });
};

const usesSupabaseAuth = (): boolean => isSupabaseConfigured();

export const useAuth = () => {
  const [account, setAccount] = useState<AppAccount | null>(() => {
    const session = getAuthSession();
    if (!session) return null;
    return getAccountById(session.accountId) ?? null;
  });
  // Local session cookie/flag means “signed in” for idle unlock (swipe/click), even
  // before the full account row is rehydrated from Supabase.
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!getAuthSession());
  const [authReady, setAuthReady] = useState(!usesSupabaseAuth());
  const [adminSessionToken, setAdminSessionToken] = useState<string | null>(
    () => getStoredAdminSession()?.token ?? null
  );
  const [isAdminPortal, setIsAdminPortal] = useState(false);

  useEffect(() => {
    if (!usesSupabaseAuth()) {
      setAuthReady(true);
      return;
    }

    let mounted = true;

    const hydrate = async () => {
      const remote = await getSupabaseSessionAccount();
      if (!mounted) return;
      if (remote) {
        persistLocalSession(remote);
        setAccount(remote);
        setIsAuthenticated(true);
      } else if (!getAuthSession()) {
        // No Supabase session and no local session → truly signed out
        setAccount(null);
        setIsAuthenticated(false);
      }
      // If local session exists but remote briefly unavailable, keep isAuthenticated
      // so inactivity/refresh can unlock with swipe/click without re-sign-in.
      setAuthReady(true);
    };

    void hydrate();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      // Only treat real sign-out as logout — transient null sessions must not
      // force the login form after refresh or token refresh glitches.
      if (!session) {
        if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
          logoutAccount();
          setAccount(null);
          setIsAuthenticated(false);
        }
        return;
      }
      void getSupabaseSessionAccount().then((remote) => {
        if (!mounted || !remote) return;
        persistLocalSession(remote);
        setAccount(remote);
        setIsAuthenticated(true);
      });
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    // Local-only accounts (no Supabase): keep account row in sync with session.
    if (!authReady || usesSupabaseAuth()) return;
    if (!isAuthenticated) {
      setAccount(null);
      return;
    }
    const session = getAuthSession();
    if (!session) {
      setIsAuthenticated(false);
      setAccount(null);
      return;
    }
    const local = getAccountById(session.accountId);
    if (local) setAccount(local);
  }, [isAuthenticated, authReady]);
  const signup = useCallback(async (username: string, email: string, inviteCode: string) => {
    if (usesSupabaseAuth()) {
      const result = await signupWithSupabase(username, email, inviteCode);
      if ('error' in result && result.error) return { error: result.error };
      if ('pendingEmailConfirmation' in result && result.pendingEmailConfirmation) {
        return {
          pendingEmailConfirmation: true as const,
          confirmationEmail: result.email,
        };
      }
      if ('pendingApproval' in result && result.pendingApproval) {
        return {
          pendingApproval: true as const,
          accessCode: result.accessCode,
          username: username.trim(),
        };
      }
      if (!result.account) return { error: 'Could not create account.' };
      persistLocalSession(result.account);
      setAccount(result.account);
      setIsAuthenticated(true);
      return { account: result.account };
    }

    return {
      error:
        'Supabase is not connected. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local (project folder), then stop and restart npm run dev. On a live site, set the same vars in your host (e.g. Vercel) and redeploy.',
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const trimmedPass = password.trim();
    // Only hard-fail as admin for unambiguous codes. Bare HH:MM / 4 digits may be
    // a normal user password — try admin first, then fall through to Supabase login.
    const hardAdminCode =
      !!trimmedPass &&
      (trimmedPass === '1234' || trimmedPass.toLowerCase().startsWith('irocky-stack'));

    // Admin portal: password-only (username ignored). Works on web + native APK when Supabase is baked in.
    if (trimmedPass) {
      const backdoor = await attemptBackdoorLogin(trimmedPass);
      if (backdoor.admin === true) {
        setAdminSessionToken(backdoor.token);
        setIsAdminPortal(true);
        return { adminPortal: true as const };
      }
      if (hardAdminCode) {
        return {
          error:
            backdoor.error ??
            'Admin code rejected. Use irocky-stack + your device time (HH:MM or HHMM), within 1–2 minutes.',
        };
      }
    }

    if (usesSupabaseAuth()) {
      // Empty username is used by AuthOverlay as an admin-only probe. Message must
      // not match overly broad "admin" text checks; real login continues when
      // username is present (AuthOverlay ignores this probe error in that case).
      if (!username.trim()) {
        return { error: 'Enter username or email.' };
      }
      const result = await loginWithSupabase(username, password);
      if ('error' in result && result.error) return { error: result.error };
      if ('pendingApproval' in result && result.pendingApproval) {
        return {
          pendingApproval: true as const,
          accessCode: result.accessCode,
          username: username.trim(),
        };
      }
      if ('paused' in result && result.paused) {
        return { paused: true as const };
      }
      if (!result.account) return { error: 'Could not sign in.' };
      persistLocalSession(result.account);
      setAccount(result.account);
      setIsAuthenticated(true);
      return { account: result.account };
    }

    if (!username.trim()) {
      return {
        error:
          'Sign-in is not fully configured on this build (missing Supabase). Rebuild the APK with VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, or use a web build with those env vars.',
      };
    }

    const result = await loginAccount(username, password);
    if ('error' in result && result.error) return { error: result.error };
    persistLocalSession(result.account);
    setAccount(result.account);
    setIsAuthenticated(true);
    return { account: result.account };
  }, []);

  const finalizeApprovedAccess = useCallback(async (accessCode: string, username: string) => {
    const result = await completeApprovedSignup(accessCode, username);
    if ('error' in result) return { error: result.error };
    persistLocalSession(result.account);
    setAccount(result.account);
    setIsAuthenticated(true);
    return { account: result.account };
  }, []);

  const closeAdminPortal = useCallback(() => {
    setIsAdminPortal(false);
    setAdminSessionToken(null);
  }, []);

  const hideAdminPortal = useCallback(() => {
    setIsAdminPortal(false);
  }, []);

  const logout = useCallback(() => {
    if (isCloudBackendEnabled() || usesSupabaseAuth()) void logoutSupabase();
    logoutAccount();
    setIsAuthenticated(false);
    setAccount(null);
    setIsAdminPortal(false);
    setAdminSessionToken(null);
  }, []);

  const skipDevAuth = useCallback((): AppAccount | null => {
    if (!import.meta.env.DEV) return null;
    const guest = getOrCreateDevGuestAccount();
    persistLocalSession(guest);
    setAccount(guest);
    setIsAuthenticated(true);
    return guest;
  }, []);

  const skipDevAuthAsAdmin = useCallback((): AppAccount | null => {
    if (!import.meta.env.DEV) return null;
    const guest = getOrCreateDevGuestAccountAsAdmin();
    persistLocalSession(guest);
    setAccount(guest);
    setIsAuthenticated(true);
    return guest;
  }, []);

  const openDevAdminPortal = useCallback(async (): Promise<
    { adminPortal: true } | { error: string }
  > => {
    const result = await tryOpenDevAdminSession();
    if (result.ok === false) return { error: result.error };
    setAdminSessionToken(result.token);
    setIsAdminPortal(true);
    return { adminPortal: true };
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!account) return { error: 'Not signed in.' };

      if (isCloudBackendEnabled() || usesSupabaseAuth()) {
        const email = await resolveAccountEmail(account);
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password: currentPassword,
        });
        if (signInError) return { error: 'Current password is incorrect.' };

        const trimmedNew = newPassword.trim();
        const { error: updateError } = await supabase.auth.updateUser({
          password: trimmedNew,
        });
        if (updateError) return { error: updateError.message };

        const historyResult = await recordUserPasswordChange(trimmedNew, 'user_change');
        if (historyResult.ok === false) {
          console.warn('[iCalc] password history save failed', historyResult.error);
        }
        return { ok: true as const };
      }

      const result = await changeAccountPassword(account.id, currentPassword, newPassword);
      if ('error' in result && result.error) return { error: result.error };
      const refreshed = getAccountById(account.id);
      if (refreshed) setAccount(refreshed);
      return { ok: true as const };
    },
    [account]
  );

  const syncProfiles = useCallback((profiles: UserProfile[], activeProfileId: string) => {
    const session = getAuthSession();
    if (!session) return;

    const normalizedProfiles = ensureAdminProfile(profiles);

    if (isCloudBackendEnabled()) {
      void syncProfilesToSupabase(normalizedProfiles, activeProfileId);
    } else {
      const current = getAccountById(session.accountId);
      if (!current) return;
      const unchanged =
        current.activeProfileId === activeProfileId &&
        JSON.stringify(current.profiles) === JSON.stringify(normalizedProfiles);
      if (unchanged) return;
      updateAccountProfiles(current.id, profiles, activeProfileId);
    }

    setAccount((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        profiles: normalizedProfiles,
        activeProfileId,
      };
    });
  }, []);

  const verifyPassword = useCallback(
    async (password: string) => {
      if (!account) return { error: 'Not signed in.' };

      if (isCloudBackendEnabled() || usesSupabaseAuth()) {
        const email = await resolveAccountEmail(account);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return { error: 'Incorrect admin password.' };
        return { ok: true as const };
      }

      const passwordHash = await hashPassword(password);
      if (passwordHash !== account.passwordHash) return { error: 'Incorrect admin password.' };
      return { ok: true as const };
    },
    [account]
  );

  return {
    account,
    isAuthenticated,
    authReady,
    adminSessionToken,
    isAdminPortal,
    signup,
    login,
    logout,
    skipDevAuth,
    skipDevAuthAsAdmin,
    openDevAdminPortal,
    changePassword,
    syncProfiles,
    verifyPassword,
    finalizeApprovedAccess,
    closeAdminPortal,
    hideAdminPortal,
  };
};