import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UserProfile } from '../types';
import {
  AccountNotification,
  AccountNotificationKind,
  EmitAccountNotificationInput,
  NotificationStyle,
} from '../types/accountNotifications';
import { storage } from './storage';
import { isCloudBackendEnabled, supabase } from '../utils/supabase';

/** Last notification stays visible this long unless the user swipes it away. */
const PILL_LAST_MS = 10_000;
/** Intermediate cascade steps stay shorter so the queue moves. */
const CASCADE_STEP_MS = 900;
const HOLD_MS = 480;

const storageKey = (accountId: string) => `account_notifications_${accountId}`;

const loadLocal = (accountId: string): AccountNotification[] =>
  storage.get<AccountNotification[]>(storageKey(accountId), []);

const saveLocal = (accountId: string, rows: AccountNotification[]) => {
  storage.set(storageKey(accountId), rows.slice(0, 200));
};

const mapRemote = (row: Record<string, unknown>): AccountNotification => ({
  id: String(row.id),
  accountId: String(row.user_id),
  kind: row.kind as AccountNotificationKind,
  title: String(row.title ?? ''),
  body: String(row.body ?? ''),
  createdAt: Date.parse(String(row.created_at)) || Date.now(),
  actorProfileId: String(row.actor_profile_id ?? ''),
  targetProfileId: String(row.target_profile_id ?? ''),
  readAt: row.read_at ? Date.parse(String(row.read_at)) || undefined : undefined,
});

export interface UseAccountNotificationsOptions {
  accountId: string | null;
  profiles: UserProfile[];
  activeProfileId: string;
  notificationStyle: NotificationStyle;
  enabled?: boolean;
}

