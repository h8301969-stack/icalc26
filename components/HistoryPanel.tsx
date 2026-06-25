import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '../constants';
import { CartLineItem, InvoiceActionLog } from '../types';
import { formatPosLineItemDisplay } from '../utils/posExpression';
import { printerInstance } from '../utils/bluetoothPrinter';


/* ─────────────────────────── types ─────────────────────────── */
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
}

interface InvoiceCard {
  id: string;
  name: string;
  items: CartLineItem[];
  logs: InvoiceActionLog[];
  total: string;
  isCurrent: boolean;
}

/* ─────────────────────────── carousel config ─────────────────────────── */
const PEEK_OFFSET  = 72;   // px — how much of the next card peeks from the right
const DRAG_FACTOR  = 1.0;  // drag sensitivity
const SWIPE_THRESHOLD = 40; // px — minimum drag to commit to next card

/* ─────────────────────────── component ─────────────────────────── */
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
}) => {
  /* ── build invoice card list ── */
  const cards = useMemo<InvoiceCard[]>(() => {
    // Group action logs by their invoiceName
    const grouped = new Map<string, InvoiceActionLog[]>();
    for (const log of actionLogs) {
      const key = log.invoiceName;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(log);
    }

    const built: InvoiceCard[] = [];

    // Past sessions (unique invoice names other than current)
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

    // Always place the current invoice as the FIRST card (front)
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

  /* ── carousel state ── */
  const [activeIdx, setActiveIdx] = useState(0);
  const [dragDelta, setDragDelta] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset to front card whenever panel opens
  useEffect(() => {
    if (isOpen) setActiveIdx(0);
  }, [isOpen]);

  /* ── keyboard ── */
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setActiveIdx(i => Math.min(i + 1, cards.length - 1));
      if (e.key === 'ArrowLeft')  setActiveIdx(i => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, cards.length]);

  /* ── drag / swipe handlers ── */
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragStartX.current = e.clientX;
    setIsDragging(true);
    setDragDelta(0);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const raw = (e.clientX - dragStartX.current) * DRAG_FACTOR;
    setDragDelta(raw);
  }, [isDragging]);

  const onPointerUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragDelta < -SWIPE_THRESHOLD) {
      setActiveIdx(i => Math.min(i + 1, cards.length - 1));
    } else if (dragDelta > SWIPE_THRESHOLD) {
      setActiveIdx(i => Math.max(i - 1, 0));
    }
    setDragDelta(0);
  }, [isDragging, dragDelta, cards.length]);

  /* ── style helpers ── */
  const panelBg  = isLight ? 'bg-[#f0f0f5]/96' : 'bg-[#0e0e12]/96';
  const textMuted = isLight ? 'text-zinc-400' : 'text-zinc-500';

  /* ─────────────────────────── render ─────────────────────────── */
  return (
    <div
      className={`fixed inset-0 z-120 flex items-center justify-center transition-all duration-300 p-4 ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      role="presentation"
      aria-hidden={!isOpen}
    >
      {/* backdrop */}
      <div
        className={`absolute inset-0 bg-black/50 backdrop-blur-3xl transition-opacity duration-400 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* popup modal */}
      <div
        className={`
          relative flex flex-col rounded-[32px] overflow-hidden
          shadow-[0_24px_80px_rgba(0,0,0,0.55)]
          transition-all duration-500
          ${isOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-8'}
          ${panelBg}
          ${isLight ? 'text-black' : 'text-white'}
        `}
        style={{ 
          height: '65vh',
          maxHeight: '800px',
          minHeight: '400px',
          aspectRatio: '9/16' // Portrait like iOS app switcher
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-title"
      >

        {/* header */}
        <div className={`px-5 pt-5 pb-3 flex items-center justify-between gap-3 border-b ${isLight ? 'border-black/6' : 'border-white/6'}`}>
          <input
            id="invoice-title"
            type="text"
            value={invoiceName}
            onChange={e => onInvoiceNameChange(e.target.value)}
            placeholder="Invoice #1"
            aria-label="Invoice name"
            className={`flex-1 min-w-0 text-2xl font-black tracking-tighter bg-transparent outline-none border-b border-transparent focus:border-current/20 transition-colors placeholder:opacity-30 ${isLight ? 'text-black' : 'text-white'}`}
          />
          <button
            onClick={onClose}
            aria-label="Close invoice panel"
            className={`p-2.5 rounded-full hover:bg-black/8 transition-colors duration-150 shrink-0 ${isLight ? 'text-black' : 'text-white'}`}
          >
            <Icons.X size={22} />
          </button>
        </div>

        {/* ───────── iOS App Switcher Carousel ───────── */}
        <div
          ref={containerRef}
          className="relative overflow-hidden select-none flex-1"
          style={{ minHeight: 300 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          aria-label="Invoice carousel"
          role="region"
        >
          {cards.map((card, idx) => {
            const W           = containerRef.current?.clientWidth ?? 360;
            const relativePos = idx - activeIdx; // 0 = front, +1 = next behind, -1 = previous

            // ── Base resting positions ──────────────────────────────────────────
            // front card (0) → translateX = 0 (full width)
            // prev cards (<0) → translateX = W * relativePos (off-screen left)
            // next cards (>0) → peek from right: each card starts at W - PEEK_OFFSET,
            //                   with successive cards offset back by (relativePos-1) * PEEK_OFFSET
            let baseX: number;
            if (relativePos === 0) {
              baseX = 0;
            } else if (relativePos < 0) {
              baseX = W * relativePos;          // fully off left
            } else {
              // relativePos 1 → W - PEEK_OFFSET  (first peek)
              // relativePos 2 → W - PEEK_OFFSET + 28 (stacks a bit further back)
              baseX = W - PEEK_OFFSET + (relativePos - 1) * 28;
            }

            // Add live drag offset so cards move together
            const translateX = baseX + dragDelta;

            // Scale: front card = 1, next cards slightly smaller, prev hidden
            const scale   = relativePos === 0 ? 1
                          : relativePos > 0    ? Math.max(0.84, 1 - relativePos * 0.05)
                          : 0.92;

            // Opacity: front = 1, stacked cards taper; past cards fade quickly
            const opacity = relativePos === 0  ? 1
                          : relativePos === 1  ? 0.78
                          : relativePos === 2  ? 0.52
                          : relativePos > 2    ? 0.28
                          : Math.max(0, 1 + relativePos * 0.4); // negative (prev)

            // Blur: front = 0, stacked right cards get blur, prev cards invisible
            const blurPx  = relativePos <= 0  ? 0
                          : relativePos === 1  ? 3
                          : relativePos * 6;

            // zIndex: front on top, stacked cards decrease, prev cards hide beneath
            const zIndex  = relativePos <= 0
              ? 100 + relativePos          // prev cards go under front
              : 100 - relativePos;         // next cards go under front too

            const isVisible = relativePos >= -1 && relativePos <= 4;

            return (
              <div
                key={card.id}
                aria-label={`Invoice card: ${card.name}`}
                style={{
                  position:  'absolute',
                  inset:     '16px 0',
                  left:      16,
                  right:     16,
                  transform: `translateX(${translateX}px) scale(${scale})`,
                  transformOrigin: 'top center',
                  opacity:   isVisible ? opacity : 0,
                  zIndex,
                  filter:    blurPx > 0 ? `blur(${blurPx}px)` : 'none',
                  transition: isDragging
                    ? 'none'
                    : 'transform 0.48s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease, filter 0.4s ease',
                  borderRadius: 22,
                  overflow: 'hidden',
                  cursor: relativePos !== 0 ? 'pointer' : 'default',
                  pointerEvents: relativePos !== 0 ? 'auto' : 'none',
                }}
                onClick={() => relativePos !== 0 && setActiveIdx(idx)}
              >
                {/* card glass surface */}
                <div
                  style={{
                    position:       'absolute',
                    inset:          0,
                    background:     isLight
                      ? 'rgba(255,255,255,0.7)'
                      : 'rgba(28,28,36,0.72)',
                    backdropFilter: 'blur(28px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(28px) saturate(180%)',
                    borderRadius:   22,
                    border:         isLight
                      ? '1px solid rgba(0,0,0,0.06)'
                      : '1px solid rgba(255,255,255,0.09)',
                    boxShadow:      isLight
                      ? '0 12px 32px rgba(0,0,0,0.12)'
                      : '0 0 20px rgba(255,255,255,0.18)',
                  }}
                />

                {/* card content */}
                <div
                  style={{
                    position:   'relative',
                    zIndex:     1,
                    height:     '100%',
                    display:    'flex',
                    flexDirection: 'column',
                    padding:    '18px 18px 14px',
                    gap:        10,
                    pointerEvents: relativePos === 0 ? 'auto' : 'none',
                  }}
                >
                  {/* card header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                    <div>
                      <div
                        style={{
                          fontSize:      10,
                          fontWeight:    900,
                          letterSpacing: '0.28em',
                          textTransform: 'uppercase',
                          opacity:       0.38,
                          marginBottom:  2,
                        }}
                      >
                        {card.isCurrent ? 'Current' : 'Saved'}
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                        {card.name}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.38 }}>
                        Total
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.04em' }}>
                        {currency} {card.total}
                      </div>
                    </div>
                  </div>

                  {/* divider */}
                  <div style={{ height: 1, background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.07)', borderRadius: 1 }} />

                  {/* items list */}
                  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {card.items.length === 0 ? (
                      <div
                        className={textMuted}
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, letterSpacing: '0.3em', textTransform: 'uppercase', opacity: 0.5 }}
                      >
                        No items yet
                      </div>
                    ) : (
                      card.items.map((item, i) => (
                        <div
                          key={i}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', opacity: 0.82 }}
                        >
                          <span>{formatPosLineItemDisplay(item, currency)}</span>
                          <span style={{ opacity: 0.55, fontSize: 11 }}>
                            {currency} {(item.price * item.quantity).toFixed(2)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  {/* card footer — print and clear buttons */}
                  {relativePos === 0 && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const numericTotal = parseFloat(card.total) || 0;
                            await printerInstance.printInvoiceImage(card.name, card.items, numericTotal, currency);
                          } catch (err: any) {
                            alert(err.message || 'Failed to print');
                          }
                        }}
                        style={{
                          flex:          1,
                          padding:       '10px 0',
                          borderRadius:  14,
                          background:    isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.08)',
                          color:         isLight ? '#000000' : '#ffffff',
                          fontSize:      10,
                          fontWeight:    900,
                          letterSpacing: '0.28em',
                          textTransform: 'uppercase',
                          border:        'none',
                          cursor:        'pointer',
                          transition:    'background 0.2s',
                          display:       'flex',
                          alignItems:    'center',
                          justifyContent: 'center',
                          gap:           6
                        }}
                        onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)')}
                        onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)')}
                        aria-label="Print invoice"
                      >
                        <Icons.Printer size={12} />
                        Print
                      </button>

                      {card.isCurrent && (
                        <button
                          onClick={e => { e.stopPropagation(); onClear(); }}
                          style={{
                            flex:          1,
                            padding:       '10px 0',
                            borderRadius:  14,
                            background:    'rgba(239, 68, 68, 0.10)',
                            color:         '#ef4444',
                            fontSize:      10,
                            fontWeight:    900,
                            letterSpacing: '0.28em',
                            textTransform: 'uppercase',
                            border:        'none',
                            cursor:        'pointer',
                            transition:    'background 0.2s',
                          }}
                          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.18)')}
                          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.10)')}
                          aria-label="Clear current invoice"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* pagination dots */}
        {cards.length > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, paddingBottom: 14, paddingTop: 2 }}>
            {cards.map((_, i) => (
              <button
                key={i}
                aria-label={`Go to card ${i + 1}`}
                onClick={() => setActiveIdx(i)}
                style={{
                  width:        i === activeIdx ? 20 : 6,
                  height:       6,
                  borderRadius: 3,
                  background:   i === activeIdx
                    ? (isLight ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)')
                    : (isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.22)'),
                  border:       'none',
                  cursor:       'pointer',
                  transition:   'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                  padding:      0,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryPanel;
