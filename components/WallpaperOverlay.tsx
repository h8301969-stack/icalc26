
import React, { useState, useEffect } from 'react';
import { Icons } from '../constants';
import icalcLogo from '../assets/logo/icalc-logo.png';

interface WallpaperOverlayProps {
  onEnter: () => void;
  isLight: boolean;
  accentColor: string;
}

const WallpaperOverlay: React.FC<WallpaperOverlayProps> = ({ onEnter, isLight, accentColor: _accentColor }) => {
  const [time, setTime] = useState(new Date());
  const [isEntering, setIsEntering] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleEnter = () => {
    setIsEntering(true);
    if ('vibrate' in navigator) navigator.vibrate([10, 30]);
    setTimeout(onEnter, 700);
  };

  const timeString = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <div className={`fixed inset-0 z-[1000] flex flex-col items-center justify-between p-12 transition-all duration-700 cubic-bezier(0.16, 1, 0.3, 1) ${isEntering ? 'opacity-0 scale-125' : 'opacity-100 scale-100'}`}>
      <div className="absolute top-12 left-12 flex items-center gap-3 select-none">
        <div className="unlock-logo-wrap shrink-0 w-14 h-14">
          <img
            src={icalcLogo}
            alt="iCalc logo"
            className="w-full h-full object-cover"
            draggable={false}
          />
        </div>
        <div
          className="text-5xl leading-none tracking-tighter"
          style={{
            fontWeight: 810,
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif',
          }}
          aria-label="iCalc 26"
        >
          <span
            className="italic text-white"
            style={{ fontFamily: 'Georgia, "Times New Roman", cursive' }}
          >
            i
          </span>
          <span className="text-black">Calc</span>
          <span className="unlock-brand-26">26</span>
        </div>
      </div>

      <div className="flex flex-col items-center mt-20 select-none pointer-events-none">
        <p className="font-text text-[12px] font-black uppercase tracking-[0.5em] opacity-40 mb-4" style={{ color: isLight ? '#000' : '#fff' }}>
          Spatial Hub
        </p>
        <h1
          className="font-num-light text-8xl tracking-tighter mb-2 tabular-nums"
          style={{ color: isLight ? '#000' : '#fff' }}
        >
          {timeString}
        </h1>
        <p className="font-text text-xl font-medium opacity-60" style={{ color: isLight ? '#000' : '#fff' }}>
          {time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      <div className="flex flex-col items-center w-full max-w-xs space-y-10">
        <button
          onClick={handleEnter}
          className="group relative w-full py-6 rounded-[20.8px] overflow-hidden transition-all duration-300 active:scale-90 shadow-2xl glass-panel"
          style={{
            background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
            border: isLight ? '1px solid rgba(0,0,0,0.1)' : '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full" />
          <span className="relative z-10 text-[11px] font-black uppercase tracking-[0.6em] ml-2" style={{ color: isLight ? '#000' : '#fff' }}>Unlock iCalc</span>
        </button>

        <div className="flex items-center gap-6 opacity-30" style={{ color: isLight ? '#000' : '#fff' }}>
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