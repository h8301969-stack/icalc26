import React, { useMemo, useRef, useState } from 'react';
import { Icons } from '../constants';
import { NewProfileInput, ProfileSellerType, UserProfile } from '../types';
import ProfileAvatar from './ProfileAvatar';
import { ADMIN_PROFILE_NAME, isAdminProfile } from '../utils/auth';

interface ProfilePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLight: boolean;
  profiles: UserProfile[];
  activeProfileId: string;
  onSelectProfile: (profileId: string) => void;
  onAddProfile: (profile: NewProfileInput) => void | Promise<void>;
  onUpdateProfileAvatar: (profileId: string, avatarUrl: string) => void;
  onVerifyAdminPassword?: (password: string) => Promise<{ error?: string; ok?: boolean }>;
}

const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

const readImageFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.readAsDataURL(file);
  });

const ProfilePickerModal: React.FC<ProfilePickerModalProps> = ({
  isOpen,
  onClose,
  isLight,
  profiles,
  activeProfileId,
  onSelectProfile,
  onAddProfile,
  onUpdateProfileAvatar,
  onVerifyAdminPassword,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newSellerType, setNewSellerType] = useState<ProfileSellerType>('retailer');
  const [newAvatarUrl, setNewAvatarUrl] = useState('');
  const [avatarTargetId, setAvatarTargetId] = useState<string | null>(null);
  const [adminTargetId, setAdminTargetId] = useState<string | null>(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordError, setAdminPasswordError] = useState<string | null>(null);
  const [isVerifyingAdmin, setIsVerifyingAdmin] = useState(false);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const isCurrentlyAdmin = isAdminProfile(activeProfile);

  const visibleProfiles = useMemo(() => {
    if (isCurrentlyAdmin) return profiles;
    return profiles.filter((p) => !isAdminProfile(p));
  }, [profiles, isCurrentlyAdmin]);

  if (!isOpen) return null;

  const panelBg = isLight ? 'bg-[#f2f2f7] text-zinc-900' : 'bg-[#1c1c1e] text-white';
  const rowBg = isLight ? 'bg-white border-zinc-200' : 'bg-zinc-800/60 border-white/5';
  const inputClass = isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-white';

  const openGallery = (profileId: string | 'new') => {
    setAvatarTargetId(profileId);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !avatarTargetId) return;

    try {
      const dataUrl = await readImageFile(file);
      if (avatarTargetId === 'new') {
        setNewAvatarUrl(dataUrl);
      } else {
        onUpdateProfileAvatar(avatarTargetId, dataUrl);
      }
    } catch {
      // ignore read errors
    }
    setAvatarTargetId(null);
  };

  const canCreateProfile =
    !!newName.trim()
    && newName.trim().toLowerCase() !== ADMIN_PROFILE_NAME.toLowerCase()
    && isValidEmail(newEmail)
    && !!newPhone.trim()
    && !!newSellerType;

  const handleCreate = async () => {
    const name = newName.trim();
    const email = newEmail.trim();
    const phone = newPhone.trim();
    if (!canCreateProfile || isCreatingProfile) return;
    setIsCreatingProfile(true);
    try {
      await onAddProfile({
        name,
        avatarUrl: newAvatarUrl,
        email,
        phone,
        sellerType: newSellerType,
      });
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      setNewSellerType('retailer');
      setNewAvatarUrl('');
      setIsAdding(false);
      onClose();
    } finally {
      setIsCreatingProfile(false);
    }
  };

  const completeSelect = (profileId: string) => {
    onSelectProfile(profileId);
    onClose();
  };

  const handleSelect = (profileId: string) => {
    if (profileId === activeProfileId) {
      onClose();
      return;
    }

    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;

    if (isAdminProfile(profile)) {
      if (!onVerifyAdminPassword) return;
      setAdminTargetId(profileId);
      setAdminPassword('');
      setAdminPasswordError(null);
      return;
    }

    completeSelect(profileId);
  };

  const handleAdminPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminTargetId || !onVerifyAdminPassword || isVerifyingAdmin) return;
    setAdminPasswordError(null);
    setIsVerifyingAdmin(true);
    try {
      const result = await onVerifyAdminPassword(adminPassword);
      if (result.error) {
        setAdminPasswordError(result.error);
        return;
      }
      setAdminTargetId(null);
      setAdminPassword('');
      completeSelect(adminTargetId);
    } finally {
      setIsVerifyingAdmin(false);
    }
  };

  const resetAddForm = () => {
    if (isCreatingProfile) return;
    setIsAdding(false);
    setNewName('');
    setNewEmail('');
    setNewPhone('');
    setNewSellerType('retailer');
    setNewAvatarUrl('');
  };

  const resetAll = () => {
    if (isCreatingProfile) return;
    resetAddForm();
    setAdminTargetId(null);
    setAdminPassword('');
    setAdminPasswordError(null);
  };

  const handleClose = () => {
    if (isCreatingProfile) return;
    resetAll();
    onClose();
  };

  const draftProfile: UserProfile = {
    id: 'draft',
    name: newName || 'New',
    avatarUrl: newAvatarUrl,
  };

  const adminProfile = profiles.find((p) => isAdminProfile(p));
  const showAdminUnlock = !isCurrentlyAdmin && !!adminProfile && !adminTargetId;

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-4 pointer-events-auto">
      <div
        className={`absolute inset-0 ${isLight ? 'bg-[#f2f2f7]' : 'bg-[#0a0a0c]'}`}
        onClick={handleClose}
        aria-hidden="true"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        aria-hidden="true"
      />

      <div
        className={`relative w-full max-w-sm rounded-[28px] overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.45)] ${panelBg}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-picker-title"
      >
        {adminTargetId ? (
          <form onSubmit={(e) => void handleAdminPasswordSubmit(e)} className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black tracking-tight">Unlock @admin</h3>
              <button
                type="button"
                onClick={() => { setAdminTargetId(null); setAdminPassword(''); setAdminPasswordError(null); }}
                aria-label="Cancel admin unlock"
                className={`p-2 rounded-full ${isLight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
              >
                <Icons.X size={22} />
              </button>
            </div>
            <p className={`app-subtext text-[11px] leading-relaxed ${isLight ? 'text-black/60' : 'text-white/60'}`}>
              Enter the account password (one-time code or your changed password) to switch to the admin profile.
            </p>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Admin password"
              autoFocus
              autoComplete="current-password"
              className={`w-full p-4 rounded-2xl outline-none font-black text-base ${inputClass}`}
            />
            {adminPasswordError && (
              <p className="text-red-500 text-[11px] font-bold" role="alert">{adminPasswordError}</p>
            )}
            <button
              type="submit"
              disabled={isVerifyingAdmin || !adminPassword}
              className={`w-full py-4 rounded-2xl text-xs font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center gap-2 ${
                isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'
              }`}
            >
              {isVerifyingAdmin ? (
                <>
                  <span className="auth-spinner" aria-hidden="true" />
                  Verifying…
                </>
              ) : (
                'Unlock @admin'
              )}
            </button>
          </form>
        ) : (
          <>
            <div className={`px-5 pt-5 pb-3 flex items-center justify-between border-b ${isLight ? 'border-black/6' : 'border-white/6'}`}>
              <h3 id="profile-picker-title" className="text-lg font-black tracking-tight">
                {isAdding ? 'New profile' : 'Profiles'}
              </h3>
              <div className="flex items-center gap-2">
                {!isAdding && (
                  <button
                    type="button"
                    onClick={() => setIsAdding(true)}
                    aria-label="Add new profile"
                    className={`w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-all ${
                      isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'
                    }`}
                  >
                    <Icons.Plus size={20} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Close profiles"
                  disabled={isCreatingProfile}
                  className={`p-2 rounded-full ${isLight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
                >
                  <Icons.X size={22} />
                </button>
              </div>
            </div>

            {isAdding ? (
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <div className="flex flex-col items-center gap-3">
                  <ProfileAvatar
                    profile={draftProfile}
                    size={88}
                    isLight={isLight}
                    onClick={isCreatingProfile ? undefined : () => openGallery('new')}
                    ariaLabel="Choose avatar from gallery"
                  />
                  <span className="app-subtext text-[10px] opacity-45">
                    Tap avatar to choose image
                  </span>
                </div>
                <label className="block">
                  <span className="app-subtext text-[10px] font-black opacity-60 block mb-1.5">
                    Profile name <span className="text-red-500">*</span>
                  </span>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Profile name"
                    autoFocus
                    disabled={isCreatingProfile}
                    className={`w-full p-4 rounded-2xl outline-none font-black text-base disabled:opacity-50 ${inputClass}`}
                  />
                </label>
                <label className="block">
                  <span className="app-subtext text-[10px] font-black opacity-60 block mb-1.5">
                    Email <span className="text-red-500">*</span>
                  </span>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    disabled={isCreatingProfile}
                    className={`w-full p-4 rounded-2xl outline-none font-black text-base disabled:opacity-50 ${inputClass}`}
                  />
                </label>
                <label className="block">
                  <span className="app-subtext text-[10px] font-black opacity-60 block mb-1.5">
                    Number <span className="text-red-500">*</span>
                  </span>
                  <input
                    type="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="+233 …"
                    autoComplete="tel"
                    disabled={isCreatingProfile}
                    className={`w-full p-4 rounded-2xl outline-none font-black text-base disabled:opacity-50 ${inputClass}`}
                  />
                </label>
                <div>
                  <span className="app-subtext text-[10px] font-black opacity-60 block mb-2">
                    Type <span className="text-red-500">*</span>
                  </span>
                  <div className={`flex rounded-full overflow-hidden border ${isLight ? 'border-zinc-200' : 'border-white/10'}`}>
                    <button
                      type="button"
                      disabled={isCreatingProfile}
                      onClick={() => setNewSellerType('retailer')}
                      className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 ${
                        newSellerType === 'retailer'
                          ? isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'
                          : 'opacity-50'
                      }`}
                    >
                      Retailer
                    </button>
                    <button
                      type="button"
                      disabled={isCreatingProfile}
                      onClick={() => setNewSellerType('wholesaler')}
                      className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 ${
                        newSellerType === 'wholesaler'
                          ? isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'
                          : 'opacity-50'
                      }`}
                    >
                      Wholesaler
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={isCreatingProfile || !canCreateProfile}
                  className={`w-full py-4 rounded-2xl text-xs font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center gap-2 ${
                    isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'
                  }`}
                >
                  {isCreatingProfile ? (
                    <>
                      <span className="auth-spinner" aria-hidden="true" />
                      Creating…
                    </>
                  ) : (
                    'Create profile'
                  )}
                </button>
              </div>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto custom-scrollbar p-3 space-y-2">
                {visibleProfiles.map((profile) => {
                  const isActive = profile.id === activeProfileId;
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => handleSelect(profile.id)}
                      className={`w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all active:scale-[0.98] ${
                        isActive
                          ? isLight
                            ? 'bg-zinc-900 text-white border-zinc-900'
                            : 'bg-white text-black border-white'
                          : rowBg
                      }`}
                    >
                      <ProfileAvatar
                        profile={profile}
                        size={48}
                        isLight={isLight && !isActive}
                        onClick={() => openGallery(profile.id)}
                        ariaLabel={`Change photo for ${profile.name}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-black truncate">{profile.name}</div>
                        <div className={`app-subtext text-[10px] font-bold mt-0.5 ${isActive ? 'opacity-50' : 'opacity-60'}`}>
                          {isActive ? 'Active' : ''}
                        </div>
                      </div>
                      {isActive && <Icons.Check size={18} />}
                    </button>
                  );
                })}

                {showAdminUnlock && adminProfile && (
                  <button
                    type="button"
                    onClick={() => handleSelect(adminProfile.id)}
                    className={`w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all active:scale-[0.98] ${rowBg}`}
                  >
                    <ProfileAvatar
                      profile={adminProfile}
                      size={48}
                      isLight={isLight}
                      ariaLabel="@admin profile"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-black truncate">{ADMIN_PROFILE_NAME}</div>
                      <div className="app-subtext text-[10px] font-bold mt-0.5 opacity-60">
                        system admin • password required
                      </div>
                    </div>
                    <span className="opacity-60 shrink-0"><Icons.Lock size={18} /></span>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ProfilePickerModal;