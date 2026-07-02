import { useRef } from 'react';

const TAP_THRESHOLD = 14;

export const useSwipeAnywhere = (onSwipe: () => void, minDistance = 48) => {
  const start = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= minDistance || dist <= TAP_THRESHOLD) onSwipe();
    start.current = null;
  };

  const onPointerCancel = () => {
    start.current = null;
  };

  return { onPointerDown, onPointerUp, onPointerCancel };
};

export const useSwipeGesture = (onSwipeUp: () => void) => {
  const touchStart = useRef<number | null>(null);
  const touchEnd = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    touchEnd.current = null;
    touchStart.current = e.targetTouches[0].clientY;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    touchEnd.current = e.targetTouches[0].clientY;
  };

  const onTouchEnd = () => {
    if (touchStart.current === null || touchEnd.current === null) return;
    const distance = touchStart.current - touchEnd.current;
    const isUpSwipe = distance > 50;
    if (isUpSwipe) onSwipeUp();
  };

  return { onTouchStart, onTouchMove, onTouchEnd };
};
