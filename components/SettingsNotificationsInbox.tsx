import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '../constants';
import { MorphPresence } from './MorphCrossfade';
import FluidSegmentControl from './FluidSegmentControl';
import type { AccountNotification } from '../types/accountNotifications';

type DateFilter = 'today' | '24h' | '7d' | '30d' | 'all';

const DATE_OPTIONS: { id: DateFilter; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'all', label: 'All' },
];

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const filterByDate = (rows: AccountNotification[], filter: DateFilter) => {
  if (filter === 'all') return rows;
  const now = Date.now();
  const cutoff =
    filter === 'today'
      ? startOfToday()
      : filter === '24h'
        ? now - 24 * 60 * 60 * 1000
        : filter === '7d'
          ? now - 7 * 24 * 60 * 60 * 1000
          : now - 30 * 24 * 60 * 60 * 1000;
  return rows.filter((n) => n.createdAt >= cutoff);
};

interface SettingsNotificationsInboxProps {
  isOpen: boolean;
  onClose: () => void;
  isLight: boolean;
  notifications: AccountNotification[];
  activeProfileId: string;
  /** Admin sees every profile’s notifications by default. */
  isAdmin?: boolean;
  onMarkRead?: (ids: string[]) => void;
}

const SettingsNotificationsInbox: React.FC<SettingsNotificationsInboxProps> = ({
  isOpen,
  onClose,
  isLight,
  notifications,
  activeProfileId,
  isAdmin = false,
  onMarkRead,
}) => {
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [scope, setScope] = useState<'me' | 'all'>(isAdmin ? 'all' : 'me');
  const markedOnOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      markedOnOpenRef.current = false;
      return;
    }
    if (isAdmin) setScope('all');
    if (markedOnOpenRef.current) return;
    markedOnOpenRef.current = true;
    // Opening the bell list marks unread rows as seen (popup already showed them).
    const unreadIds = (
      (isAdmin ? notifications : notifications.filter((n) => n.targetProfileId === activeProfileId))
    )
      .filter((n) => !n.readAt)
      .map((n) => n.id);
    if (unreadIds.length > 0) onMarkRead?.(unreadIds);
  }, [isOpen, isAdmin, notifications, activeProfileId, onMarkRead]);

  const filtered = useMemo(() => {
    const base =
      scope === 'me'
        ? notifications.filter((n) => n.targetProfileId === activeProfileId)
        : notifications;
    return filterByDate(base, dateFilter).sort((a, b) => b.createdAt - a.createdAt);
  }, [notifications, activeProfileId, dateFilter, scope]);

  return (
    <MorphPresence show={isOpen}>
      {(visible) => (
        <div
          className={`fixed inset-0 z-[520] flex items-end sm:items-center justify-center p-4 ${
            visible ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
          role="presentation"
        >
          <button
            type="button"
            className={`absolute inset-0 account-toast-scrim morph-scrim ${
              visible ? 'morph-scrim--in' : 'morph-scrim--out'
            }`}
            aria-label="Close notifications inbox"
            onClick={onClose}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Notifications inbox"
            className={`account-toast-modal morph-panel relative w-full max-w-md rounded-[32px] p-5 shadow-2xl max-h-[min(82vh,36rem)] overflow-hidden flex flex-col ${
              visible ? 'morph-panel--in' : 'morph-panel--out'
            } ${isLight ? 'bg-white text-zinc-900' : 'bg-zinc-900 text-white'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 mb-3 shrink-0">
              <div className="min-w-0">
                <h3 className="text-lg font-black ">Notifications</h3>
                <p className={`app-subtext text-[10px] ${isLight ? 'text-black/50' : 'text-white/50'}`}>
                  {filtered.length} shown
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className={`p-2 rounded-full active:scale-90 ${isLight ? 'bg-zinc-100' : 'bg-white/10'}`}
                aria-label="Close"
              >
                <Icons.X size={18} />
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-3 shrink-0">
              <FluidSegmentControl
                isLight={isLight}
                size="sm"
                ariaLabel="Notification scope"
                value={scope}
                onChange={(id) => setScope(id)}
                options={[
                  { id: 'me', label: 'My profile' },
                  { id: 'all', label: 'All profiles' },
                ]}
              />
            </div>

            <div className="mb-3 shrink-0 overflow-x-auto no-scrollbar">
              <FluidSegmentControl
                isLight={isLight}
                size="sm"
                variant="chip"
                ariaLabel="Filter by date"
                value={dateFilter}
                onChange={(id) => setDateFilter(id)}
                options={DATE_OPTIONS}
              />
            </div>

            <div className="overflow-y-auto custom-scrollbar space-y-2 min-h-0 flex-1" role="list" aria-label="Notification list">
              {filtered.length === 0 ? (
                <div className={`p-10 text-center rounded-2xl ${isLight ? 'bg-zinc-50' : 'bg-white/5'}`}>
                  <p className="text-[11px] font-black opacity-50">Nothing here for this range</p>
                </div>
              ) : (
                filtered.map((n) => (
                  <div
                    key={n.id}
                    role="listitem"
                    className={`w-full text-left rounded-2xl px-3.5 py-3 border ${
                      n.readAt ? 'opacity-70' : ''
                    } ${
                      isLight
                        ? 'border-zinc-200 bg-zinc-50'
                        : 'border-white/10 bg-white/5'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] font-black ">{n.title}</p>
                      {!n.readAt && (
                        <span
                          className="shrink-0 mt-0.5 w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_2px_rgba(59,130,246,0.75)]"
                          aria-label="Unread"
                        />
                      )}
                    </div>
                    <p className="text-[10px] font-semibold opacity-70 mt-0.5 leading-snug">{n.body}</p>
                    <p className="text-[8px] font-bold opacity-40 mt-1.5 uppercase " style={{ letterSpacing: 0 }}>
                      {new Date(n.createdAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </MorphPresence>
  );
};

export default SettingsNotificationsInbox;
