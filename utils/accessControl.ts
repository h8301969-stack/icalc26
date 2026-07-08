import { isSupabaseConfigured, supabase } from './supabase';

const ADMIN_SESSION_KEY = 'icalc_admin_session';

export type AccessCodeStatus = 'unused' | 'pending' | 'approved' | 'paused' | 'denied';

export interface AccessCodeRow {
  code: string;
  status: AccessCodeStatus;
  username: string | null;
  email: string | null;
  user_id: string | null;
  admin_memo: string | null;
  created_at: string | null;
  requested_at: string | null;
  approved_at: string | null;
  denied_at: string | null;
  paused_at: string | null;
}

export interface AdminSession {
  token: string;
  expiresAt: number;
}

export const isAccessControlEnabled = (): boolean => isSupabaseConfigured();

const clientClockPayload = () => {
  const now = new Date();
  return {
    p_client_epoch_ms: Date.now(),
    p_tz_offset_minutes: now.getTimezoneOffset(),
    p_client_hour: now.getHours(),
    p_client_minute: now.getMinutes(),
  };
};

export const getStoredAdminSession = (): AdminSession | null => {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed.token || parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(ADMIN_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const storeAdminSession = (token: string, expiresAt: string | number) => {
  const session: AdminSession = {
    token,
    expiresAt: typeof expiresAt === 'string' ? Date.parse(expiresAt) : expiresAt,
  };
  localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
};

export const clearAdminSession = async () => {
  const existing = getStoredAdminSession();
  if (existing && isAccessControlEnabled()) {
    await supabase.rpc('close_admin_session', { p_token: existing.token });
  }
  localStorage.removeItem(ADMIN_SESSION_KEY);
};

export const tryOpenAdminSession = async (
  password: string
): Promise<{ ok: true; token: string } | { ok: false; error: string }> => {
  if (!isAccessControlEnabled()) {
    return { ok: false, error: 'Access control is not configured.' };
  }

  const { data, error } = await supabase.rpc('open_admin_session', {
    p_password: password,
    ...clientClockPayload(),
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: 'Invalid credentials.' };

  storeAdminSession(data.token as string, data.expires_at as string);
  return { ok: true, token: data.token as string };
};

export const requestAccessCode = async (
  code: string,
  username: string,
  email: string
): Promise<{ ok: true; code: string } | { ok: false; error: string }> => {
  if (!isAccessControlEnabled()) {
    return { ok: false, error: 'Access control is not configured.' };
  }

  const { data, error } = await supabase.rpc('request_access_code', {
    p_code: code.trim().toUpperCase(),
    p_username: username.trim(),
    p_email: email.trim().toLowerCase(),
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: (data?.error as string) ?? 'Invalid access code.' };
  return { ok: true, code: data.code as string };
};

export const linkAccessCodeUser = async (code: string, userId: string) => {
  if (!isAccessControlEnabled()) return { ok: false as const, error: 'Not configured.' };
  const { data, error } = await supabase.rpc('link_access_code_user', {
    p_code: code.trim().toUpperCase(),
    p_user_id: userId,
  });
  if (error) return { ok: false as const, error: error.message };
  if (!data?.ok) return { ok: false as const, error: (data?.error as string) ?? 'Link failed.' };
  return { ok: true as const };
};

export const subscribeAccessStatus = (
  userId: string,
  onStatus: (status: AccessCodeStatus) => void
): (() => void) => {
  if (!isAccessControlEnabled()) return () => undefined;

  const channel = supabase
    .channel(`access-status-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'access_codes',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const next = (payload.new as { status?: AccessCodeStatus }).status;
        if (next) onStatus(next);
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
};

export const checkAccessCodeStatus = async (
  code: string
): Promise<{ ok: true; status: AccessCodeStatus } | { ok: false; error: string }> => {
  if (!isAccessControlEnabled()) return { ok: false, error: 'Not configured.' };
  const { data, error } = await supabase.rpc('check_access_code_status', {
    p_code: code.trim().toUpperCase(),
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: 'not_found' };
  return { ok: true, status: data.status as AccessCodeStatus };
};

export const validateLoginAccess = async (
  email: string
): Promise<
  | { ok: true; allowed: true }
  | { ok: true; allowed: false; status: AccessCodeStatus; code?: string }
  | { ok: false; error: string }
> => {
  if (!isAccessControlEnabled()) return { ok: true, allowed: true };
  const { data, error } = await supabase.rpc('validate_login_access', {
    p_email: email.trim().toLowerCase(),
  });
  if (error) return { ok: false, error: error.message };
  if (data?.allowed) return { ok: true, allowed: true };
  return {
    ok: true,
    allowed: false,
    status: (data?.status as AccessCodeStatus) ?? 'denied',
    code: data?.code as string | undefined,
  };
};

export const adminListCodes = async (
  token: string,
  tab: 'unused' | 'pending' | 'approved'
): Promise<{ ok: true; codes: AccessCodeRow[] } | { ok: false; error: string }> => {
  const { data, error } = await supabase.rpc('admin_list_access_codes', {
    p_token: token,
    p_tab: tab,
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: (data?.error as string) ?? 'Unauthorized.' };
  return { ok: true, codes: (data.codes as AccessCodeRow[]) ?? [] };
};

export const adminApproveCode = async (token: string, code: string, memo?: string) => {
  const { data, error } = await supabase.rpc('admin_approve_code', {
    p_token: token,
    p_code: code.trim().toUpperCase(),
    p_memo: memo?.trim() || null,
  });
  if (error) return { ok: false as const, error: error.message };
  if (!data?.ok) return { ok: false as const, error: (data?.error as string) ?? 'Failed.' };
  return { ok: true as const };
};

export const adminUpdateMemo = async (token: string, code: string, memo: string) => {
  const { data, error } = await supabase.rpc('admin_update_memo', {
    p_token: token,
    p_code: code.trim().toUpperCase(),
    p_memo: memo,
  });
  if (error) return { ok: false as const, error: error.message };
  if (!data?.ok) return { ok: false as const, error: (data?.error as string) ?? 'Failed.' };
  return { ok: true as const };
};

export const adminDenyCode = async (token: string, code: string) => {
  const { data, error } = await supabase.rpc('admin_deny_code', {
    p_token: token,
    p_code: code.trim().toUpperCase(),
  });
  if (error) return { ok: false as const, error: error.message };
  if (!data?.ok) return { ok: false as const, error: (data?.error as string) ?? 'Failed.' };
  return { ok: true as const };
};

export const adminPauseCode = async (token: string, code: string) => {
  const { data, error } = await supabase.rpc('admin_pause_code', {
    p_token: token,
    p_code: code.trim().toUpperCase(),
  });
  if (error) return { ok: false as const, error: error.message };
  if (!data?.ok) return { ok: false as const, error: (data?.error as string) ?? 'Failed.' };
  return { ok: true as const };
};

export const adminResumeCode = async (token: string, code: string) => {
  if (!isAccessControlEnabled()) return { ok: false as const, error: 'Not configured.' };

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

  const response = await fetch(`${supabaseUrl}/functions/v1/admin-resume-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      admin_token: token,
      code: code.trim().toUpperCase(),
    }),
  });

  const payload = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !payload.ok) {
    return { ok: false as const, error: payload.error ?? 'Resume failed.' };
  }
  return { ok: true as const };
};