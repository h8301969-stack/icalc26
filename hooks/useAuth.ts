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
  signupWithInvite,
  updateAccountProfiles,
} from '../utils/auth';
import { UserProfile } from '../types';
import { isCloudBackendEnabled, supabase } from '../utils/supabase';
import {
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

export const useAuth = () => {
  const [account, setAccount] = useState<AppAccount | null>(() => {
    const session = getAuthSession();
    if (!session) return null;
    return getAccountById(session.accountId) ?? null;
  });
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!getAuthSession());
  const [authReady, setAuthReady] = useState(!isCloudBackendEnabled());

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
    if (isCloudBackendEnabled()) {
      const result = await signupWithSupabase(username, email, inviteCode);
      if ('error' in result && result.error) return { error: result.error };
      if ('pendingEmailConfirmation' in result && result.pendingEmailConfirmation) {
        return {
          pendingEmailConfirmation: true as const,
          confirmationEmail: result.email,
        };
      }
      persistLocalSession(result.account);
      setAccount(result.account);
      setIsAuthenticated(true);
      return { account: result.account };
    }

    const result = await signupWithInvite(username, inviteCode);
    if ('error' in result && result.error) return { error: result.error };
    persistLocalSession(result.account);
    setAccount(result.account);
    setIsAuthenticated(true);
    return { account: result.account };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = isCloudBackendEnabled()
      ? await loginWithSupabase(username, password)
      : await loginAccount(username, password);
    if ('error' in result && result.error) return { error: result.error };
    persistLocalSession(result.account);
    setAccount(result.account);
    setIsAuthenticated(true);
    return { account: result.account };
  }, []);

  const logout = useCallback(() => {
    if (isCloudBackendEnabled()) void logoutSupabase();
    logoutAccount();
    setIsAuthenticated(false);
    setAccount(null);
  }, []);

  const skipDevAuth = useCallback((): AppAccount | null => {
    if (!import.meta.env.DEV) return null;
    const guest = getOrCreateDevGuestAccount();
    persistLocalSession(guest);
    setAccount(guest);
    setIsAuthenticated(true);
    return guest;
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!account) return { error: 'Not signed in.' };

      if (isCloudBackendEnabled()) {
        const email = await resolveAccountEmail(account);
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password: currentPassword,
        });
        if (signInError) return { error: 'Current password is incorrect.' };

        const { error: updateError } = await supabase.auth.updateUser({
          password: newPassword.trim(),
        });
        if (updateError) return { error: updateError.message };
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

      if (isCloudBackendEnabled()) {
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
    signup,
    login,
    logout,
    skipDevAuth,
    changePassword,
    syncProfiles,
    verifyPassword,
  };
};