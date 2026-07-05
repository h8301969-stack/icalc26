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
  signupWithInvite,
  updateAccountProfiles,
} from '../utils/auth';
import { UserProfile } from '../types';

export const useAuth = () => {
  const [account, setAccount] = useState<AppAccount | null>(() => {
    const session = getAuthSession();
    if (!session) return null;
    return getAccountById(session.accountId) ?? null;
  });
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!getAuthSession());

  useEffect(() => {
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
  }, [isAuthenticated]);

  const signup = useCallback(async (username: string, inviteCode: string) => {
    const result = await signupWithInvite(username, inviteCode);
    if ('error' in result && result.error) return { error: result.error };
    setAccount(result.account);
    setIsAuthenticated(true);
    return { account: result.account };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await loginAccount(username, password);
    if ('error' in result && result.error) return { error: result.error };
    setAccount(result.account);
    setIsAuthenticated(true);
    return { account: result.account };
  }, []);

  const logout = useCallback(() => {
    logoutAccount();
    setIsAuthenticated(false);
    setAccount(null);
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!account) return { error: 'Not signed in.' };
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

    const current = getAccountById(session.accountId);
    if (!current) return;

    const normalizedProfiles = ensureAdminProfile(profiles);
    const unchanged =
      current.activeProfileId === activeProfileId &&
      JSON.stringify(current.profiles) === JSON.stringify(normalizedProfiles);
    if (unchanged) return;

    updateAccountProfiles(current.id, profiles, activeProfileId);
    const refreshed = getAccountById(current.id);
    if (!refreshed) return;

    setAccount((prev) => {
      if (
        prev?.id === refreshed.id &&
        prev.activeProfileId === refreshed.activeProfileId &&
        JSON.stringify(prev.profiles) === JSON.stringify(refreshed.profiles)
      ) {
        return prev;
      }
      return refreshed;
    });
  }, []);

  const verifyPassword = useCallback(
    async (password: string) => {
      if (!account) return { error: 'Not signed in.' };
      const passwordHash = await hashPassword(password);
      if (passwordHash !== account.passwordHash) return { error: 'Incorrect admin password.' };
      return { ok: true as const };
    },
    [account]
  );

  return {
    account,
    isAuthenticated,
    signup,
    login,
    logout,
    changePassword,
    syncProfiles,
    verifyPassword,
  };
};