import React, { useRef, useState } from 'react';

interface CalcButtonProps {
  label: string | React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'dark' | 'ghost';
  wide?: boolean;
  active?: boolean;
  accentColor?: string;
  isLight?: boolean;
  ariaLabel?: string;
  large?: boolean;
  /** Flat white/black skins — no glow or press shadow. */
  flat?: boolean;
}

const CalcButton: React.FC<CalcButtonProps> = ({
  label,
  onClick,
  variant = 'dark',
  wide = false,
  active = false,
  accentColor = '#ff9f0a',
  isLight = false,
  ariaLabel,
  large = false,
  flat = false,
}) => {
  const [isPressed, setIsPressed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firedRef = useRef(false);

  const getVariantStyles = () => {
    if (variant === 'primary') {
      if (active) {
        return isLight ? 'bg-black text-white' : 'bg-white text-black';
      }
      return 'text-white';
    }

    if (variant === 'secondary') {
      if (flat) {
        return isLight
          ? 'bg-zinc-200 text-black'
          : 'bg-zinc-700 text-white';
      }
      return isLight
        ? 'bg-black/10 text-black border border-black/5'
        : 'bg-white/20 text-white backdrop-blur-md border border-white/20';
    }

    if (variant === 'ghost') {
      return `bg-transparent border ${isLight ? 'text-black border-black/10' : 'text-white border-white/20'}`;
    }

    if (flat) {
      return isLight ? 'bg-zinc-100 text-black' : 'bg-zinc-800 text-white';
    }

    return isLight
      ? 'bg-black/5 text-black border border-black/5'
      : 'bg-zinc-800/40 text-white backdrop-blur-sm border border-white/5';
  };

  const fireAction = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    onClick();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    buttonRef.current?.setPointerCapture(e.pointerId);
    setIsPressed(true);
    fireAction();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    setIsPressed(false);
    firedRef.current = false;
    if (buttonRef.current?.hasPointerCapture(e.pointerId)) {
      buttonRef.current.releasePointerCapture(e.pointerId);
    }
  };

  const handlePointerLeave = () => {
    setIsPressed(false);
    firedRef.current = false;
  };

  return (
    <div className={`flex items-center justify-center ${wide ? 'col-span-2' : ''} w-full h-full ${large ? 'p-0.5' : 'p-1'}`}>
      <button
        ref={buttonRef}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onClick={(e) => e.preventDefault()}
        aria-label={ariaLabel || (typeof label === 'string' ? `${label}${variant === 'primary' ? ' (operation)' : ''}` : undefined)}
        aria-pressed={isPressed}
        type="button"
        style={{
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
          boxShadow: 'none',
          filter: 'none',
          ...(variant === 'primary' && !active ? { backgroundColor: accentColor } : {}),
          width: '100%',
          height: wide ? '100%' : 'auto',
        }}
        className={`
          relative flex items-center justify-center
          rounded-full font-medium transition-transform duration-75 overflow-hidden
          ${large ? 'text-2xl sm:text-[26px]' : 'text-xl'}
          ${wide ? 'px-8 justify-start h-full w-full' : 'h-full max-h-full aspect-square'}
          ${getVariantStyles()}
          ${isPressed ? 'scale-[0.94] opacity-90' : 'scale-100'}
        `}
      >
        <span className="font-num-medium relative z-10 select-none">{label}</span>
      </button>
    </div>
  );
};

export default CalcButton;
