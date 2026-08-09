import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

export interface FluidSegmentOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

interface FluidSegmentControlProps<T extends string> {
  options: FluidSegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  isLight?: boolean;
  size?: 'sm' | 'md';
  variant?: 'slide' | 'chip';
  /** Stretch to parent width with equal-width segments */
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

const FluidSegmentControl = <T extends string>({
  options,
  value,
  onChange,
  isLight = false,
  size = 'md',
  variant = 'slide',
  fullWidth = false,
  disabled = false,
  className = '',
  ariaLabel,
}: FluidSegmentControlProps<T>) => {
  const groupId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [thumb, setThumb] = useState({ width: 0, left: 0 });
  const [thumbReady, setThumbReady] = useState(false);

  const activeIndex = Math.max(0, options.findIndex((o) => o.id === value));

  const measureThumb = useCallback(() => {
    const track = trackRef.current;
    const btn = buttonRefs.current[activeIndex];
    if (!track || !btn) return;
    const trackRect = track.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    setThumb({
      width: btnRect.width,
      left: btnRect.left - trackRect.left,
    });
    setThumbReady(true);
  }, [activeIndex]);

  useEffect(() => {
    if (variant !== 'slide') return;
    measureThumb();
    const track = trackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(() => measureThumb());
    ro.observe(track);
    return () => ro.disconnect();
  }, [measureThumb, options.length, value, variant, fullWidth]);

  const py = size === 'sm' ? 'py-1.5' : 'py-2';
  const text = size === 'sm' ? 'text-[11px]' : 'text-xs';

  const isChip = variant === 'chip';

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={`fluid-segment relative ${
        isChip
          ? 'flex flex-wrap gap-1.5 p-0'
          : `inline-flex items-stretch gap-0.5 p-0.5 rounded-full${fullWidth ? ' w-full' : ''}`
      } ${text} ${
        isChip ? '' : isLight ? 'fluid-segment--light' : 'fluid-segment--dark'
      } ${disabled ? 'opacity-50 pointer-events-none' : ''} ${className}`}
    >
      {!isChip && (
        <span
          aria-hidden
          className={`fluid-segment-thumb absolute top-0.5 bottom-0.5 rounded-full pointer-events-none ${
            thumbReady ? 'fluid-segment-thumb--ready' : ''
          }`}
          style={{
            width: thumb.width,
            transform: `translateX(${thumb.left}px)`,
          }}
        />
      )}
      {options.map((option, index) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            ref={(el) => { buttonRefs.current[index] = el; }}
            type="button"
            role="radio"
            aria-checked={active}
            id={`${groupId}-${option.id}`}
            disabled={disabled}
            onClick={() => {
              if (disabled || option.id === value) return;
              onChange(option.id);
            }}
            className={
              isChip
                ? `fluid-chip-btn px-3 ${py} rounded-xl font-semibold tracking-normal transition-all duration-200 ${
                    active
                      ? 'fluid-chip-btn--active'
                      : isLight
                        ? 'fluid-chip-btn--idle-light'
                        : 'fluid-chip-btn--idle-dark'
                  }`
                : `fluid-segment-btn relative z-[1] flex items-center justify-center gap-1 px-3 ${py} rounded-full font-semibold tracking-normal transition-[color,opacity] duration-200 ease-out ${
                    fullWidth ? 'flex-1 min-w-0' : ''
                  } ${active ? 'fluid-segment-btn--active' : 'fluid-segment-btn--idle'}`
            }
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default FluidSegmentControl;