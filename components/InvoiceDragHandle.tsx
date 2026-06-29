import React, { useCallback, useRef, useState } from 'react';

interface InvoiceDragHandleProps {
  isLight: boolean;
  onDragOpen: () => void;
  disabled?: boolean;
  edgePinned?: boolean;
}

const DRAG_THRESHOLD = 32;

const InvoiceDragHandle: React.FC<InvoiceDragHandleProps> = ({
  isLight,
  onDragOpen,
  disabled = false,
  edgePinned = false,
}) => {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    startY.current = e.clientY;
    setDragging(true);
    setOffset(0);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [disabled]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dy = Math.min(0, e.clientY - startY.current);
    setOffset(dy);
  }, [dragging]);

  const onPointerUp = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    if (offset < -DRAG_THRESHOLD) onDragOpen();
    setOffset(0);
  }, [dragging, offset, onDragOpen]);

  return (
    <div
      className={`flex flex-col items-center justify-center touch-none select-none ${
        edgePinned
          ? 'absolute bottom-0 left-0 right-0 z-30 pt-1'
          : 'shrink-0 py-2'
      } ${
        disabled ? 'opacity-30 pointer-events-none' : 'cursor-grab active:cursor-grabbing pointer-events-auto'
      }`}
      style={{
        transform: `translateY(${offset * 0.4}px)`,
        transition: dragging ? 'none' : 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        paddingBottom: edgePinned ? 'max(0.15rem, env(safe-area-inset-bottom))' : undefined,
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
    >
      <div
        className="w-[min(72%,280px)] h-[4px] rounded-full bg-black transition-opacity"
        style={{ opacity: dragging ? 0.85 : 0.55 }}
      />
      <span
        className={`text-[8px] font-medium lowercase tracking-wide mt-2 ${
          isLight ? 'text-black/40' : 'text-white/35'
        }`}
      >
        swipe up to open
      </span>
    </div>
  );
};

export default InvoiceDragHandle;