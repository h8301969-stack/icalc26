import React from 'react';
import { Icons } from '../constants';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: any;
  updateSettings: (key: string, value: any) => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ 
  isOpen, 
  onClose, 
  settings, 
}) => {
  const isLight = settings.themeMode === 'light';

  return (
    <div 
      className={`
        absolute inset-0 z-50 flex flex-col transition-transform duration-300 cubic-bezier(0.16, 1, 0.3, 1)
        ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        ${isLight ? 'bg-[#f2f2f7] text-zinc-900' : 'bg-[#1c1c1e] text-white'}
      `}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div className="p-8 pb-4 flex items-center justify-between">
        <h2 id="settings-title" className="text-2xl font-black tracking-tight">Settings</h2>
        <button 
          onClick={onClose} 
          aria-label="Close settings panel"
          className={`p-2.5 rounded-full ${isLight ? 'bg-zinc-200 hover:bg-zinc-300' : 'bg-white/10 hover:bg-white/20'}`}
        >
          <Icons.X size={24} />
        </button>
      </div>
      
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center opacity-40">
        <div className="mb-4">
          <Icons.Settings size={48} />
        </div>
        <p className="text-xs font-black uppercase tracking-widest">Settings Page</p>
      </div>
    </div>
  );
};

export default SettingsPanel;
