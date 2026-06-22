import { useRef } from 'react';

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
