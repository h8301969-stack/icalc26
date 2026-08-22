import { Session } from '@supabase/supabase-js';
import { UserProfile } from '../types';
import {
  AppAccount,
  createAdminProfile,
  ensureAdminProfile,
} from './auth';
import {
  isAccessControlEnabled,
  linkAccessCodeUser,
  requestAccessCode,
  tryOpenAdminSession,
  validateLoginAccess,
} from './accessControl';
import { recordUserPasswordChange } from './accessControl';
import { isCloudBackendEnabled, isSupabaseConfigured, supabase } from './supabase';
import { sanitizeAvatarForDb } from './supabaseSanitize';

const AUTH_DOMAIN = 'icalc.users';
const ADMIN_PROFILE_UUID = '00000000-0000-4000-8000-000000000001';

export const supabaseEmailFromUsername = (username: string): string => {
  const normalized = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return `${normalized}@${AUTH_DOMAIN}`;
};

const mapDbProfile = (row: {
  id: string;
  name: string;
  avatar_url: string;
  is_system: boolean;
}): UserProfile =>
  row.is_system
    ? { ...createAdminProfile(), avatarUrl: row.avatar_url ?? '' }
    : {
        id: row.id,
        name: row.name,
        avatarUrl: row.avatar_url ?? '',
        isSystem: false,
      };

export const fetchAccountFromSession = async (
  session: Session,
  username: string
): Promise<AppAccount | null> => {
  const userId = session.user.id;

  const { data: profiles, error: profilesError } = await supabase
    .from('user_profiles')
    .select('id, name, avatar_url, is_system')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });

  // Profile read can fail (RLS / offline) after auth succeeds — still admit the user.
  if (profilesError) {
    console.warn('[iCalc auth] user_profiles read failed; using session fallback', profilesError.message);
  }

  const mapped = ensureAdminProfile((profiles ?? []).map(mapDbProfile));
  const { data: settings } = await supabase
    .from('user_settings')
    .select('active_profile_id')
    .eq('user_id', userId)
    .maybeSingle();

  const activeProfileId =
    settings?.active_profile_id && mapped.some((p) => p.id === settings.active_profile_id)
      ? settings.active_profile_id
      : mapped[0]?.id ?? '';

  return {
    id: userId,
    username,
    email: session.user.email ?? undefined,
    passwordHash: '',
    createdAt: Date.parse(session.user.created_at) || Date.now(),
    profiles: mapped,
    activeProfileId,
  };
};

const seedUserRows = async (userId: string, username: string, inviteCode: string) => {
  const userProfileId = crypto.randomUUID();
  const admin = createAdminProfile();

  await supabase.from('user_profiles').insert([
    {
      id: ADMIN_PROFILE_UUID,
      user_id: userId,
      name: admin.name,
      avatar_url: sanitizeAvatarForDb(admin.avatarUrl),
      is_system: true,
      sort_order: 0,
    },
    {
      id: userProfileId,
      user_id: userId,
      name: username.trim(),
      avatar_url: '',
      is_system: false,
      sort_order: 1,
    },
  ]);

  await supabase.from('user_settings').upsert({
    user_id: userId,
    active_profile_id: userProfileId,
  });

  await supabase.from('invite_redemptions').upsert({
    code: inviteCode.trim().toUpperCase(),
    user_id: userId,
  });
};

const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

const resolveLoginEmail = async (identifier: string): Promise<string> => {
  const trimmed = identifier.trim();
  if (trimmed.includes('@')) return trimmed;

  const { data, error } = await supabase.rpc('get_email_for_username', {
    p_username: trimmed,
  });

  if (!error && typeof data === 'string' && data.includes('@')) return data;
  return supabaseEmailFromUsername(trimmed);
};

export const resolveAccountEmail = async (account: AppAccount): Promise<string> => {
  if (account.email) return account.email;
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.email) return data.session.user.email;
  return resolveLoginEmail(account.username);
};

export const attemptBackdoorLogin = async (
  password: string
): Promise<{ admin: true; token: string } | { admin: false; error?: string }> => {
  if (!isAccessControlEnabled()) {
    return { admin: false, error: 'Supabase is not configured on this deployment.' };
  }
  const result = await tryOpenAdminSession(password);
  if (result.ok === false) return { admin: false, error: result.error };
  return { admin: true, token: result.token };
};

