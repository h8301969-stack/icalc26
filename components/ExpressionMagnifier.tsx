import React, { useLayoutEffect, useRef } from 'react';

const LOUPE_SIZE = 140;
const LOUPE_SCALE = 1.85;
const LOUPE_LIFT = 58;

interface ExpressionMagnifierProps {
  clientX: number;
  clientY: number;
  sourceEl: HTMLElement | null;
  cloneKey: string;
  isLight: boolean;
}

const ExpressionMagnifier: React.FC<ExpressionMagnifierProps> = ({
  clientX,
  clientY,
  sourceEl,
  cloneKey,
  isLight,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const sourceRect = sourceEl?.getBoundingClientRect() ?? null;

  useLayoutEffect(() => {
    const host = contentRef.current;
    if (!host || !sourceEl) return;
    host.replaceChildren();
    const clone = sourceEl.cloneNode(true) as HTMLElement;
    clone.removeAttribute('id');
    clone.style.margin = '0';
    clone.style.width = `${sourceEl.offsetWidth}px`;
    clone.style.maxWidth = `${sourceEl.offsetWidth}px`;
    host.appendChild(clone);
  }, [sourceEl, cloneKey]);

  if (!sourceEl || !sourceRect) return null;

  const originX = clientX - sourceRect.left;
  const originY = clientY - sourceRect.top;
  const half = LOUPE_SIZE / 2;
  const minX = 8;
  const maxX = Math.max(minX, window.innerWidth - LOUPE_SIZE - 8);
  const left = Math.min(maxX, Math.max(minX, clientX - half));
  let top = clientY - LOUPE_SIZE - LOUPE_LIFT + half;
  if (top < 8) {
    top = Math.min(window.innerHeight - LOUPE_SIZE - 8, clientY + 36);
  }

  return (
    <div
      className={`calc-expression-loupe ${isLight ? 'calc-expression-loupe--light' : 'calc-expression-loupe--dark'}`}
      style={{
        left,
        top,
        width: LOUPE_SIZE,
        height: LOUPE_SIZE,
      }}
      aria-hidden="true"
    >
      <div className="calc-expression-loupe__glass">
        <div
          ref={contentRef}
          className="calc-expression-loupe__content"
          style={{
            transform: `translate(${half - originX * LOUPE_SCALE}px, ${half - originY * LOUPE_SCALE}px) scale(${LOUPE_SCALE})`,
          }}
        />
        <div className="calc-expression-loupe__caret" />
      </div>
    </div>
  );
};

export default ExpressionMagnifier;
