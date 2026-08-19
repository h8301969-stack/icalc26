import React from 'react';
import { Icons } from '../constants';
import { MorphPresence } from './MorphCrossfade';
import type { AccountNotificationsApi } from '../hooks/useAccountNotifications';

interface AccountToastHostProps {
  isLight: boolean;
  api: AccountNotificationsApi;
}

const AccountToastHost: React.FC<AccountToastHostProps> = ({ isLight, api }) => {
  const {
    activeToast,
    listOpen,
    listItems,
    notificationStyle,
    cascadeActive,
    dismissToast,
    closeList,
    onPillPointerDown,
    onPillPointerUp,
  } = api;

  // Profile-switch cascade always uses pill banners (0.9s / last 2.2s)
  const showPill =
    (notificationStyle === 'pill' || cascadeActive) && !!activeToast && !listOpen;
  const showModalToast =
    notificationStyle === 'modal' && !cascadeActive && !!activeToast && !listOpen;

  return (
    <>
      {/* Style 2 — top pill banner */}
      <MorphPresence show={showPill}>
        {(visible) => (
          <div
            className={`account-toast-pill morph-panel fixed left-1/2 z-[500] -translate-x-1/2 px-4 py-2.5 max-w-[min(28rem,calc(100vw-1.5rem))] w-[min(28rem,calc(100vw-1.5rem))] ${
              visible ? 'morph-panel--in' : 'morph-panel--out'
            } ${isLight ? 'account-toast-pill--light' : 'account-toast-pill--dark'}`}
            style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
            onPointerDown={onPillPointerDown}
            onPointerUp={onPillPointerUp}
            onPointerCancel={onPillPointerUp}
            onPointerLeave={onPillPointerUp}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-2 min-w-0">
              <span className="account-toast-pill__dot shrink-0 mt-1.5" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-black tracking-tight truncate">{activeToast?.title}</p>
                <p className="text-[10px] font-semibold opacity-70 truncate">{activeToast?.body}</p>
              </div>
            </div>
            <p className="mt-1 text-[8px] font-bold uppercase tracking-wider opacity-40 text-center">
              Hold for details
            </p>
          </div>
        )}
      </MorphPresence>

      {/* Style 1 — centered modal for a single live toast */}
      <MorphPresence show={showModalToast}>
        {(visible) => (
          <div
            className={`fixed inset-0 z-[500] flex items-center justify-center p-6 ${
              visible ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            role="presentation"
          >
            <button
              type="button"
              className={`absolute inset-0 account-toast-scrim morph-scrim ${
                visible ? 'morph-scrim--in' : 'morph-scrim--out'
              }`}
              aria-label="Dismiss notification"
              onClick={dismissToast}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={activeToast?.title}
              className={`account-toast-modal morph-panel relative w-full max-w-sm rounded-[28px] p-5 shadow-2xl ${
                visible ? 'morph-panel--in' : 'morph-panel--out'
              } ${isLight ? 'bg-white text-zinc-900' : 'bg-zinc-900 text-white'}`}
              onClick={dismissToast}
            >
              <p className="text-sm font-black tracking-tight">{activeToast?.title}</p>
              <p className="mt-2 text-[12px] font-semibold leading-relaxed opacity-75">
                {activeToast?.body}
              </p>
              <p className="mt-4 text-[9px] font-bold uppercase tracking-wider opacity-40 text-center">
                Tap anywhere to dismiss
              </p>
            </div>
          </div>
        )}
      </MorphPresence>

      {/* Hold → list popup (also used from pill) */}
      <MorphPresence show={listOpen}>
        {(visible) => (
          <div
            className={`fixed inset-0 z-[510] flex items-center justify-center p-6 ${
              visible ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            role="presentation"
          >
            <button
              type="button"
              className={`absolute inset-0 account-toast-scrim morph-scrim ${
                visible ? 'morph-scrim--in' : 'morph-scrim--out'
              }`}
              aria-label="Close notifications"
              onClick={closeList}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Notifications"
              className={`account-toast-modal morph-panel relative w-full max-w-sm rounded-[28px] p-5 shadow-2xl max-h-[min(70vh,28rem)] overflow-hidden flex flex-col ${
                visible ? 'morph-panel--in' : 'morph-panel--out'
              } ${isLight ? 'bg-white text-zinc-900' : 'bg-zinc-900 text-white'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 mb-3 shrink-0">
                <h3 className="text-base font-black tracking-tight">Notifications</h3>
                <button
                  type="button"
                  onClick={closeList}
                  className={`p-1.5 rounded-full active:scale-90 ${
                    isLight ? 'bg-zinc-100' : 'bg-white/10'
                  }`}
                  aria-label="Close"
                >
                  <Icons.X size={16} />
                </button>
              </div>
              <div className="overflow-y-auto custom-scrollbar space-y-2 min-h-0">
                {listItems.length === 0 ? (
                  <p className="text-[11px] font-bold opacity-50 py-6 text-center">No notifications</p>
                ) : (
                  listItems.map((n) => (
                    <div
                      key={n.id}
                      className={`rounded-2xl px-3.5 py-3 border ${
                        isLight ? 'border-zinc-200 bg-zinc-50' : 'border-white/10 bg-white/5'
                      }`}
                    >
                      <p className="text-[11px] font-black tracking-tight">{n.title}</p>
                      <p className="text-[10px] font-semibold opacity-70 mt-0.5 leading-snug">{n.body}</p>
                      <p className="text-[8px] font-bold opacity-40 mt-1.5 uppercase tracking-wider">
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
    </>
  );
};

export default AccountToastHost;