export const signupWithSupabase = async (
  username: string,
  email: string,
  inviteCode: string
): Promise<
  | { account: AppAccount; error?: never; pendingEmailConfirmation?: never; pendingApproval?: never; accessCode?: never }
  | { pendingEmailConfirmation: true; email: string; account?: never; error?: never; pendingApproval?: never; accessCode?: never }
  | { pendingApproval: true; accessCode: string; account?: never; error?: never; pendingEmailConfirmation?: never }
  | { account?: never; pendingEmailConfirmation?: never; pendingApproval?: never; accessCode?: never; error: string }
> => {
  if (!isSupabaseConfigured()) {
    return { error: 'Supabase is not configured.' };
  }

  const trimmedName = username.trim();
  const trimmedEmail = email.trim().toLowerCase();
  const code = inviteCode.trim().toUpperCase();
  if (!trimmedName) return { error: 'Enter a username.' };
  if (!isValidEmail(trimmedEmail)) return { error: 'Enter a valid email address.' };
  if (code.length !== 7) return { error: 'One-time code must be 7 characters.' };

  if (isAccessControlEnabled()) {
    const reserve = await requestAccessCode(code, trimmedName, trimmedEmail);
    if (reserve.ok === false) return { error: reserve.error };
  }

  const { data, error } = await supabase.auth.signUp({
    email: trimmedEmail,
    password: code,
    options: { data: { username: trimmedName, access_code: code } },
  });

  if (error) return { error: error.message };
  if (!data.user) return { error: 'Could not create account. Please try again.' };

  if (data.user.id && isAccessControlEnabled()) {
    await linkAccessCodeUser(code, data.user.id);
  }

  if (!data.session) {
    return { pendingEmailConfirmation: true, email: trimmedEmail };
  }

  if (isAccessControlEnabled()) {
    return { pendingApproval: true, accessCode: code };
  }

  await seedUserRows(data.user.id, trimmedName, code);
  await recordUserPasswordChange(code, 'signup');
  const account = await fetchAccountFromSession(data.session, trimmedName);
  if (!account) return { error: 'Account created but profile setup failed.' };
  return { account };
};

export const loginWithSupabase = async (
  username: string,
  password: string
): Promise<
  | { account: AppAccount; error?: never; pendingApproval?: never; accessCode?: never; paused?: never }
  | { pendingApproval: true; accessCode: string; account?: never; error?: never; paused?: never }
  | { paused: true; account?: never; error?: never; pendingApproval?: never; accessCode?: never }
  | { account?: never; pendingApproval?: never; accessCode?: never; paused?: never; error: string }
> => {
  if (!isSupabaseConfigured()) {
    return {
      error:
        'Cloud login is not configured in this build. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY and rebuild.',
    };
  }

  if (!password?.trim()) return { error: 'Enter username or email and password.' };

  const trimmedIdentifier = username.trim();
  if (!trimmedIdentifier) {
    return { error: 'Enter username or email and password.' };
  }

  const loginEmail = await resolveLoginEmail(trimmedIdentifier);
  if (!loginEmail || !loginEmail.includes('@')) {
    return { error: 'Could not resolve account email. Try signing in with your email address.' };
  }

  if (isAccessControlEnabled()) {
    const access = await validateLoginAccess(loginEmail);
    if (access.ok === true && access.allowed === false) {
      if (access.status === 'pending' && access.code) {
        return { pendingApproval: true, accessCode: access.code };
      }
      if (access.status === 'paused') {
        return { paused: true };
      }
      return { error: 'Access denied.' };
    }
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginEmail,
    password,
  });
  if (error) {
    const msg = error.message || 'Invalid login credentials';
    // Friendlier copy for common Supabase errors
    if (/invalid login credentials/i.test(msg)) {
      return { error: 'Incorrect username/email or password.' };
    }
    if (/email not confirmed/i.test(msg)) {
      return { error: 'Confirm your email, then sign in again.' };
    }
    return { error: msg };
  }
  if (!data.session) return { error: 'Could not start session.' };

  const resolvedUsername =
    (data.session.user.user_metadata?.username as string | undefined) ??
    ((trimmedIdentifier.includes('@') ? trimmedIdentifier.split('@')[0] : trimmedIdentifier) ||
      loginEmail.split('@')[0]);

  let account = await fetchAccountFromSession(data.session, resolvedUsername);
  if (!account) {
    const accessCode = data.session.user.user_metadata?.access_code as string | undefined;
    if (accessCode) {
      await seedUserRows(data.session.user.id, resolvedUsername, accessCode);
      account = await fetchAccountFromSession(data.session, resolvedUsername);
    }
  }

  // Always return a session-backed account after successful sign-in
  if (!account) {
    account = {
      id: data.session.user.id,
      username: resolvedUsername,
      email: data.session.user.email ?? loginEmail,
      passwordHash: '',
      createdAt: Date.parse(data.session.user.created_at) || Date.now(),
      profiles: ensureAdminProfile([]),
      activeProfileId: createAdminProfile().id,
    };
  }
  return { account };
};

