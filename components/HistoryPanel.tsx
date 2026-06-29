import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '../constants';
import { CartLineItem, InvoiceActionLog } from '../types';
import { formatPosLineItemDisplay } from '../utils/posExpression';
import { printerInstance } from '../utils/bluetoothPrinter';

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onClear: () => void;
  isLight?: boolean;
  currency?: string;
  invoiceName: string;
  onInvoiceNameChange: (name: string) => void;
  cartItems: CartLineItem[];
  actionLogs: InvoiceActionLog[];
  runningTotal: string;
  onInvoicePrinted?: (invoiceName: string) => void;
}

interface InvoiceCard {
  id: string;
  name: string;
  items: CartLineItem[];
  logs: InvoiceActionLog[];
  total: string;
  isCurrent: boolean;
}

type ViewMode = 'carousel' | 'list';

const DRAG_FACTOR = 1.25;
const SWIPE_THRESHOLD = 22;

const HistoryPanel: React.FC<HistoryPanelProps> = ({
  isOpen,
  onClose,
  onClear,
  isLight = false,
  currency = 'GHS',
  invoiceName,
  onInvoiceNameChange,
  cartItems,
  actionLogs,
  runningTotal,
  onInvoicePrinted,
}) => {
  const cards = useMemo<InvoiceCard[]>(() => {
    const grouped = new Map<string, InvoiceActionLog[]>();
    for (const log of actionLogs) {
      const key = log.invoiceName;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(log);
    }

    const built: InvoiceCard[] = [];
    const pastNames = [...grouped.keys()].filter(k => k !== invoiceName);

    for (const name of pastNames) {
      const logs = grouped.get(name)!;
      built.push({
        id: `past-${name}`,
        name,
        items: logs.map(l => ({ price: l.price, quantity: l.quantity })),
        logs,
        total: logs.reduce((s, l) => s + l.price * l.quantity, 0).toFixed(2),
        isCurrent: false,
      });
    }

    built.unshift({
      id: 'current',
      name: invoiceName,
      items: cartItems,
      logs: grouped.get(invoiceName) ?? [],
      total: runningTotal,
      isCurrent: true,
    });

    return built;
  }, [actionLogs, cartItems, invoiceName, runningTotal]);

  const [activeIdx, setActiveIdx] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('carousel');
  const [dragDelta, setDragDelta] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [stageWidth, setStageWidth] = useState(360);
  const dragStartX = useRef(0);
  const dragStartY = useRef(0);
  const dragAxis = useRef<'none' | 'x' | 'y'>('none');
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(isOpen);

  const handleClose = useCallback(() => {
    const root = rootRef.current;
    const active = document.activeElement as HTMLElement | null;
    if (root?.contains(active)) {
      active.blur();
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      setActiveIdx(0);
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
      const id = requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(id);
    }

    const root = rootRef.current;
    const active = document.activeElement as HTMLElement | null;
    if (root?.contains(active)) {
      active.blur();
    }
    lastFocusedRef.current?.focus?.({ preventScroll: true });

    const timer = window.setTimeout(() => setMounted(false), 280);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen, viewMode]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
      if (viewMode === 'carousel') {
        if (e.key === 'ArrowRight') setActiveIdx(i => Math.min(i + 1, cards.length - 1));
        if (e.key === 'ArrowLeft') setActiveIdx(i => Math.max(i - 1, 0));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose, cards.length, viewMode]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (viewMode !== 'carousel') return;
    if ((e.target as HTMLElement).closest('input, button, textarea')) return;
    dragStartX.current = e.clientX;
    dragStartY.current = e.clientY;
    dragAxis.current = 'none';
    setIsDragging(true);
    setDragDelta(0);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [viewMode]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || viewMode !== 'carousel') return;
    const dx = e.clientX - dragStartX.current;
    const dy = e.clientY - dragStartY.current;

    if (dragAxis.current === 'none' && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      dragAxis.current = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    }
    if (dragAxis.current === 'y') return;

    setDragDelta(dx * DRAG_FACTOR);
  }, [isDragging, viewMode]);

  const onPointerUp = useCallback(() => {
    if (!isDragging || viewMode !== 'carousel') return;
    setIsDragging(false);
    if (dragAxis.current === 'x') {
      if (dragDelta < -SWIPE_THRESHOLD) {
        setActiveIdx(i => Math.min(i + 1, cards.length - 1));
      } else if (dragDelta > SWIPE_THRESHOLD) {
        setActiveIdx(i => Math.max(i - 1, 0));
      }
    }
    dragAxis.current = 'none';
    setDragDelta(0);
  }, [isDragging, dragDelta, cards.length, viewMode]);

  const selectInvoice = useCallback((idx: number) => {
    const card = cards[idx];
    if (!card) return;
    setActiveIdx(idx);
    if (!card.isCurrent) onInvoiceNameChange(card.name);
  }, [cards, onInvoiceNameChange]);

  const panelBg = isLight ? 'bg-[#f0f0f5]/96' : 'bg-[#0e0e12]/96';
  const textMuted = isLight ? 'text-zinc-400' : 'text-zinc-500';

  if (!mounted) return null;

  const getCardStyle = (idx: number) => {
    const relativePos = idx - activeIdx;

    let translateX = dragDelta;
    let translateY = 0;
    let scale = 1;
    let opacity = 1;
    let blurPx = 0;
    let zIndex = 100;

    if (relativePos === 0) {
      translateX = dragDelta;
    } else if (relativePos > 0) {
      translateX = dragDelta + relativePos * 18;
      translateY = relativePos * 14;
      scale = Math.max(0.84, 1 - relativePos * 0.06);
      opacity = Math.max(0.4, 1 - relativePos * 0.28);
      blurPx = Math.min(24, 6 + relativePos * 10);
      zIndex = 100 - relativePos;
    } else {
      translateX = dragDelta + relativePos * stageWidth * 0.92;
      scale = 0.94;
      opacity = Math.max(0, 1 + relativePos * 0.5);
      zIndex = 90 + relativePos;
    }

    const isVisible = relativePos >= -1 && relativePos <= 4;

    return {
      translateX,
      translateY,
      scale,
      opacity: isVisible ? opacity : 0,
      blurPx,
      zIndex,
      isActive: relativePos === 0,
    };
  };

  const viewToggle = (
    <div
      className={`flex rounded-full overflow-hidden border text-[10px] font-black uppercase tracking-widest shrink-0 ${
        isLight ? 'border-black/10' : 'border-white/10'
      }`}
    >
      <button
        type="button"
        onClick={() => setViewMode('carousel')}
        aria-label="Vertical carousel view"
        aria-pressed={viewMode === 'carousel'}
        className={`px-2.5 py-1.5 flex items-center gap-1 transition-all ${
          viewMode === 'carousel'
            ? isLight ? 'bg-black text-white' : 'bg-white text-black'
            : isLight ? 'bg-zinc-100' : 'bg-white/10'
        }`}
      >
        <Icons.Carousel size={12} />
      </button>
      <button
        type="button"
        onClick={() => setViewMode('list')}
        aria-label="List view"
        aria-pressed={viewMode === 'list'}
        className={`px-2.5 py-1.5 flex items-center gap-1 transition-all ${
          viewMode === 'list'
            ? isLight ? 'bg-black text-white' : 'bg-white text-black'
            : isLight ? 'bg-zinc-100' : 'bg-white/10'
        }`}
      >
        <Icons.List size={12} />
      </button>
    </div>
  );

  const renderCardContent = (card: InvoiceCard, isActive: boolean) => (
    <div className="flex-1 flex flex-col min-h-0 px-5 py-4 gap-3">
      <div className="flex items-center justify-between">
        <div
          style={{
            fontSize: 10,
            fontWeight: 900,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            opacity: 0.38,
          }}
        >
          Line items
        </div>
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              opacity: 0.38,
            }}
          >
            Total
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.04em' }}>
            {currency} {card.total}
          </div>
        </div>
      </div>

      <div
        style={{
          height: 1,
          background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.07)',
          borderRadius: 1,
        }}
      />

      <div
        className="flex-1 overflow-y-auto flex flex-col gap-1.5 custom-scrollbar"
        style={{ touchAction: 'pan-y' }}
      >
        {card.items.length === 0 ? (
          <div
            className={textMuted}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              opacity: 0.5,
            }}
          >
            No items yet
          </div>
        ) : (
          card.items.map((item, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                opacity: 0.82,
              }}
            >
              <span>{formatPosLineItemDisplay(item, currency)}</span>
              <span style={{ opacity: 0.55, fontSize: 11 }}>
                {currency} {(item.price * item.quantity).toFixed(2)}
              </span>
            </div>
          ))
        )}
      </div>

      {isActive && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={async e => {
              e.stopPropagation();
              try {
                const numericTotal = parseFloat(card.total) || 0;
                await printerInstance.printInvoiceImage(
                  card.name,
                  card.items,
                  numericTotal,
                  currency
                );
                onInvoicePrinted?.(card.name);
              } catch (err: unknown) {
                alert(err instanceof Error ? err.message : 'Failed to print');
              }
            }}
            style={{
              flex: 1,
              padding: '10px 0',
              borderRadius: 14,
              background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
              color: isLight ? '#000' : '#fff',
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
            aria-label="Print invoice"
          >
            <Icons.Printer size={12} />
            Print
          </button>

          {card.isCurrent && (
            <button
              onClick={e => {
                e.stopPropagation();
                onClear();
              }}
              style={{
                flex: 1,
                padding: '10px 0',
                borderRadius: 14,
                background: 'rgba(239,68,68,0.10)',
                color: '#ef4444',
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
                border: 'none',
                cursor: 'pointer',
              }}
              aria-label="Clear current invoice"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );

  const renderCardBody = (card: InvoiceCard, isActive: boolean) => (
    <>
      <div
        className={`px-5 pt-5 pb-3 flex items-center justify-between gap-3 border-b shrink-0 ${
          isLight ? 'border-black/6' : 'border-white/6'
        }`}
      >
        {card.isCurrent && isActive ? (
          <input
            id="invoice-title"
            type="text"
            value={invoiceName}
            onChange={e => onInvoiceNameChange(e.target.value)}
            placeholder="Invoice #1"
            aria-label="Invoice name"
            className={`flex-1 min-w-0 text-2xl font-black tracking-tighter bg-transparent outline-none border-b border-transparent focus:border-current/20 transition-colors placeholder:opacity-30 ${
              isLight ? 'text-black' : 'text-white'
            }`}
          />
        ) : (
          <div className="flex-1 min-w-0">
            <div
              style={{
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
                opacity: 0.38,
                marginBottom: 2,
              }}
            >
              {card.isCurrent ? 'Current' : 'Saved'}
            </div>
            <div
              id={isActive ? 'invoice-title' : undefined}
              className="text-2xl font-black tracking-tighter truncate"
            >
              {card.name}
            </div>
          </div>
        )}

        {isActive && viewMode === 'carousel' && (
          <div className="flex items-center gap-2 shrink-0">
            {viewToggle}
            <button
              ref={closeRef}
              onClick={handleClose}
              aria-label="Close invoice panel"
              className={`p-2.5 rounded-full hover:bg-black/8 transition-colors duration-150 ${
                isLight ? 'text-black' : 'text-white'
              }`}
            >
              <Icons.X size={22} />
            </button>
          </div>
        )}
      </div>

      {renderCardContent(card, isActive)}

      {isActive && viewMode === 'carousel' && cards.length > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 6,
            paddingBottom: 14,
            paddingTop: 2,
          }}
        >
          {cards.map((_, i) => (
            <button
              key={i}
              aria-label={`Go to card ${i + 1}`}
              onClick={() => setActiveIdx(i)}
              style={{
                width: i === activeIdx ? 20 : 6,
                height: 6,
                borderRadius: 3,
                background:
                  i === activeIdx
                    ? isLight
                      ? 'rgba(0,0,0,0.6)'
                      : 'rgba(255,255,255,0.7)'
                    : isLight
                      ? 'rgba(0,0,0,0.18)'
                      : 'rgba(255,255,255,0.22)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                padding: 0,
              }}
            />
          ))}
        </div>
      )}
    </>
  );

  return (
    <div
      ref={rootRef}
      inert={!isOpen ? true : undefined}
      className={`fixed inset-0 z-120 flex items-end sm:items-center justify-center transition-all duration-280 p-4 pb-6 sm:pb-4 ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      <div
        className={`absolute inset-0 bg-black/50 backdrop-blur-3xl transition-opacity duration-280 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleClose}
        aria-hidden="true"
      />

      <div
        ref={stageRef}
        className={`relative modal-portrait-6-13 select-none transition-all duration-500 overflow-visible ${
          isOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-[42vh]'
        }`}
        style={{
          touchAction: viewMode === 'carousel' ? 'pan-x' : 'auto',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Invoice switcher"
        role="region"
      >
        {viewMode === 'list' ? (
          <div
            className={`absolute inset-0 flex flex-col rounded-[32px] overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.55)] ${panelBg} ${isLight ? 'text-black' : 'text-white'}`}
            role="dialog"
            aria-modal="true"
          >
            <div
              className={`px-5 pt-5 pb-3 flex items-center justify-between gap-3 border-b shrink-0 ${
                isLight ? 'border-black/6' : 'border-white/6'
              }`}
            >
              <div className="text-sm font-black tracking-tight">Invoices</div>
              <div className="flex items-center gap-2">
                {viewToggle}
                <button
                  ref={closeRef}
                  onClick={handleClose}
                  aria-label="Close invoice panel"
                  className={`p-2.5 rounded-full hover:bg-black/8 transition-colors duration-150 ${
                    isLight ? 'text-black' : 'text-white'
                  }`}
                >
                  <Icons.X size={22} />
                </button>
              </div>
            </div>

            <div className="max-h-[42%] overflow-y-auto custom-scrollbar p-3 space-y-2 shrink-0">
              {cards.map((card, idx) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => selectInvoice(idx)}
                  className={`w-full text-left rounded-2xl px-4 py-4 transition-all duration-200 active:scale-[0.98] ${
                    idx === activeIdx
                      ? isLight ? 'bg-black text-white shadow-lg' : 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.15)]'
                      : isLight ? 'bg-black/5 hover:bg-black/8' : 'bg-white/5 hover:bg-white/8'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50 mb-0.5">
                        {card.isCurrent ? 'Current' : 'Saved'}
                      </div>
                      <div className="text-lg font-black tracking-tight truncate">{card.name}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] font-black uppercase tracking-widest opacity-40">Total</div>
                      <div className="text-base font-black">{currency} {card.total}</div>
                    </div>
                  </div>
                  <div className="text-[11px] opacity-50 mt-1.5">
                    {card.items.length} item{card.items.length !== 1 ? 's' : ''}
                  </div>
                </button>
              ))}
            </div>

            {cards[activeIdx] && (
              <div className={`border-t flex flex-col min-h-0 flex-1 ${isLight ? 'border-black/6' : 'border-white/6'}`}>
                <div className={`px-5 pt-4 pb-2 border-b shrink-0 ${isLight ? 'border-black/6' : 'border-white/6'}`}>
                  {cards[activeIdx].isCurrent ? (
                    <input
                      type="text"
                      value={invoiceName}
                      onChange={e => onInvoiceNameChange(e.target.value)}
                      placeholder="Invoice #1"
                      aria-label="Invoice name"
                      className={`w-full text-xl font-black tracking-tighter bg-transparent outline-none border-b border-transparent focus:border-current/20 ${
                        isLight ? 'text-black' : 'text-white'
                      }`}
                    />
                  ) : (
                    <div className="text-xl font-black tracking-tight truncate">{cards[activeIdx].name}</div>
                  )}
                </div>
                {renderCardContent(cards[activeIdx], true)}
              </div>
            )}
          </div>
        ) : (
          cards.map((card, idx) => {
            const { translateX, translateY, scale, opacity, blurPx, zIndex, isActive } = getCardStyle(idx);

            return (
              <div
                key={card.id}
                aria-label={`Invoice card: ${card.name}`}
                inert={!isActive || !isOpen ? true : undefined}
                role={isActive ? 'dialog' : undefined}
                aria-modal={isActive ? true : undefined}
                className={`
                  absolute inset-0 flex flex-col rounded-[32px] overflow-hidden
                  shadow-[0_24px_80px_rgba(0,0,0,0.55)]
                  ${panelBg} ${isLight ? 'text-black' : 'text-white'}
                `}
                style={{
                  transform: `translateX(${translateX}px) translateY(${translateY}px) scale(${scale})`,
                  transformOrigin: 'center center',
                  opacity,
                  zIndex,
                  filter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
                  transition: isDragging
                    ? 'none'
                    : 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease, filter 0.22s ease',
                  pointerEvents: isActive ? 'auto' : 'none',
                  cursor: isActive ? (isDragging ? 'grabbing' : 'grab') : 'default',
                }}
              >
                {renderCardBody(card, isActive)}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default HistoryPanel;