export const useAccountNotifications = ({
  accountId,
  profiles,
  activeProfileId,
  notificationStyle,
  enabled = true,
}: UseAccountNotificationsOptions) => {
  const [items, setItems] = useState<AccountNotification[]>([]);
  const [liveQueue, setLiveQueue] = useState<AccountNotification[]>([]);
  const [activeToast, setActiveToast] = useState<AccountNotification | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [listItems, setListItems] = useState<AccountNotification[]>([]);
  const [cascadeActive, setCascadeActive] = useState(false);

  const activeProfileIdRef = useRef(activeProfileId);
  const notificationStyleRef = useRef(notificationStyle);
  const hideTimerRef = useRef<number | null>(null);
  const cascadeTimerRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const cascadeQueueRef = useRef<AccountNotification[]>([]);
  const cascadeIndexRef = useRef(0);
  const prevProfileRef = useRef<string | null>(null);

  activeProfileIdRef.current = activeProfileId;
  notificationStyleRef.current = notificationStyle;

  const clearHideTimer = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const clearCascadeTimer = () => {
    if (cascadeTimerRef.current !== null) {
      window.clearTimeout(cascadeTimerRef.current);
      cascadeTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!accountId || !enabled) {
      setItems([]);
      return;
    }
    setItems(loadLocal(accountId));

    if (!isCloudBackendEnabled()) return;

    let cancelled = false;
    void supabase
      .from('account_notifications')
      .select('id, user_id, kind, title, body, actor_profile_id, target_profile_id, created_at, read_at')
      .eq('user_id', accountId)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const remote = data.map((row) => mapRemote(row as Record<string, unknown>));
        setItems((prev) => {
          const byId = new Map<string, AccountNotification>();
          for (const n of [...remote, ...prev]) byId.set(n.id, n);
          const merged = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
          saveLocal(accountId, merged);
          return merged;
        });
      });

    const channel = supabase
      .channel(`account-notis-${accountId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'account_notifications',
          filter: `user_id=eq.${accountId}`,
        },
        (payload) => {
          const row = mapRemote(payload.new as Record<string, unknown>);
          setItems((prev) => {
            if (prev.some((n) => n.id === row.id)) return prev;
            const next = [row, ...prev].slice(0, 200);
            saveLocal(accountId, next);
            return next;
          });
          if (row.targetProfileId === activeProfileIdRef.current && !row.readAt) {
            setLiveQueue((q) => [...q, row]);
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [accountId, enabled]);

  const markRead = useCallback(
    (ids: string[]) => {
      if (!accountId || ids.length === 0) return;
      const now = Date.now();
      setItems((prev) => {
        const next = prev.map((n) =>
          ids.includes(n.id) && !n.readAt ? { ...n, readAt: now } : n
        );
        saveLocal(accountId, next);
        return next;
      });
      if (isCloudBackendEnabled()) {
        void supabase
          .from('account_notifications')
          .update({ read_at: new Date(now).toISOString() })
          .eq('user_id', accountId)
          .in('id', ids);
      }
    },
    [accountId]
  );

  const emit = useCallback(
    (input: EmitAccountNotificationInput) => {
      if (!accountId || !enabled) return;
      // Fan-out to every other profile, and always CC @admin so they see profile activity.
      const byId = new Map<string, (typeof profiles)[number]>();
      for (const p of profiles) {
        if (!p.id || p.id === input.actorProfileId) continue;
        byId.set(p.id, p);
      }
      const admin = profiles.find(
        (p) => p.isSystem || p.name === '@admin' || p.name?.toLowerCase() === 'admin'
      );
      if (admin?.id && admin.id !== input.actorProfileId) {
        byId.set(admin.id, admin);
      }
      const targets = [...byId.values()];
      if (targets.length === 0) return;

      const stamped = Date.now();
      const created: AccountNotification[] = targets.map((profile, index) => ({
        id: `noti-${stamped}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        accountId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        createdAt: stamped,
        actorProfileId: input.actorProfileId,
        targetProfileId: profile.id,
      }));

      setItems((prev) => {
        const next = [...created, ...prev].slice(0, 200);
        saveLocal(accountId, next);
        return next;
      });

      const forActive = created.filter((n) => n.targetProfileId === activeProfileIdRef.current);
      if (forActive.length > 0) {
        setLiveQueue((q) => [...q, ...forActive]);
      }

      if (isCloudBackendEnabled()) {
        void supabase.from('account_notifications').insert(
          created.map((n) => ({
            id: n.id,
            user_id: accountId,
            kind: n.kind,
            title: n.title,
            body: n.body,
            actor_profile_id: n.actorProfileId,
            target_profile_id: n.targetProfileId,
            created_at: new Date(n.createdAt).toISOString(),
          }))
        );
      }
    },
    [accountId, enabled, profiles]
  );

  const pendingFor = useCallback(
    (profileId: string) =>
      items
        .filter((n) => n.targetProfileId === profileId && !n.readAt)
        .sort((a, b) => a.createdAt - b.createdAt),
    [items]
  );

  const showToast = useCallback((noti: AccountNotification, durationMs: number) => {
    clearHideTimer();
    setActiveToast(noti);
    hideTimerRef.current = window.setTimeout(() => {
      setActiveToast(null);
      hideTimerRef.current = null;
    }, durationMs);
  }, []);

  // Live queue (single toasts while profile is already active)
  useEffect(() => {
    if (listOpen || cascadeActive || activeToast || liveQueue.length === 0) return;
    const [next, ...rest] = liveQueue;
    setLiveQueue(rest);
    markRead([next.id]);
    // Last (or only) toast in this batch stays 10s; others step faster.
    const duration = rest.length === 0 ? PILL_LAST_MS : CASCADE_STEP_MS;
    showToast(next, duration);
  }, [liveQueue, activeToast, listOpen, cascadeActive, markRead, showToast]);

  const advanceCascade = useCallback(() => {
    const queue = cascadeQueueRef.current;
    const idx = cascadeIndexRef.current;
    if (idx >= queue.length) {
      setCascadeActive(false);
      setActiveToast(null);
      return;
    }
    const noti = queue[idx];
    const isLast = idx === queue.length - 1;
    const duration = isLast ? PILL_LAST_MS : CASCADE_STEP_MS;
    showToast(noti, duration);
    markRead([noti.id]);
    cascadeIndexRef.current = idx + 1;
    cascadeTimerRef.current = window.setTimeout(() => {
      cascadeTimerRef.current = null;
      if (cascadeIndexRef.current >= queue.length) {
        setCascadeActive(false);
        setActiveToast(null);
      } else {
        advanceCascade();
      }
    }, duration);
  }, [markRead, showToast]);

  const startCascade = useCallback(
    (profileId: string) => {
      const pending = items
        .filter((n) => n.targetProfileId === profileId && !n.readAt)
        .sort((a, b) => a.createdAt - b.createdAt);
      if (pending.length === 0) return;

      clearHideTimer();
      clearCascadeTimer();
      setLiveQueue([]);
      setListOpen(false);
      cascadeQueueRef.current = pending;
      cascadeIndexRef.current = 0;
      setCascadeActive(true);
      advanceCascade();
    },
    [items, advanceCascade]
  );

  // Profile activate → cascade unread for that profile
  useEffect(() => {
    if (!enabled || !accountId || !activeProfileId) return;
    if (prevProfileRef.current === null) {
      prevProfileRef.current = activeProfileId;
      return;
    }
    if (prevProfileRef.current === activeProfileId) return;
    prevProfileRef.current = activeProfileId;
    // Small delay so UI settles after profile switch
    const t = window.setTimeout(() => startCascade(activeProfileId), 280);
    return () => window.clearTimeout(t);
  }, [activeProfileId, accountId, enabled, startCascade]);

  const openList = useCallback(
    (source: AccountNotification[]) => {
      clearHideTimer();
      clearCascadeTimer();
      setCascadeActive(false);
      setActiveToast(null);
      setListItems(source);
      setListOpen(true);
    },
    []
  );

  const closeList = useCallback(() => {
    setListOpen(false);
    setListItems([]);
  }, []);

  const onPillPointerDown = useCallback(() => {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      const pending = pendingFor(activeProfileIdRef.current);
      const source =
        cascadeActive && cascadeQueueRef.current.length > 0
          ? cascadeQueueRef.current
          : pending.length > 0
            ? pending
            : activeToast
              ? [activeToast]
              : [];
      if (source.length === 0) return;
      openList(source);
    }, HOLD_MS);
  }, [openList, pendingFor]);

  const onPillPointerUp = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const dismissToast = useCallback(() => {
    clearHideTimer();
    clearCascadeTimer();
    // If cascading, skip ahead / end so swipe doesn't leave a stuck queue
    if (cascadeActive) {
      cascadeQueueRef.current = [];
      cascadeIndexRef.current = 0;
      setCascadeActive(false);
    }
    setActiveToast(null);
  }, [cascadeActive]);

  useEffect(
    () => () => {
      clearHideTimer();
      clearCascadeTimer();
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    },
    []
  );

  const unreadCount = useMemo(() => {
    const active = profiles.find((p) => p.id === activeProfileId);
    const isAdmin =
      !!active &&
      (active.isSystem || active.name === '@admin' || active.name?.toLowerCase() === 'admin');
    // Admin sees unread for every profile; others only see their own.
    if (isAdmin) return items.filter((n) => !n.readAt).length;
    return items.filter((n) => n.targetProfileId === activeProfileId && !n.readAt).length;
  }, [items, activeProfileId, profiles]);

  const openInbox = useCallback(
    (profileId?: string) => {
      const pid = profileId || activeProfileIdRef.current;
      const active = profiles.find((p) => p.id === pid);
      const isAdmin =
        !!active &&
        (active.isSystem || active.name === '@admin' || active.name?.toLowerCase() === 'admin');
      const source = (
        isAdmin
          ? [...items]
          : items.filter((n) => n.targetProfileId === pid)
      ).sort((a, b) => b.createdAt - a.createdAt);
      openList(source.length > 0 ? source : [...items].sort((a, b) => b.createdAt - a.createdAt));
    },
    [items, openList, profiles]
  );

  return {
    emit,
    pendingFor,
    markRead,
    items,
    activeToast,
    listOpen,
    listItems,
    notificationStyle,
    cascadeActive,
    unreadCount,
    dismissToast,
    closeList,
    onPillPointerDown,
    onPillPointerUp,
    openList,
    openInbox,
    startCascade,
  };
};

export type AccountNotificationsApi = ReturnType<typeof useAccountNotifications>;
