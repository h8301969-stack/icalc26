
import React, { useState, useEffect } from 'react';
import { Icons } from '../constants';
import { useSwipeAnywhere } from '../hooks/useGestures';
import icalcLogo from '../assets/logo/icalc-logo.png';

interface WallpaperOverlayProps {
  onEnter: () => void;
  isLight: boolean;
  accentColor: string;
}

const BrandHeader: React.FC = () => (
  <div className="absolute top-12 left-12 flex items-center gap-3 select-none pointer-events-none">
    <div className="unlock-logo-wrap shrink-0 w-14 h-14">
      <img
        src={icalcLogo}
        alt="iCalc logo"
        className="w-full h-full object-cover"
        draggable={false}
      />
    </div>
    <div
      className="font-brand text-5xl leading-none tracking-tighter font-black"
      aria-label="iCalc 26"
    >
      <span className="italic text-white font-bold">i</span>
      <span className="text-black">Calc</span>
      <span className="unlock-brand-26">26</span>
    </div>
  </div>
);

const SwipeHint: React.FC<{ isLight: boolean }> = ({ isLight }) => (
  <div className="flex flex-col items-center gap-4 select-none pointer-events-none">
    <p
      className="app-subtext text-[10px] animate-swipe-hint-pulse opacity-45"
      style={{ color: isLight ? '#000' : '#fff' }}
    >
      Tap or swipe anywhere to unlock
    </p>
    <div className="flex items-center gap-3 opacity-30" style={{ color: isLight ? '#000' : '#fff' }}>
      <Icons.History size={20} />
      <div className="w-1 h-1 rounded-full bg-current" />
      <Icons.Scientific size={20} />
      <div className="w-1 h-1 rounded-full bg-current" />
      <Icons.Trends size={20} />
    </div>
  </div>
);

const WallpaperOverlay: React.FC<WallpaperOverlayProps> = ({
  onEnter,
  isLight,
  accentColor: _accentColor,
}) => {
  const [time, setTime] = useState(new Date());
  const [isEntering, setIsEntering] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleEnter = () => {
    if (isEntering) return;
    setIsEntering(true);
    if ('vibrate' in navigator) navigator.vibrate([10, 30]);
    setTimeout(onEnter, 700);
  };

  const swipe = useSwipeAnywhere(handleEnter);

  const timeString = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const textColor = isLight ? '#000' : '#fff';

  return (
    <div
      className={`fixed inset-0 z-[1000] flex flex-col items-center justify-between p-12 touch-none transition-all duration-700 cubic-bezier(0.16, 1, 0.3, 1) ${isEntering ? 'opacity-0 scale-125' : 'opacity-100 scale-100'}`}
      onPointerDown={swipe.onPointerDown}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      role="main"
      aria-label="Standby screen. Tap or swipe anywhere to unlock."
    >
      <BrandHeader />

      <div className="flex flex-col items-center justify-center flex-1 select-none pointer-events-none">
        <p className="font-num-light text-5xl tracking-tighter tabular-nums opacity-80 mb-2" style={{ color: textColor }}>
          {timeString}
        </p>
        <p className="font-text text-sm font-medium opacity-50" style={{ color: textColor }}>
          {time.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
        </p>
      </div>

      <div className="flex flex-col items-center w-full max-w-xs">
        <SwipeHint isLight={isLight} />
      </div>
    </div>
  );
};

export default WallpaperOverlay;