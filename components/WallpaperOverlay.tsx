
import React, { useState, useEffect } from 'react';
import { Icons } from '../constants';

interface WallpaperOverlayProps {
  onEnter: () => void;
  isLight: boolean;
  accentColor: string;
}

const WallpaperOverlay: React.FC<WallpaperOverlayProps> = ({ onEnter, isLight, accentColor }) => {
  const [time, setTime] = useState(new Date());
  const [isEntering, setIsEntering] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleEnter = () => {
    setIsEntering(true);
    // Vibrate if supported
    if ('vibrate' in navigator) navigator.vibrate([10, 30]);
    setTimeout(onEnter, 700);
  };

  return (
    <div className={`fixed inset-0 z-[1000] flex flex-col items-center justify-between p-12 transition-all duration-700 cubic-bezier(0.16, 1, 0.3, 1) ${isEntering ? 'opacity-0 scale-125' : 'opacity-100 scale-100'}`}>
      <div className="flex flex-col items-center mt-20 select-none pointer-events-none">
        <p className="text-[12px] font-black uppercase tracking-[0.5em] opacity-40 mb-4" style={{ color: isLight ? '#000' : '#fff' }}>
          Spatial Hub
        </p>
        <h1 className="text-8xl font-black tracking-tighter mb-2" style={{ color: isLight ? '#000' : '#fff' }}>
          {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
        </h1>
        <p className="text-xl font-medium opacity-60" style={{ color: isLight ? '#000' : '#fff' }}>
          {time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      <div className="flex flex-col items-center w-full max-w-xs space-y-10">
        <button 
          onClick={handleEnter}
          className="group relative w-full py-6 rounded-[32px] overflow-hidden transition-all duration-300 active:scale-90 shadow-2xl glass-panel"
          style={{ 
            background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
            border: isLight ? '1px solid rgba(0,0,0,0.1)' : '1px solid rgba(255,255,255,0.1)' 
          }}
        >
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full" />
          <span className="relative z-10 text-[11px] font-black uppercase tracking-[0.6em] ml-2" style={{ color: isLight ? '#000' : '#fff' }}>Unlock iCalc</span>
        </button>

        <div className="flex items-center gap-6 opacity-30">
           <Icons.History size={20} />
           <div className="w-1 h-1 rounded-full bg-current" />
           <Icons.Scientific size={20} />
           <div className="w-1 h-1 rounded-full bg-current" />
           <Icons.Trends size={20} />
        </div>
      </div>
    </div>
  );
};

export default WallpaperOverlay;
