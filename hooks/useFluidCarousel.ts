import { useCallback, useEffect, useRef, useState } from 'react';
import {
  APPLE_FLUID_SPRING,
  animateSpring,
  pickCarouselIndex,
  rubberBand,
  type SpringHandle,
} from '../utils/fluidSpring';

export type FluidAxis = 'x' | 'y';

type DragState = {
  pointerId: number;
  startPrimary: number;
  startSecondary: number;
  startPosition: number;
  lastPrimary: number;
  lastTime: number;
  axisLocked: 'none' | FluidAxis | 'other';
  moved: boolean;
};

export type UseFluidCarouselOptions = {
  count: number;
  index: number;
  onIndexChange: (index: number) => void;
  axis?: FluidAxis;
  enabled?: boolean;
  /** Page size in px (card width/height). */
  getPageSize: () => number;
  ignoreInteractiveTargets?: boolean;
};

export type FluidCarouselBind = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
};

/**
 * Fluid Interface carousel (web):
 * - 1:1 finger tracking
 * - velocity + distance intent on release
 * - Apple spring settle (interruptible)
 * - rubber-band past first/last card
 */
export function useFluidCarousel({
  count,
  index,
  onIndexChange,
  axis = 'x',
  enabled = true,
  getPageSize,
  ignoreInteractiveTargets = true,
}: UseFluidCarouselOptions) {
  const maxIndex = Math.max(0, count - 1);

  const [position, setPosition] = useState(index);
  const [isDragging, setIsDragging] = useState(false);

  const positionRef = useRef(index);
  const velocityRef = useRef(0); // index units / ms
  const springRef = useRef<SpringHandle | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const indexRef = useRef(index);
  const suppressClickRef = useRef(false);

  indexRef.current = index;

  const setPos = useCallback((p: number, v = 0) => {
    positionRef.current = p;
    velocityRef.current = v;
    setPosition(p);
  }, []);

  const stopSpring = useCallback(() => {
    springRef.current?.stop();
    springRef.current = null;
  }, []);

  const springTo = useCallback(
    (target: number, releaseVelocity: number) => {
      stopSpring();
      const clamped = Math.max(0, Math.min(maxIndex, Math.round(target)));
      springRef.current = animateSpring(
        positionRef.current,
        clamped,
        releaseVelocity,
        (value, vel) => setPos(value, vel),
        (value) => {
          springRef.current = null;
          const settled = Math.max(0, Math.min(maxIndex, Math.round(value)));
          setPos(settled, 0);
          if (settled !== indexRef.current) {
            onIndexChange(settled);
          }
        },
        APPLE_FLUID_SPRING
      );
    },
    [maxIndex, onIndexChange, setPos, stopSpring]
  );

  // External index only (keyboard, dots, open panel).
  // Gesture release calls springTo itself — never re-sync from isDragging.
  useEffect(() => {
    if (dragRef.current) return;
    if (Math.abs(positionRef.current - index) < 0.001) {
      setPos(index, 0);
      return;
    }
    springTo(index, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only react to index
  }, [index]);

  useEffect(() => {
    if (positionRef.current > maxIndex) {
      stopSpring();
      setPos(maxIndex, 0);
      if (indexRef.current > maxIndex) onIndexChange(maxIndex);
    }
  }, [maxIndex, onIndexChange, setPos, stopSpring]);

  useEffect(() => () => stopSpring(), [stopSpring]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || count <= 0) return;
      if (
        ignoreInteractiveTargets &&
        (e.target as HTMLElement).closest(
          'input, button, textarea, a, select, label, [data-no-drag]'
        )
      ) {
        return;
      }

      stopSpring();
      setIsDragging(true);
      suppressClickRef.current = false;

      const primary = axis === 'x' ? e.clientX : e.clientY;
      const secondary = axis === 'x' ? e.clientY : e.clientX;

      dragRef.current = {
        pointerId: e.pointerId,
        startPrimary: primary,
        startSecondary: secondary,
        startPosition: positionRef.current,
        lastPrimary: primary,
        lastTime: performance.now(),
        axisLocked: 'none',
        moved: false,
      };

      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [axis, count, enabled, ignoreInteractiveTargets, stopSpring]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !enabled || e.pointerId !== drag.pointerId) return;

      const primary = axis === 'x' ? e.clientX : e.clientY;
      const secondary = axis === 'x' ? e.clientY : e.clientX;
      const primaryDelta = primary - drag.startPrimary;
      const secondaryDelta = secondary - drag.startSecondary;

      if (drag.axisLocked === 'none' && (Math.abs(primaryDelta) > 6 || Math.abs(secondaryDelta) > 6)) {
        drag.axisLocked =
          Math.abs(primaryDelta) >= Math.abs(secondaryDelta) ? axis : 'other';
      }
      if (drag.axisLocked === 'other') return;

      const now = performance.now();
      const page = Math.max(getPageSize(), 48);
      const dt = Math.max(1, now - drag.lastTime);
      const dPrimary = primary - drag.lastPrimary;
      // Finger right/down moves content right/down → lower index (matches prior switcher UX)
      velocityRef.current = -(dPrimary / dt) / page;

      drag.lastPrimary = primary;
      drag.lastTime = now;

      if (Math.abs(primaryDelta) > 4) {
        drag.moved = true;
        suppressClickRef.current = true;
      }

      // 1:1 content-driven tracking + rubber-band past ends
      const raw = drag.startPosition - primaryDelta / page;
      const banded = rubberBand(raw, 0, maxIndex, 1);
      setPos(banded, velocityRef.current);
    },
    [axis, enabled, getPageSize, maxIndex, setPos]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      const lockedPrimary =
        drag.axisLocked === axis || (drag.axisLocked === 'none' && drag.moved);
      const releaseVelocity = velocityRef.current;
      const moved = drag.moved;
      dragRef.current = null;
      setIsDragging(false);

      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      if (!lockedPrimary || !moved) {
        springTo(Math.round(positionRef.current), 0);
        return;
      }

      const target = pickCarouselIndex(positionRef.current, releaseVelocity, 0, maxIndex);
      springTo(target, releaseVelocity);
    },
    [axis, maxIndex, springTo]
  );

  const shouldSuppressClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    return false;
  }, []);

  const bind: FluidCarouselBind = {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  return {
    position,
    isDragging,
    bind,
    animateTo: (i: number) => springTo(Math.max(0, Math.min(maxIndex, i)), 0),
    shouldSuppressClick,
  };
}
