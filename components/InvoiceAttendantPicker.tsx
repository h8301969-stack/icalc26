import React from 'react';
import { Icons } from '../constants';
import { UserProfile } from '../types';
import ProfileAvatar from './ProfileAvatar';

interface InvoiceAttendantPickerProps {
  isOpen: boolean;
  onClose: () => void;
  isLight: boolean;
  profiles: UserProfile[];
  selectedName: string;
  onSelectName: (name: string) => void;
}

const InvoiceAttendantPicker: React.FC<InvoiceAttendantPickerProps> = ({
  isOpen,
  onClose,
  isLight,
  profiles,
  selectedName,
  onSelectName,
}) => {
  if (!isOpen) return null;

  const panelBg = isLight ? 'bg-[#f2f2f7] text-zinc-900' : 'bg-[#1c1c1e] text-white';
  const rowBg = isLight ? 'bg-white border-zinc-200' : 'bg-zinc-800/60 border-white/5';

  const handleSelect = (name: string) => {
    onSelectName(name);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-4 pointer-events-auto">
      <div
        className={`absolute inset-0 ${isLight ? 'bg-[#f2f2f7]' : 'bg-[#0a0a0c]'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative w-full max-w-xs rounded-[24px] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.4)] ${panelBg}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="attendant-picker-title"
      >
        <div className={`px-4 pt-4 pb-2 flex items-center justify-between border-b ${isLight ? 'border-black/6' : 'border-white/6'}`}>
          <h3 id="attendant-picker-title" className="text-sm font-black tracking-tight">
            Print as
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`p-1.5 rounded-full ${isLight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
          >
            <Icons.X size={18} />
          </button>
        </div>
        <div className="max-h-[40vh] overflow-y-auto custom-scrollbar p-2 space-y-1.5">
          {profiles.map((profile) => {
            const isSelected = profile.name === selectedName;
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => handleSelect(profile.name)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all active:scale-[0.98] ${
                  isSelected
                    ? isLight
                      ? 'bg-zinc-900 text-white border-zinc-900'
                      : 'bg-white text-black border-white'
                    : rowBg
                }`}
              >
                <ProfileAvatar profile={profile} size={36} isLight={isLight && !isSelected} />
                <div className="flex-1 min-w-0 font-black truncate text-sm">{profile.name}</div>
                {isSelected && <Icons.Check size={16} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default InvoiceAttendantPicker;