import React, { useState } from 'react';

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
}

/**
 * Calculator key — single-tap only.
 * No multi-touch simulation, pointer capture, or touch-point ripple tracking.
 * Visual press is handled globally by trio-press.
 */
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
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const getVariantStyles = () => {
    if (variant === 'primary') {
      return active
        ? (isLight ? 'bg-black text-white' : 'bg-white text-black shadow-[0_0_25px_rgba(255,255,255,0.5)]')
        : 'text-white';
    }

    if (variant === 'secondary') {
      return isLight
        ? 'bg-black/10 text-black border border-black/5'
        : 'bg-white/20 text-white backdrop-blur-md border border-white/20';
    }

    if (variant === 'ghost') {
      return `bg-transparent border ${isLight ? 'text-black border-black/10' : 'text-white border-white/20'}`;
    }

    return isLight
      ? 'bg-black/5 text-black border border-black/5'
      : 'bg-zinc-800/40 text-white backdrop-blur-sm border border-white/5';
  };

  const hoverStyles: React.CSSProperties =
    isHovered && variant === 'primary' && !active
      ? { boxShadow: `0 0 25px ${accentColor}88`, filter: 'brightness(1.15)' }
      : isHovered && !active
        ? { boxShadow: isLight ? '0 4px 12px rgba(0,0,0,0.1)' : '0 4px 20px rgba(255,255,255,0.1)' }
        : {};

  return (
    <div className={`flex items-center justify-center ${wide ? 'col-span-2' : ''} w-full h-full ${large ? 'p-0.5' : 'p-1'}`}>
      <button
        type="button"
        onClick={onClick}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => setIsHovered(false)}
        aria-label={ariaLabel || (typeof label === 'string' ? `${label}${variant === 'primary' ? ' (operation)' : ''}` : undefined)}
        style={{
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
          ...(variant === 'primary' && !active ? { backgroundColor: accentColor } : {}),
          ...hoverStyles,
          width: '100%',
          height: wide ? '100%' : 'auto',
        }}
        className={`
          calc-key trio-pressable relative flex items-center justify-center
          rounded-full font-medium overflow-hidden
          ${large ? 'text-2xl sm:text-[26px]' : 'text-xl'}
          ${wide ? 'px-8 justify-start h-full w-full' : 'h-full max-h-full aspect-square'}
          ${getVariantStyles()}
        `}
      >
        <div
          className={`absolute inset-0 w-full h-full flex items-center justify-center ${wide ? 'px-8 justify-start' : ''}`}
        >
          <div
            className={`absolute inset-0 opacity-0 transition-opacity duration-150 pointer-events-none bg-linear-to-tr from-transparent via-white/20 to-transparent -translate-x-full ${isHovered ? 'opacity-100 translate-x-full' : ''}`}
            style={{ transitionProperty: 'transform, opacity', transitionDuration: '0.15s' }}
          />
          <div className="absolute inset-0 opacity-10 bg-linear-to-br from-white to-transparent pointer-events-none" />
          <span className="font-num-medium relative z-10 select-none">{label}</span>
        </div>
      </button>
    </div>
  );
};

export default CalcButton;
