import React, { useRef, useState } from 'react';
import { Icons } from '../constants';
import { UserProfile } from '../types';
import ProfileAvatar from './ProfileAvatar';

interface ProfilePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLight: boolean;
  profiles: UserProfile[];
  activeProfileId: string;
  onSelectProfile: (profileId: string) => void;
  onAddProfile: (name: string, avatarUrl: string) => void;
  onUpdateProfileAvatar: (profileId: string, avatarUrl: string) => void;
}

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
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAvatarUrl, setNewAvatarUrl] = useState('');
  const [avatarTargetId, setAvatarTargetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const panelBg = isLight ? 'bg-[#f2f2f7] text-zinc-900' : 'bg-[#1c1c1e] text-white';
  const rowBg = isLight ? 'bg-white border-zinc-200' : 'bg-zinc-800/60 border-white/5';

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

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onAddProfile(name, newAvatarUrl);
    setNewName('');
    setNewAvatarUrl('');
    setIsAdding(false);
    onClose();
  };

  const handleSelect = (profileId: string) => {
    onSelectProfile(profileId);
    onClose();
  };

  const resetAddForm = () => {
    setIsAdding(false);
    setNewName('');
    setNewAvatarUrl('');
  };

  const draftProfile: UserProfile = {
    id: 'draft',
    name: newName || 'New',
    avatarUrl: newAvatarUrl,
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-4 pointer-events-auto">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-md"
        onClick={() => { resetAddForm(); onClose(); }}
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
              onClick={() => { resetAddForm(); onClose(); }}
              aria-label="Close profiles"
              className={`p-2 rounded-full ${isLight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
            >
              <Icons.X size={22} />
            </button>
          </div>
        </div>

        {isAdding ? (
          <div className="p-6 space-y-6">
            <div className="flex flex-col items-center gap-3">
              <ProfileAvatar
                profile={draftProfile}
                size={88}
                isLight={isLight}
                onClick={() => openGallery('new')}
                ariaLabel="Choose avatar from gallery"
              />
              <span className="text-[10px] font-black uppercase tracking-widest opacity-40">
                Tap avatar to choose image
              </span>
            </div>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Profile name"
              autoFocus
              className={`w-full p-4 rounded-2xl outline-none font-black text-base ${
                isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-white'
              }`}
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newName.trim()}
              className={`w-full py-4 rounded-2xl text-xs font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40 ${
                isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'
              }`}
            >
              Create profile
            </button>
          </div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto custom-scrollbar p-3 space-y-2">
            {profiles.map((profile) => {
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
                    {isActive && (
                      <div className="text-[10px] font-bold uppercase tracking-widest opacity-50 mt-0.5">
                        Active
                      </div>
                    )}
                  </div>
                  {isActive && <Icons.Check size={18} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfilePickerModal;