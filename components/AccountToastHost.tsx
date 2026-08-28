import React, { useRef } from 'react';
import { Icons } from '../constants';
import { MorphPresence } from './MorphCrossfade';
import type { AccountNotificationsApi } from '../hooks/useAccountNotifications';

interface AccountToastHostProps {
  isLight: boolean;
  api: AccountNotificationsApi;
}

const SWIPE_DISMISS_PX = 48;

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

  const startY = useRef(0);
  const startX = useRef(0);
  const swiping = useRef(false);

  // Profile-switch cascade + pill banners
  const showPill =
    (notificationStyle === 'pill' || cascadeActive) && !!activeToast && !listOpen;
  const showModalToast =
    notificationStyle === 'modal' && !cascadeActive && !!activeToast && !listOpen;

  const handlePillPointerDown = (e: React.PointerEvent) => {
    startY.current = e.clientY;
    startX.current = e.clientX;
    swiping.current = false;
    onPillPointerDown();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePillPointerMove = (e: React.PointerEvent) => {
    const dy = e.clientY - startY.current;
    const dx = e.clientX - startX.current;
    if (!swiping.current && (Math.abs(dy) > 10 || Math.abs(dx) > 10)) {
      swiping.current = true;
      // Cancel hold-to-open-list once a swipe starts
      onPillPointerUp();
    }
  };

  const handlePillPointerUp = (e: React.PointerEvent) => {
    const dy = e.clientY - startY.current;
    const dx = e.clientX - startX.current;
    onPillPointerUp();
    // Swipe up or down past threshold dismisses early (before the 10s timer)
    if (swiping.current && Math.abs(dy) >= SWIPE_DISMISS_PX && Math.abs(dy) >= Math.abs(dx)) {
      dismissToast();
    }
    swiping.current = false;
  };

  return (
    <>
      {/* Style 2 — top pill banner (sized like calculator search) */}
      <MorphPresence show={showPill}>
        {(visible) => (
          <div
            className={`account-toast-pill morph-panel fixed left-1/2 z-[500] -translate-x-1/2 ${
              visible ? 'morph-panel--in' : 'morph-panel--out'
            } ${isLight ? 'account-toast-pill--light' : 'account-toast-pill--dark'}`}
            style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
            onPointerDown={handlePillPointerDown}
            onPointerMove={handlePillPointerMove}
            onPointerUp={handlePillPointerUp}
            onPointerCancel={handlePillPointerUp}
            role="status"
            aria-live="polite"
            aria-label="Notification. Swipe to dismiss."
          >
            <div className="flex items-center gap-2 min-w-0 h-full">
              <span className="account-toast-pill__dot shrink-0" aria-hidden />
              <div className="min-w-0 flex-1 text-left">
                <p className="account-toast-pill__title text-sm font-black leading-tight truncate">
                  {activeToast?.title}
                </p>
                {activeToast?.body ? (
                  <p className="account-toast-pill__body text-[11px] font-semibold opacity-70 leading-tight truncate">
                    {activeToast.body}
                  </p>
                ) : null}
              </div>
            </div>
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
              <p className="text-sm font-black">{activeToast?.title}</p>
              <p className="mt-2 text-[12px] font-semibold leading-relaxed opacity-75">
                {activeToast?.body}
              </p>
              <p className="mt-4 text-[9px] font-bold uppercase opacity-40 text-center">
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
                <h3 className="text-base font-black">Notifications</h3>
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
                      <p className="text-[11px] font-black">{n.title}</p>
                      <p className="text-[10px] font-semibold opacity-70 mt-0.5 leading-snug">{n.body}</p>
                      <p className="text-[8px] font-bold opacity-40 mt-1.5 uppercase">
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
