import React, { useState, useRef, useEffect } from 'react';

interface CalcButtonProps {
  label: string | React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'dark' | 'ghost';
  wide?: boolean;
  active?: boolean;
  accentColor?: string;
  isLight?: boolean;
  ariaLabel?: string;
}

interface Ripple {
  x: number;
  y: number;
  id: number;
}

const CalcButton: React.FC<CalcButtonProps> = ({ 
  label, 
  onClick, 
  variant = 'dark', 
  wide = false,
  active = false,
  accentColor = '#ff9f0a',
  isLight = false,
  ariaLabel
}) => {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [isPressed, setIsPressed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

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

  const createRipple = (clientX: number, clientY: number) => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const id = Date.now();

    const newRipple = { x, y, id };
    setRipples((prev) => [...prev, newRipple]);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    setIsPressed(true);
    createRipple(e.clientX, e.clientY);
  };

  const handlePointerUp = () => {
    setIsPressed(false);
  };

  const handlePointerLeave = () => {
    setIsPressed(false);
    setIsHovered(false);
  };

  useEffect(() => {
    if (ripples.length > 0) {
      const timer = setTimeout(() => {
        setRipples((prev) => prev.slice(1));
      }, 300); 
      return () => clearTimeout(timer);
    }
  }, [ripples]);

  const hoverStyles: React.CSSProperties = isHovered && variant === 'primary' && !active 
    ? { boxShadow: `0 0 25px ${accentColor}88`, filter: 'brightness(1.15)' } 
    : isHovered && !active
      ? { boxShadow: isLight ? '0 4px 12px rgba(0,0,0,0.1)' : '0 4px 20px rgba(255,255,255,0.1)' }
      : {};

  return (
    <div className={`flex items-center justify-center ${wide ? 'col-span-2' : ''} w-full h-full p-1`}>
      <button
        ref={buttonRef}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={handlePointerLeave}
        onClick={onClick}
        aria-label={ariaLabel || (typeof label === 'string' ? `${label}${variant === 'primary' ? ' (operation)' : ''}` : undefined)}
        aria-pressed={isPressed}
        type="button"
        style={{
          ...(variant === 'primary' && !active ? { backgroundColor: accentColor } : {}),
          ...hoverStyles,
          width: '100%',
          height: wide ? '100%' : 'auto',
        }}
        className={`
          relative flex items-center justify-center 
          rounded-full text-xl font-medium transition-all duration-150 overflow-hidden
          ${wide ? 'px-8 justify-start h-full w-full' : 'h-full max-h-full aspect-square'}
          ${getVariantStyles()}
        `}
      >
        <div className={`absolute inset-0 w-full h-full transition-transform duration-150 flex items-center justify-center ${wide ? 'px-8 justify-start' : ''} ${isPressed ? 'scale-90 brightness-110' : 'scale-100'}`}>
          <div 
            className={`absolute inset-0 opacity-0 transition-opacity duration-200 pointer-events-none bg-linear-to-tr from-transparent via-white/20 to-transparent -translate-x-full ${isHovered ? 'opacity-100 translate-x-full' : ''}`} 
            style={{ transitionProperty: 'transform, opacity', transitionDuration: '0.2s' }}
          />
          <div className={`absolute inset-0 opacity-10 bg-linear-to-br from-white to-transparent pointer-events-none`} />
          {ripples.map((ripple) => (
            <span
              key={ripple.id}
              className={`absolute rounded-full pointer-events-none animate-ripple ${isLight ? 'bg-black/10' : 'bg-white/30'}`}
              style={{
                left: ripple.x,
                top: ripple.y,
                width: '20px',
                height: '20px',
                transform: 'translate(-50%, -50%)',
              }}
            />
          ))}
          <span className="relative z-10 select-none">{label}</span>
        </div>
        <style>{`
          @keyframes ripple {
            from { transform: translate(-50%, -50%) scale(0); opacity: 0.5; }
            to { transform: translate(-50%, -50%) scale(20); opacity: 0; }
          }
          .animate-ripple { animation: ripple 300ms ease-out; }
        `}</style>
      </button>
    </div>
  );
};

export default CalcButton;