import React, { useEffect, useRef, useState } from 'react';

export const MORPH_MS = 200;
export const MORPH_EXIT_MS = 220;
export const MORPH_MODE_MS = 140;

/** Stacked dual/multi-label crossfade for mode-dependent copy. */
export const MorphCrossfade: React.FC<{
  active: string;
  options: readonly { id: string; label: React.ReactNode }[];
  className?: string;
  center?: boolean;
}> = ({ active, options, className = '', center = false }) => (
  <span className={`morph-crossfade ${center ? 'morph-crossfade--center' : ''} ${className}`.trim()}>
    {options.map((opt) => (
      <span key={opt.id} data-active={opt.id === active ? 'true' : 'false'}>
        {opt.label}
      </span>
    ))}
  </span>
);

/**
 * Keeps children mounted through an exit animation when `show` goes false.
 * Use for overlays, panels, and mode bodies that used to hard-unmount.
 */
export const MorphPresence: React.FC<{
  show: boolean;
  children: (visible: boolean) => React.ReactNode;
  /** Exit duration before unmount (ms). */
  exitMs?: number;
  /** Called after exit animation completes and content unmounts. */
  onExited?: () => void;
}> = ({ show, children, exitMs = MORPH_EXIT_MS, onExited }) => {
  const [mounted, setMounted] = useState(show);
  const [visible, setVisible] = useState(show);
  const exitTimer = useRef<number | null>(null);

  useEffect(() => {
    if (exitTimer.current !== null) {
      window.clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }

    if (show) {
      setMounted(true);
      // Double rAF so the browser paints the "out" frame before transitioning in.
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return () => cancelAnimationFrame(id);
    }

    setVisible(false);
    exitTimer.current = window.setTimeout(() => {
      setMounted(false);
      exitTimer.current = null;
      onExited?.();
    }, exitMs);

    return () => {
      if (exitTimer.current !== null) {
        window.clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
    };
  }, [show, exitMs, onExited]);

  if (!mounted) return null;
  return <>{children(visible)}</>;
};

/**
 * Crossfades when `mode` changes: fade out → swap content → fade in.
 * Renders the previous mode until the out phase completes.
 */
export function useMorphModeSwap<T extends string>(mode: T, swapMs = MORPH_MODE_MS) {
  const [renderMode, setRenderMode] = useState(mode);
  const [contentIn, setContentIn] = useState(true);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (mode === renderMode) return;

    setContentIn(false);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);

    timerRef.current = window.setTimeout(() => {
      setRenderMode(mode);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setContentIn(true));
      });
      timerRef.current = null;
    }, swapMs);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [mode, renderMode, swapMs]);

  return { renderMode, contentIn };
}

export default MorphCrossfade;
