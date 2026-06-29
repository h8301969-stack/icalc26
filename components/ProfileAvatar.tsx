import React from 'react';
import { UserProfile } from '../types';

interface ProfileAvatarProps {
  profile: UserProfile | null;
  size?: number;
  isLight: boolean;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  ariaLabel?: string;
}

const ProfileAvatar: React.FC<ProfileAvatarProps> = ({
  profile,
  size = 72,
  isLight,
  onClick,
  className = '',
  ariaLabel,
}) => {
  const initial = (profile?.name || 'U').charAt(0).toUpperCase();
  const hasImage = !!profile?.avatarUrl;

  const inner = hasImage ? (
    <img
      src={profile!.avatarUrl}
      alt=""
      className="w-full h-full object-cover"
    />
  ) : (
    <span className="font-black" style={{ fontSize: size * 0.38 }}>
      {initial}
    </span>
  );

  const baseClass = `rounded-full overflow-hidden flex items-center justify-center shrink-0 ${
    isLight ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-900'
  }`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(e);
        }}
        aria-label={ariaLabel ?? `Avatar for ${profile?.name ?? 'profile'}`}
        className={`${baseClass} active:scale-95 transition-transform ${className}`}
        style={{ width: size, height: size }}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      className={`${baseClass} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
    >
      {inner}
    </div>
  );
};

export default ProfileAvatar;