export const completeApprovedSignup = async (
  accessCode: string,
  username: string
): Promise<{ account: AppAccount } | { error: string }> => {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) return { error: 'Session expired. Sign in again.' };

  await seedUserRows(data.session.user.id, username, accessCode);
  await recordUserPasswordChange(accessCode, 'signup');
  const account = await fetchAccountFromSession(data.session, username);
  if (!account) return { error: 'Could not finalize account.' };
  return { account };
};

export const logoutSupabase = async () => {
  if (!isCloudBackendEnabled() && !isAccessControlEnabled()) return;
  await supabase.auth.signOut();
};

export const getSupabaseSessionAccount = async (): Promise<AppAccount | null> => {
  if (!isCloudBackendEnabled() && !isAccessControlEnabled()) return null;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  const username =
    (data.session.user.user_metadata?.username as string | undefined) ??
    data.session.user.email?.split('@')[0] ??
    'user';
  return fetchAccountFromSession(data.session, username);
};

const isUuid = (id: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

/** Deterministic UUID so legacy `profile-…` ids map to the same cloud row every sync. */
const stableUuidFromString = (input: string): string => {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < input.length; i += 1) {
    bytes[i % 16] ^= input.charCodeAt(i) & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** Map app profile id → DB primary key (admin always uses fixed UUID). */
const toDbProfileId = (profile: UserProfile, userId: string): string => {
  if (profile.isSystem || profile.name === '@admin') return ADMIN_PROFILE_UUID;
  if (isUuid(profile.id)) return profile.id;
  return stableUuidFromString(`${userId}:${profile.id}`);
};

/**
 * Upsert every profile row for this account. Never deletes remote profiles
 * so account users remain durable across devices and reinstalls.
 * Returns profiles with cloud-safe ids (callers should persist the remap).
 */
export const syncProfilesToSupabase = async (
  profiles: UserProfile[],
  activeProfileId: string
): Promise<UserProfile[]> => {
  if (!isCloudBackendEnabled()) return ensureAdminProfile(profiles);
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return ensureAdminProfile(profiles);

  const normalized = ensureAdminProfile(profiles);
  const idMap = new Map<string, string>();
  const rows = normalized.map((profile, index) => {
    const dbId = toDbProfileId(profile, userId);
    idMap.set(profile.id, dbId);
    const isSystem = !!(profile.isSystem || profile.name === '@admin');
    return {
      id: dbId,
      user_id: userId,
      name: isSystem ? '@admin' : profile.name,
      avatar_url: sanitizeAvatarForDb(profile.avatarUrl ?? ''),
      is_system: isSystem,
      sort_order: index,
    };
  });

  const { error: upsertError } = await supabase
    .from('user_profiles')
    .upsert(rows, { onConflict: 'id' });
  if (upsertError) {
    console.warn('[iCalc auth] user_profiles upsert failed', upsertError.message);
  }

  const nextActive =
    idMap.get(activeProfileId) ??
    (isUuid(activeProfileId) ? activeProfileId : null) ??
    rows.find((r) => !r.is_system)?.id ??
    rows[0]?.id ??
    null;

  await supabase.from('user_settings').upsert({
    user_id: userId,
    active_profile_id: nextActive,
  });

  // Keep local admin id convention; remap legacy ids to their cloud UUIDs.
  return normalized.map((profile) => {
    if (profile.isSystem || profile.name === '@admin') {
      return { ...createAdminProfile(), avatarUrl: profile.avatarUrl ?? '' };
    }
    return { ...profile, id: idMap.get(profile.id) ?? profile.id };
  });
};

/** Union remote + local profiles by id; keep local avatar/name when both exist. */
export const mergeAccountProfiles = (
  remote: UserProfile[],
  local: UserProfile[]
): UserProfile[] => {
  const byId = new Map<string, UserProfile>();
  for (const p of ensureAdminProfile(remote)) byId.set(p.id, p);
  for (const p of ensureAdminProfile(local)) {
    const existing = byId.get(p.id);
    if (!existing) {
      byId.set(p.id, p);
      continue;
    }
    byId.set(p.id, {
      ...existing,
      ...p,
      avatarUrl: p.avatarUrl || existing.avatarUrl,
      name: p.name || existing.name,
    });
  }
  return ensureAdminProfile([...byId.values()]);
};