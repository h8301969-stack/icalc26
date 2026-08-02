import React, { useCallback, useRef, useState } from 'react';

interface InvoiceDragHandleProps {
  onDragOpen: () => void;
  disabled?: boolean;
  edgePinned?: boolean;
}

const DRAG_THRESHOLD = 28;
/** Cap visual pull so the handle peeks with the sheet gesture. */
const DRAG_VISUAL_MAX = 72;
const DRAG_VISUAL_FACTOR = 0.55;

const InvoiceDragHandle: React.FC<InvoiceDragHandleProps> = ({
  onDragOpen,
  disabled = false,
  edgePinned = false,
}) => {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const offsetRef = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    startY.current = e.clientY;
    setDragging(true);
    setOffset(0);
    offsetRef.current = 0;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [disabled]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    // Negative dy = drag up toward open.
    const dy = Math.min(0, e.clientY - startY.current);
    offsetRef.current = dy;
    setOffset(dy);
  }, [dragging]);

  const onPointerUp = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    const dy = offsetRef.current;
    if (dy < -DRAG_THRESHOLD) {
      // Keep a slight lift so the sheet entrance continues the upward motion.
      setOffset(-DRAG_VISUAL_MAX);
      onDragOpen();
      // Reset after the switcher sheet has taken over the gesture.
      window.setTimeout(() => {
        setOffset(0);
        offsetRef.current = 0;
      }, 120);
      return;
    }
    setOffset(0);
    offsetRef.current = 0;
  }, [dragging, onDragOpen]);

  const visualLift = Math.max(-DRAG_VISUAL_MAX, offset * DRAG_VISUAL_FACTOR);

  return (
    <div
      className={`touch-none select-none ${
        edgePinned
          ? 'absolute bottom-0 left-0 right-0 z-20 h-4'
          : 'shrink-0 h-4'
      } ${
        disabled ? 'pointer-events-none' : 'cursor-grab active:cursor-grabbing pointer-events-auto'
      }`}
      style={{
        transform: `translateY(${visualLift}px)`,
        transition: dragging
          ? 'none'
          : 'transform 0.42s cubic-bezier(0.22, 1, 0.36, 1)',
        paddingBottom: edgePinned ? 'max(0.06rem, env(safe-area-inset-bottom))' : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="button"
      aria-label="Drag up to open invoice switcher"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onDragOpen();
        }
      }}
    />
  );
};

export default InvoiceDragHandle;