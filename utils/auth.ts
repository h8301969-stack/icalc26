import { INVITE_PASSWORDS } from '../data/invitePasswords';
import { UserProfile } from '../types';
import { storage } from '../hooks/storage';

export const ADMIN_PROFILE_ID = 'profile-system-admin';
export const ADMIN_PROFILE_NAME = '@admin';

const ACCOUNTS_KEY = 'icalc_accounts';
const AUTH_SESSION_KEY = 'icalc_auth_session';
const USED_INVITE_CODES_KEY = 'icalc_used_invite_codes';

const INVITE_SET = new Set(INVITE_PASSWORDS.map((c) => c.toUpperCase()));

export interface AppAccount {
  id: string;
  username: string;
  email?: string;
  passwordHash: string;
  createdAt: number;
  profiles: UserProfile[];
  activeProfileId: string;
}

export interface AuthSession {
  accountId: string;
  username: string;
}

export const createAdminProfile = (): UserProfile => ({
  id: ADMIN_PROFILE_ID,
  name: ADMIN_PROFILE_NAME,
  avatarUrl: '',
  isSystem: true,
});

export const isAdminProfile = (profile: UserProfile | null | undefined): boolean =>
  profile?.name === ADMIN_PROFILE_NAME || profile?.id === ADMIN_PROFILE_ID;

export const ensureAdminProfile = (profiles: UserProfile[]): UserProfile[] => {
  const hasAdmin = profiles.some((p) => isAdminProfile(p));
  if (hasAdmin) {
    return profiles.map((p) =>
      isAdminProfile(p) ? { ...createAdminProfile(), avatarUrl: p.avatarUrl } : p
    );
  }
  return [createAdminProfile(), ...profiles];
};

export const hashPassword = async (password: string): Promise<string> => {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const normalizeUsername = (username: string) => username.trim().toLowerCase();

export const isValidInviteCode = (code: string): boolean =>
  INVITE_SET.has(code.trim().toUpperCase());

export const getAccounts = (): AppAccount[] => storage.get<AppAccount[]>(ACCOUNTS_KEY, []);

const saveAccounts = (accounts: AppAccount[]) => storage.set(ACCOUNTS_KEY, accounts);

export const getUsedInviteCodes = (): Record<string, string> =>
  storage.get<Record<string, string>>(USED_INVITE_CODES_KEY, {});

const saveUsedInviteCodes = (used: Record<string, string>) =>
  storage.set(USED_INVITE_CODES_KEY, used);

export const getAuthSession = (): AuthSession | null =>
  storage.get<AuthSession | null>(AUTH_SESSION_KEY, null);

export const setAuthSession = (session: AuthSession | null) => {
  if (session) storage.set(AUTH_SESSION_KEY, session);
  else localStorage.removeItem(AUTH_SESSION_KEY);
};

export const findAccountByUsername = (username: string): AppAccount | undefined => {
  const key = normalizeUsername(username);
  return getAccounts().find((a) => normalizeUsername(a.username) === key);
};

const DEV_GUEST_ACCOUNT_ID = 'account-dev-guest';
const DEV_GUEST_PROFILE_ID = 'profile-dev-guest';
const DEV_GUEST_USERNAME = 'dev';

/** Local-only guest account for skipping auth during `npm run dev`. */
export const getOrCreateDevGuestAccount = (): AppAccount => {
  const existing = getAccountById(DEV_GUEST_ACCOUNT_ID);
  if (existing) {
    setAuthSession({ accountId: existing.id, username: existing.username });
    return existing;
  }

  const userProfile: UserProfile = {
    id: DEV_GUEST_PROFILE_ID,
    name: DEV_GUEST_USERNAME,
    avatarUrl: '',
    isSystem: false,
  };
  const profiles = ensureAdminProfile([userProfile]);
  const account: AppAccount = {
    id: DEV_GUEST_ACCOUNT_ID,
    username: DEV_GUEST_USERNAME,
    passwordHash: '',
    createdAt: Date.now(),
    profiles,
    activeProfileId: userProfile.id,
  };

  saveAccounts([...getAccounts(), account]);
  setAuthSession({ accountId: account.id, username: account.username });
  return account;
};

export const signupWithInvite = async (
  username: string,
  inviteCode: string
): Promise<{ account: AppAccount; error?: never } | { account?: never; error: string }> => {
  const trimmedName = username.trim();
  const code = inviteCode.trim().toUpperCase();

  if (!trimmedName) return { error: 'Enter a username.' };
  if (code.length !== 7) return { error: 'One-time code must be 7 characters.' };
  if (!isValidInviteCode(code)) return { error: 'Invalid one-time code.' };
  if (findAccountByUsername(trimmedName)) return { error: 'Username already taken.' };

  const used = getUsedInviteCodes();
  if (used[code]) return { error: 'This one-time code has already been used.' };

  const userProfile: UserProfile = {
    id: `profile-${Date.now()}`,
    name: trimmedName,
    avatarUrl: '',
    isSystem: false,
  };
  const profiles = ensureAdminProfile([userProfile]);
  const passwordHash = await hashPassword(code);

  const account: AppAccount = {
    id: `account-${Date.now()}`,
    username: trimmedName,
    passwordHash,
    createdAt: Date.now(),
    profiles,
    activeProfileId: userProfile.id,
  };

  saveAccounts([...getAccounts(), account]);
  saveUsedInviteCodes({ ...used, [code]: account.id });
  setAuthSession({ accountId: account.id, username: account.username });

  return { account };
};

const resolveLoginUsername = (identifier: string): string => {
  const trimmed = identifier.trim();
  if (!trimmed.includes('@')) return trimmed;
  const [local, domain] = trimmed.split('@');
  if (domain?.toLowerCase() === 'icalc.users') return local;
  return local;
};

export const loginAccount = async (
  username: string,
  password: string
): Promise<{ account: AppAccount; error?: never } | { account?: never; error: string }> => {
  const trimmedName = resolveLoginUsername(username);
  if (!trimmedName || !password) return { error: 'Enter username or email and password.' };

  const account = findAccountByUsername(trimmedName);
  if (!account) return { error: 'Account not found.' };

  const passwordHash = await hashPassword(password);
  if (passwordHash !== account.passwordHash) return { error: 'Incorrect password.' };

  setAuthSession({ accountId: account.id, username: account.username });
  return { account };
};

export const changeAccountPassword = async (
  accountId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true; error?: never } | { ok?: never; error: string }> => {
  const next = newPassword.trim();
  if (next.length < 4) return { error: 'New password must be at least 4 characters.' };

  const accounts = getAccounts();
  const idx = accounts.findIndex((a) => a.id === accountId);
  if (idx === -1) return { error: 'Account not found.' };

  const currentHash = await hashPassword(currentPassword);
  if (currentHash !== accounts[idx].passwordHash) return { error: 'Current password is incorrect.' };

  const passwordHash = await hashPassword(next);
  accounts[idx] = { ...accounts[idx], passwordHash };
  saveAccounts(accounts);
  return { ok: true };
};

export const updateAccountProfiles = (
  accountId: string,
  profiles: UserProfile[],
  activeProfileId: string
) => {
  const accounts = getAccounts();
  const idx = accounts.findIndex((a) => a.id === accountId);
  if (idx === -1) return;
  accounts[idx] = {
    ...accounts[idx],
    profiles: ensureAdminProfile(profiles),
    activeProfileId,
  };
  saveAccounts(accounts);
};

export const logoutAccount = () => setAuthSession(null);

export const getAccountById = (accountId: string): AppAccount | undefined =>
  getAccounts().find((a) => a.id === accountId);