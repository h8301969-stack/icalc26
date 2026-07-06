import { useRef } from 'react';

const TAP_THRESHOLD = 14;
const EDGE_ZONE_PX = 56;
const EDGE_SWIPE_MIN = 48;

type EdgeSide = 'left' | 'right';

export const useEdgeSwipe = (
  handlers: {
    onSwipeFromLeftEdge?: () => void;
    onSwipeFromRightEdge?: () => void;
  },
  enabled = true
) => {
  const start = useRef<{ x: number; y: number; edge: EdgeSide } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled) return;
    const width = window.innerWidth;
    const x = e.clientX;
    let edge: EdgeSide | null = null;
    if (x <= EDGE_ZONE_PX) edge = 'left';
    else if (x >= width - EDGE_ZONE_PX) edge = 'right';
    if (!edge) return;
    start.current = { x, y: e.clientY, edge };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!enabled || !start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (Math.abs(dy) > Math.abs(dx)) {
      start.current = null;
      return;
    }

    if (start.current.edge === 'left' && dx >= EDGE_SWIPE_MIN) {
      handlers.onSwipeFromLeftEdge?.();
    } else if (start.current.edge === 'right' && dx <= -EDGE_SWIPE_MIN) {
      handlers.onSwipeFromRightEdge?.();
    }
    start.current = null;
  };

  const onPointerCancel = () => {
    start.current = null;
  };

  return { onPointerDown, onPointerUp, onPointerCancel, isEdgeActive: () => start.current !== null };
};

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
