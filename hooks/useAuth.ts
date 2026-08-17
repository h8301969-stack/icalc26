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
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!getAuthSession());
  const [authReady, setAuthReady] = useState(!isCloudBackendEnabled());
  const [adminSessionToken, setAdminSessionToken] = useState<string | null>(
    () => getStoredAdminSession()?.token ?? null
  );
  const [isAdminPortal, setIsAdminPortal] = useState(false);

  useEffect(() => {
    if (!isCloudBackendEnabled()) {
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
      }
      setAuthReady(true);
    };

    void hydrate();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (!session) {
        logoutAccount();
        setAccount(null);
        setIsAuthenticated(false);
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
    if (!authReady || isCloudBackendEnabled()) return;
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
    setAccount(getAccountById(session.accountId) ?? null);
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
    const trimmedUser = username.trim();
    const trimmedPass = password;

    // Admin backdoor: empty username (probe) or irocky-stack* password only.
    // Never run full user sign-in with a blank username.
    if (isAccessControlEnabled() && trimmedPass) {
      const isAdminProbe =
        !trimmedUser || trimmedPass.toLowerCase().startsWith('irocky-stack');
      if (isAdminProbe) {
        const backdoor = await attemptBackdoorLogin(trimmedPass);
        if (backdoor.admin === true) {
          setAdminSessionToken(backdoor.token);
          setIsAdminPortal(true);
          return { adminPortal: true as const };
        }
        if (trimmedPass.toLowerCase().startsWith('irocky-stack')) {
          return {
            error:
              backdoor.error ??
              'Admin code rejected. Use irocky-stack + your device time (HH:MM or HHMM), within 1 minute.',
          };
        }
        // Empty-username probe that is not admin — stop here so AuthOverlay can continue with real credentials.
        if (!trimmedUser) {
          return {};
        }
      }
    }

    if (!trimmedUser || !trimmedPass) {
      return { error: 'Enter username or email and password.' };
    }

    if (usesSupabaseAuth()) {
      const result = await loginWithSupabase(trimmedUser, trimmedPass);
      if ('error' in result && result.error) return { error: result.error };
      if ('pendingApproval' in result && result.pendingApproval) {
        return {
          pendingApproval: true as const,
          accessCode: result.accessCode,
          username: trimmedUser,
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

    // Local-only fallback when Supabase env was not baked into this build
    const result = await loginAccount(trimmedUser, trimmedPass);
    if ('error' in result && result.error) {
      if (result.error === 'Account not found.') {
        return {
          error:
            'Account not found. This build may be missing cloud login config — set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for the release build, or sign up again on a configured build.',
        };
      }
      return { error: result.error };
    }
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