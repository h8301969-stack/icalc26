import React, { useEffect, useMemo, useRef, useState } from 'react';
import { UserProfile } from '../types';
import { isAdminProfile } from '../utils/auth';
import { MorphPresence } from './MorphCrossfade';
import ProfileAvatar from './ProfileAvatar';
import { Icons } from '../constants';
import {
  formatPresenceTime,
  getProfilePresence,
  heartbeatProfilePresence,
  touchProfilePresence,
} from '../utils/profilePresence';

interface AdminProfilesPopupProps {
  isOpen: boolean;
  onClose: () => void;
  isLight: boolean;
  profiles: UserProfile[];
  activeProfileId: string;
  onSelectProfile?: (profileId: string) => void;
}

const HOLD_MS = 480;

const AdminProfilesPopup: React.FC<AdminProfilesPopupProps> = ({
  isOpen,
  onClose,
  isLight,
  profiles,
  activeProfileId,
  onSelectProfile,
}) => {
  const [heldId, setHeldId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const holdTimer = useRef<number | null>(null);
  const holdFired = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      setHeldId(null);
      return;
    }
    const tick = window.setInterval(() => {
      setNow(Date.now());
      if (activeProfileId) heartbeatProfilePresence(activeProfileId);
    }, 30_000);
    if (activeProfileId) heartbeatProfilePresence(activeProfileId);
    return () => window.clearInterval(tick);
  }, [isOpen, activeProfileId]);

  useEffect(
    () => () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    },
    []
  );

  const rows = useMemo(() => {
    const list = profiles.length > 0 ? profiles : [];
    return [...list].sort((a, b) => {
      const aActive = a.id === activeProfileId ? 0 : 1;
      const bActive = b.id === activeProfileId ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      if (isAdminProfile(a) !== isAdminProfile(b)) return isAdminProfile(a) ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [profiles, activeProfileId]);

  const clearHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const startHold = (profileId: string) => {
    holdFired.current = false;
    clearHold();
    holdTimer.current = window.setTimeout(() => {
      holdFired.current = true;
      setHeldId((prev) => (prev === profileId ? null : profileId));
      if ('vibrate' in navigator) navigator.vibrate(10);
    }, HOLD_MS);
  };

  const endHold = (profileId: string) => {
    clearHold();
    if (holdFired.current) {
      holdFired.current = false;
      return;
    }
    // Short tap collapses details if open; otherwise selects / switches profile
    if (heldId === profileId) {
      setHeldId(null);
      return;
    }
    if (onSelectProfile && profileId !== activeProfileId) {
      touchProfilePresence(profileId);
      onSelectProfile(profileId);
    }
  };

  return (
    <MorphPresence show={isOpen}>
      {(visible) => (
        <div
          className={`fixed inset-0 z-[520] flex items-center justify-center p-4 ${
            visible ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
          role="presentation"
        >
          <button
            type="button"
            className={`absolute inset-0 account-toast-scrim morph-scrim ${
              visible ? 'morph-scrim--in' : 'morph-scrim--out'
            }`}
            aria-label="Close profiles panel"
            onClick={onClose}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Account profiles"
            className={`admin-profiles-popup morph-panel relative overflow-hidden flex flex-col shadow-2xl border ${
              visible ? 'morph-panel--in' : 'morph-panel--out'
            } ${isLight ? 'bg-white/95 border-zinc-200 text-zinc-900' : 'bg-zinc-900/95 border-white/12 text-white'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 shrink-0 border-b border-current/10">
              <div className="min-w-0">
                <h3 className="text-base font-black ">Profiles</h3>
                <p className={`app-subtext text-[10px] ${isLight ? 'text-black/50' : 'text-white/50'}`} style={{ letterSpacing: 0 }}>
                  Tap to switch · hold for details
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className={`p-2 rounded-full active:scale-90 ${isLight ? 'bg-zinc-100' : 'bg-white/10'}`}
                aria-label="Close"
              >
                <Icons.X size={16} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-2">
              {rows.length === 0 ? (
                <p className="text-[11px] font-bold opacity-50 text-center py-10">No profiles yet</p>
              ) : (
                rows.map((profile) => {
                  const active = profile.id === activeProfileId;
                  const presence = getProfilePresence(profile.id);
                  const expanded = heldId === profile.id;
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      className={`w-full text-left flex items-start gap-3 rounded-2xl px-3 py-2.5 border transition-all active:scale-[0.99] ${
                        active
                          ? isLight
                            ? 'border-emerald-300 bg-emerald-50'
                            : 'border-emerald-500/40 bg-emerald-500/10'
                          : isLight
                            ? 'border-zinc-200 bg-zinc-50'
                            : 'border-white/10 bg-white/5'
                      }`}
                      onPointerDown={() => startHold(profile.id)}
                      onPointerUp={() => endHold(profile.id)}
                      onPointerLeave={clearHold}
                      onPointerCancel={clearHold}
                      onContextMenu={(e) => e.preventDefault()}
                      aria-label={`${profile.name}, ${active ? 'active' : 'inactive'}. Hold for details.`}
                    >
                      <div className="relative shrink-0 mt-0.5">
                        <ProfileAvatar profile={profile} size={40} isLight={isLight} />
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 ${
                            isLight ? 'border-white' : 'border-zinc-900'
                          } ${active ? 'bg-emerald-500' : 'bg-zinc-400'}`}
                          aria-hidden
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-black truncate">
                          {profile.name}
                          {isAdminProfile(profile) ? (
                            <span className="ml-1.5 text-[9px] font-bold uppercase opacity-50">
                              admin
                            </span>
                          ) : null}
                        </p>
                        <p
                          className={`text-[10px] font-bold ${
                            active
                              ? isLight
                                ? 'text-emerald-700'
                                : 'text-emerald-400'
                              : isLight
                                ? 'text-zinc-500'
                                : 'text-white/45'
                          }`}
                          style={{ letterSpacing: 0 }}
                        >
                          {active ? 'Active' : 'Inactive'}
                        </p>
                        {expanded && (
                          <div
                            className={`mt-2 space-y-0.5 text-[10px] font-semibold ${
                              isLight ? 'text-zinc-600' : 'text-white/60'
                            }`}
                            style={{ letterSpacing: 0 }}
                          >
                            <p>{active ? 'Logged in' : 'Logged out'}</p>
                            <p>
                              Last seen:{' '}
                              {presence
                                ? formatPresenceTime(presence.lastSeenAt, now)
                                : active
                                  ? 'just now'
                                  : 'never on this device'}
                            </p>
                            <p>
                              Last login:{' '}
                              {presence
                                ? formatPresenceTime(presence.lastLoginAt, now)
                                : active
                                  ? 'this session'
                                  : '—'}
                            </p>
                            {active && presence?.sessionStartedAt ? (
                              <p>Session: {formatPresenceTime(presence.sessionStartedAt, now)}</p>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </MorphPresence>
  );
};

export default AdminProfilesPopup;
