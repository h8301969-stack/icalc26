import React, { useMemo } from 'react';
import { UserProfile } from '../types';
import { isAdminProfile } from '../utils/auth';
import { MorphPresence } from './MorphCrossfade';
import ProfileAvatar from './ProfileAvatar';
import { Icons } from '../constants';

interface AdminProfilesPopupProps {
  isOpen: boolean;
  onClose: () => void;
  isLight: boolean;
  profiles: UserProfile[];
  activeProfileId: string;
}

const AdminProfilesPopup: React.FC<AdminProfilesPopupProps> = ({
  isOpen,
  onClose,
  isLight,
  profiles,
  activeProfileId,
}) => {
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
            <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 shrink-0 border-b border-current/10">
              <div className="min-w-0">
                <h3 className="text-base font-black tracking-tight">Profiles</h3>
                <p className={`app-subtext text-[10px] ${isLight ? 'text-black/50' : 'text-white/50'}`}>
                  Active on this device · others offline
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
                  return (
                    <div
                      key={profile.id}
                      className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 border ${
                        active
                          ? isLight
                            ? 'border-emerald-300 bg-emerald-50'
                            : 'border-emerald-500/40 bg-emerald-500/10'
                          : isLight
                            ? 'border-zinc-200 bg-zinc-50'
                            : 'border-white/10 bg-white/5'
                      }`}
                    >
                      <div className="relative shrink-0">
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
                            <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider opacity-50">
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
                        >
                          {active ? 'Active' : 'Offline'}
                        </p>
                      </div>
                    </div>
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
