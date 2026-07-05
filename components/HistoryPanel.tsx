import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '../constants';
import { CartLineItem, InvoiceActionLog, InvoicePrintLog, UserProfile } from '../types';
import { printerInstance } from '../utils/bluetoothPrinter';
import {
  formatReceiptItemLine,
  getReceiptSpec,
  logReceiptPrint,
  truncateReceiptText,
  validateReceiptPrint,
  type PaperWidth,
} from '../utils/receiptLayout';
import { storage } from '../hooks/storage';
import InvoiceAttendantPicker from './InvoiceAttendantPicker';
import PrinterConnectModal from './PrinterConnectModal';

const ATTENDANT_NAMES_KEY = 'invoice_attendant_names';

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  isLight?: boolean;
  currency?: string;
  invoiceName: string;
  onInvoiceNameChange: (name: string) => void;
  cartItems: CartLineItem[];
  actionLogs: InvoiceActionLog[];
  runningTotal: string;
  printLogs: InvoicePrintLog[];
  profiles: UserProfile[];
  activeProfileId: string;
  onInvoicePrinted?: (invoiceName: string, total: string, items: CartLineItem[]) => void;
  onSelectInvoice?: (name: string, items: CartLineItem[], options?: { keepOpen?: boolean }) => void;
  switcherMode?: 'horizontal' | 'grid' | 'vertical';
  switcherGridCols?: 3 | 4;
  onSwitcherModeChange?: (mode: 'horizontal' | 'grid' | 'vertical') => void;
  onSwitcherGridColsChange?: (cols: 3 | 4) => void;
  onActiveChange?: (active: boolean) => void;
}

const SWITCHER_LAYOUT_OPTIONS = [
  { id: 'horizontal' as const, label: 'Horizontal carousel', icon: Icons.Carousel },
  { id: 'vertical' as const, label: 'Vertical stack', icon: Icons.Stack },
  { id: 'grid' as const, label: 'Grid view', icon: Icons.Grid },
];

interface InvoiceCard {
  id: string;
  name: string;
  items: CartLineItem[];
  logs: InvoiceActionLog[];
  total: string;
  isCurrent: boolean;
}

const DRAG_FACTOR = 1.25;
const VERTICAL_STRIP_HEIGHT = 52;
const SWIPE_THRESHOLD = 22;

const HistoryPanel: React.FC<HistoryPanelProps> = ({
  isOpen,
  onClose,
  isLight = false,
  currency = 'GHS',
  invoiceName,
  onInvoiceNameChange,
  cartItems,
  actionLogs,
  runningTotal,
  printLogs,
  profiles,
  activeProfileId,
  onInvoicePrinted,
  onSelectInvoice,
  switcherMode = 'horizontal',
  switcherGridCols = 3,
  onSwitcherModeChange,
  onSwitcherGridColsChange,
  onActiveChange,
}) => {
  const [attendantNames, setAttendantNames] = useState<Record<string, string>>(() =>
    storage.get(ATTENDANT_NAMES_KEY, {})
  );
  const [attendantPickerOpen, setAttendantPickerOpen] = useState(false);
  const [printerModalOpen, setPrinterModalOpen] = useState(false);
  const [pendingPrintCard, setPendingPrintCard] = useState<InvoiceCard | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [attendantPickerInvoice, setAttendantPickerInvoice] = useState<string | null>(null);
  const [receiptPaperWidth, setReceiptPaperWidth] = useState<PaperWidth>(() => printerInstance.paperWidth);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;
  const receiptSpec = useMemo(() => getReceiptSpec(receiptPaperWidth), [receiptPaperWidth]);
  const receiptStageClass = `invoice-receipt-stage invoice-receipt-stage--${receiptPaperWidth}`;

  const printedNames = useMemo(
    () => new Set(printLogs.map((log) => log.invoiceName)),
    [printLogs]
  );

  useEffect(() => {
    storage.set(ATTENDANT_NAMES_KEY, attendantNames);
  }, [attendantNames]);

  useEffect(() => {
    if (!isOpen) return;
    setReceiptPaperWidth(printerInstance.paperWidth);
  }, [isOpen, printerModalOpen, isPrinting]);

  const getAttendantForInvoice = useCallback(
    (name: string) => attendantNames[name] ?? activeProfile?.name ?? 'Staff',
    [attendantNames, activeProfile]
  );

  const setAttendantForInvoice = useCallback((name: string, attendant: string) => {
    setAttendantNames((prev) => ({ ...prev, [name]: attendant }));
  }, []);

  const executePrint = useCallback(
    async (card: InvoiceCard): Promise<{ ok: boolean; errors: string[] }> => {
      setReceiptPaperWidth(printerInstance.paperWidth);
      const numericTotal = parseFloat(card.total) || 0;
      const attendant = getAttendantForInvoice(card.name);
      const items = card.items.map((item, idx) => ({
        name: item.name || `Item ${idx + 1}`,
        price: item.price,
        quantity: item.quantity,
      }));

      const validation = validateReceiptPrint(
        card.name,
        items,
        printerInstance.paperWidth,
        !!attendant,
        currency
      );
      logReceiptPrint('validate', {
        context: 'invoice_switcher',
        invoiceName: card.name,
        paperWidth: printerInstance.paperWidth,
        itemCount: items.length,
        ok: validation.ok,
        errors: validation.errors,
        warnings: validation.warnings,
      });

      if (!validation.ok) {
        logReceiptPrint('failure', {
          context: 'invoice_switcher',
          reason: 'validation_failed',
          invoiceName: card.name,
          errors: validation.errors,
        });
        return { ok: false, errors: validation.errors };
      }

      if (validation.warnings.length > 0) {
        logReceiptPrint('validate', {
          context: 'invoice_switcher',
          phase: 'warnings_acknowledged',
          invoiceName: card.name,
          warnings: validation.warnings,
        });
      }

      const ok = await printerInstance.printInvoiceImage(
        card.name,
        items,
        numericTotal,
        currency,
        attendant
      );

      if (ok) {
        logReceiptPrint('success', {
          context: 'invoice_switcher',
          invoiceName: card.name,
          paperWidth: printerInstance.paperWidth,
          itemCount: items.length,
          warnings: validation.warnings,
        });
        return { ok: true, errors: [] };
      }

      logReceiptPrint('failure', {
        context: 'invoice_switcher',
        reason: 'print_returned_false',
        invoiceName: card.name,
        message: 'Printer busy or print aborted.',
      });
      return { ok: false, errors: ['Printer busy or print aborted.'] };
    },
    [currency, getAttendantForInvoice]
  );

  const handlePrintClick = useCallback(
    async (card: InvoiceCard) => {
      if (isPrinting) {
        logReceiptPrint('skipped', {
          context: 'invoice_switcher',
          reason: 'print_in_progress',
          invoiceName: card.name,
        });
        return;
      }
      setIsPrinting(true);
      try {
        const connected =
          printerInstance.isConnected || (await printerInstance.ensureConnected());
        if (!connected) {
          logReceiptPrint('skipped', {
            context: 'invoice_switcher',
            reason: 'printer_not_connected',
            invoiceName: card.name,
            message: 'Opening printer connect modal.',
          });
          setPendingPrintCard(card);
          setPrinterModalOpen(true);
          return;
        }
        setReceiptPaperWidth(printerInstance.paperWidth);
        const result = await executePrint(card);
        if (result.ok) {
          onInvoicePrinted?.(card.name, card.total, card.items);
        } else {
          const detail = result.errors.join(' ');
          alert(detail || 'Print failed. Check the browser console for [iCalc Receipt] details.');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to print';
        logReceiptPrint('failure', {
          context: 'invoice_switcher',
          reason: 'exception',
          invoiceName: card.name,
          message,
        });
        alert(message);
      } finally {
        setIsPrinting(false);
      }
    },
    [executePrint, isPrinting, onInvoicePrinted]
  );

  const handleModalPrint = useCallback(async () => {
    if (!pendingPrintCard) return;
    setIsPrinting(true);
    try {
      setReceiptPaperWidth(printerInstance.paperWidth);
      const result = await executePrint(pendingPrintCard);
      if (!result.ok) {
        throw new Error(result.errors.join(' ') || 'Printer is busy or receipt invalid. See console [iCalc Receipt].');
      }
      onInvoicePrinted?.(pendingPrintCard.name, pendingPrintCard.total, pendingPrintCard.items);
    } catch (err: unknown) {
      logReceiptPrint('failure', {
        context: 'invoice_switcher',
        reason: 'modal_print_exception',
        message: err instanceof Error ? err.message : 'Failed to print',
      });
      throw err;
    } finally {
      setIsPrinting(false);
    }
  }, [pendingPrintCard, executePrint, onInvoicePrinted]);
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

    built.push({
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
  const [gridZoomed, setGridZoomed] = useState(false);

  const activeReceiptValidation = useMemo(() => {
    const card = cards[activeIdx];
    if (!card) return null;
    const items = card.items.map((item, idx) => ({
      name: item.name || `Item ${idx + 1}`,
      price: item.price,
      quantity: item.quantity,
    }));
    return validateReceiptPrint(
      card.name,
      items,
      receiptPaperWidth,
      !!getAttendantForInvoice(card.name),
      currency
    );
  }, [cards, activeIdx, receiptPaperWidth, getAttendantForInvoice, currency]);
  const [dragDelta, setDragDelta] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartY = useRef(0);
  const dragAxis = useRef<'none' | 'x' | 'y'>('none');
  const suppressClickSelectRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(isOpen);
  const prevCardCountRef = useRef(cards.length);

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
      setActiveIdx(Math.max(0, cards.length - 1));
      setGridZoomed(false);
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

    const timer = window.setTimeout(() => setMounted(false), 500);
    return () => window.clearTimeout(timer);
  }, [isOpen, cards.length]);

  useEffect(() => {
    onActiveChange?.(isOpen || mounted);
  }, [isOpen, mounted, onActiveChange]);

  useEffect(() => {
    if (isOpen && cards.length > prevCardCountRef.current) {
      setActiveIdx(cards.length - 1);
    }
    prevCardCountRef.current = cards.length;
  }, [cards.length, isOpen]);

  const previewInvoice = useCallback((idx: number) => {
    if (idx < 0 || idx >= cards.length) return;
    setActiveIdx(idx);
  }, [cards.length]);

  const selectInvoice = useCallback((idx: number, options?: { keepOpen?: boolean }) => {
    const card = cards[idx];
    if (!card) return;
    setActiveIdx(idx);
    onSelectInvoice?.(card.name, card.items, options);
  }, [cards, onSelectInvoice]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (switcherMode === 'grid' && gridZoomed) {
          setGridZoomed(false);
          return;
        }
        handleClose();
      }
      if (switcherMode === 'horizontal') {
        if (e.key === 'ArrowRight') previewInvoice(Math.min(activeIdx + 1, cards.length - 1));
        if (e.key === 'ArrowLeft') previewInvoice(Math.max(activeIdx - 1, 0));
      }
      if (switcherMode === 'vertical') {
        if (e.key === 'ArrowDown') previewInvoice(Math.min(activeIdx + 1, cards.length - 1));
        if (e.key === 'ArrowUp') previewInvoice(Math.max(activeIdx - 1, 0));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose, cards.length, switcherMode, activeIdx, previewInvoice, gridZoomed]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (switcherMode === 'grid') return;
    if ((e.target as HTMLElement).closest('input, button, textarea')) return;
    dragStartX.current = e.clientX;
    dragStartY.current = e.clientY;
    dragAxis.current = 'none';
    suppressClickSelectRef.current = false;
    setIsDragging(true);
    setDragDelta(0);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [switcherMode]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || switcherMode === 'grid') return;
    const dx = e.clientX - dragStartX.current;
    const dy = e.clientY - dragStartY.current;
    const primaryAxis = switcherMode === 'vertical' ? 'y' : 'x';

    if (dragAxis.current === 'none' && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      dragAxis.current = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    }
    if (dragAxis.current !== primaryAxis) return;

    setDragDelta((primaryAxis === 'x' ? dx : dy) * DRAG_FACTOR);
  }, [isDragging, switcherMode]);

  const onPointerUp = useCallback(() => {
    if (!isDragging || switcherMode === 'grid') return;
    setIsDragging(false);
    const primaryAxis = switcherMode === 'vertical' ? 'y' : 'x';
    if (dragAxis.current === primaryAxis) {
      const absDelta = Math.abs(dragDelta);
      let nextIdx = activeIdx;
      if (dragDelta < -SWIPE_THRESHOLD) {
        nextIdx = Math.min(activeIdx + 1, cards.length - 1);
      } else if (dragDelta > SWIPE_THRESHOLD) {
        nextIdx = Math.max(activeIdx - 1, 0);
      }
      if (nextIdx !== activeIdx) {
        previewInvoice(nextIdx);
        suppressClickSelectRef.current = true;
      } else if (absDelta >= SWIPE_THRESHOLD) {
        suppressClickSelectRef.current = true;
      }
    }
    dragAxis.current = 'none';
    setDragDelta(0);
  }, [isDragging, dragDelta, cards.length, switcherMode, activeIdx, previewInvoice]);

  const handleCardSelectClick = useCallback((idx: number) => {
    if (suppressClickSelectRef.current) {
      suppressClickSelectRef.current = false;
      return;
    }
    selectInvoice(idx);
  }, [selectInvoice]);

  const handleSwitcherModeChange = useCallback(
    (mode: 'horizontal' | 'grid' | 'vertical') => {
      if (mode !== 'grid') setGridZoomed(false);
      setDragDelta(0);
      setIsDragging(false);
      dragAxis.current = 'none';
      onSwitcherModeChange?.(mode);
    },
    [onSwitcherModeChange]
  );

  const panelBg = isLight ? 'bg-[#f0f0f5]' : 'bg-[#0e0e12]';
  const textMuted = isLight ? 'text-zinc-400' : 'text-zinc-500';

  if (!mounted) return null;

  const getCardStyle = (idx: number) => {
    const relativePos = idx - activeIdx;

    if (Math.abs(relativePos) > 1) {
      return {
        translateX: '0px',
        translateY: 0,
        scale: 1,
        opacity: 0,
        blurPx: 0,
        zIndex: 90,
        transformOrigin: 'center center',
        isActive: false,
        hidden: true,
      };
    }

    let translateY = 0;
    let scale = 1;
    let opacity = 0;
    let blurPx = 0;
    let zIndex = 100;
    let transformOrigin = 'center center';
    let translateXValue = `${dragDelta}px`;

    if (relativePos === 0) {
      opacity = 1;
      zIndex = 120;
    } else if (relativePos === -1) {
      translateY = 6;
      scale = 0.98;
      opacity = 0.9;
      blurPx = 2.5;
      zIndex = 119;
      transformOrigin = 'right center';
      translateXValue = `calc(-65% + ${dragDelta}px)`;
    } else {
      translateY = 6;
      scale = 0.98;
      opacity = 0.9;
      blurPx = 2.5;
      zIndex = 119;
      transformOrigin = 'left center';
      translateXValue = `calc(65% + ${dragDelta}px)`;
    }

    return {
      translateX: translateXValue,
      translateY,
      scale,
      opacity,
      blurPx,
      zIndex,
      transformOrigin,
      isActive: relativePos === 0,
      hidden: false,
    };
  };

  const getVerticalCardStyle = (idx: number) => {
    const relativePos = idx - activeIdx;

    if (Math.abs(relativePos) > 1) {
      return {
        translateX: '0px',
        translateY: '0px',
        scale: 1,
        opacity: 0,
        blurPx: 0,
        zIndex: 90,
        transformOrigin: 'center center',
        isActive: false,
        isStrip: false,
        hidden: true,
      };
    }

    let translateY = 0;
    let scale = 1;
    let opacity = 1;
    let blurPx = 0;
    let zIndex = 100;
    const isActive = relativePos === 0;
    const isStrip = !isActive;

    if (isActive) {
      translateY = dragDelta;
      zIndex = 120;
    } else if (relativePos === -1) {
      translateY = 10 + dragDelta * 0.35;
      scale = 0.98;
      opacity = 0.88;
      blurPx = 1;
      zIndex = 119;
    } else {
      translateY = -10 + dragDelta * 0.35;
      scale = 0.96;
      opacity = 0.82;
      blurPx = 1.5;
      zIndex = 118;
    }

    return {
      translateX: '0px',
      translateY: `${translateY}px`,
      scale,
      opacity,
      blurPx,
      zIndex,
      transformOrigin: 'center center',
      isActive,
      isStrip,
      hidden: false,
    };
  };

  const renderCloseButton = (ref?: React.Ref<HTMLButtonElement>) => (
    <button
      ref={ref ?? closeRef}
      onClick={handleClose}
      aria-label="Close invoice panel"
      className={`w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-90 shrink-0 border ${
        isLight
          ? 'bg-white/70 backdrop-blur-xl text-black border-black/10 hover:bg-white/90'
          : 'bg-white/10 backdrop-blur-xl text-white border-white/15 hover:bg-white/20'
      }`}
    >
      <Icons.X size={20} />
    </button>
  );

  const renderSwitcherLayoutToolbar = () => {
    if (!isOpen || !onSwitcherModeChange) return null;

    const modeBtnClass = (active: boolean) =>
      `w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-90 border ${
        active
          ? isLight
            ? 'bg-blue-500 text-white border-blue-500 shadow-[0_8px_24px_rgba(59,130,246,0.45)]'
            : 'bg-white text-black border-white shadow-[0_0_24px_rgba(255,255,255,0.35)]'
          : isLight
            ? 'bg-white/70 backdrop-blur-xl text-black border-black/10 hover:bg-white/90'
            : 'bg-white/10 backdrop-blur-xl text-white border-white/15 hover:bg-white/20'
      }`;

    const densityBtnClass = (active: boolean) =>
      `w-9 h-9 rounded-full flex items-center justify-center text-[9px] font-black transition-all active:scale-90 border ${
        active
          ? isLight
            ? 'bg-zinc-900 text-white border-zinc-900'
            : 'bg-white text-black border-white'
          : isLight
            ? 'bg-white/60 backdrop-blur-xl text-black border-black/10'
            : 'bg-white/8 backdrop-blur-xl text-white border-white/12'
      }`;

    return (
      <div
        className={`absolute top-0 left-0 right-0 z-30 pt-5 px-4 sm:px-5 flex items-center justify-between gap-3 pointer-events-none transition-opacity duration-280 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        role="toolbar"
        aria-label="Invoice switcher layout"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-11 shrink-0" aria-hidden="true" />

        <div className="pointer-events-auto flex items-center gap-2">
          {SWITCHER_LAYOUT_OPTIONS.map(({ id, label, icon: Icon }) => {
            const active = switcherMode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleSwitcherModeChange(id)}
                aria-label={label}
                aria-pressed={active}
                title={label}
                className={modeBtnClass(active)}
              >
                <Icon size={18} />
              </button>
            );
          })}

          {switcherMode === 'grid' && onSwitcherGridColsChange && (
            <div className={`flex items-center gap-1.5 ml-1 pl-2 border-l ${isLight ? 'border-black/10' : 'border-white/15'}`}>
              {([3, 4] as const).map((cols) => (
                <button
                  key={cols}
                  type="button"
                  onClick={() => onSwitcherGridColsChange(cols)}
                  aria-label={`${cols} by ${cols} grid`}
                  aria-pressed={switcherGridCols === cols}
                  className={densityBtnClass(switcherGridCols === cols)}
                >
                  {cols}×{cols}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pointer-events-auto shrink-0">
          {renderCloseButton()}
        </div>
      </div>
    );
  };

  const renderGridTile = (card: InvoiceCard, idx: number) => {
    const isSelected = idx === activeIdx;
    const isPaid = printedNames.has(card.name);
    const isBlurredPeer = gridZoomed && !isSelected;
    const isHiddenSelected = gridZoomed && isSelected;

    return (
      <button
        key={card.id}
        type="button"
        onClick={() => {
          selectInvoice(idx, { keepOpen: true });
          setGridZoomed(true);
        }}
        className={`text-left rounded-2xl p-3 sm:p-4 w-full aspect-[6/13] flex flex-col gap-1.5 transition-all duration-300 active:scale-[0.97] border ${
          isSelected && !gridZoomed
            ? 'bg-black text-white border-black shadow-lg'
            : isLight
              ? 'bg-white border-black/8 hover:bg-black/[0.03] text-black'
              : 'bg-white/8 border-white/10 hover:bg-white/12 text-white'
        } ${isHiddenSelected ? 'opacity-0 scale-75 pointer-events-none' : ''}`}
        style={{
          filter: isBlurredPeer ? 'blur(8px)' : 'none',
          opacity: isHiddenSelected ? 0 : isBlurredPeer ? 0.42 : 1,
          transform: isBlurredPeer ? 'scale(0.94)' : isHiddenSelected ? 'scale(0.75)' : 'scale(1)',
        }}
        aria-hidden={isHiddenSelected}
        tabIndex={isHiddenSelected ? -1 : 0}
      >
        <div className="flex items-start justify-between gap-1">
          <span className={`app-subtext text-[8px] font-black ${isSelected ? 'opacity-70' : 'opacity-45'}`}>
            {card.isCurrent ? 'Current' : isPaid ? 'Paid' : 'Saved'}
          </span>
          <span className={`app-subtext text-[9px] font-black shrink-0 ${isSelected ? 'opacity-80' : 'opacity-55'}`}>
            {card.items.length}
          </span>
        </div>
        <div className="text-[11px] font-black tracking-tight leading-tight line-clamp-2 min-h-[2.4em]">
          {card.name}
        </div>
        <div className={`app-subtext text-[10px] font-black mt-auto ${isSelected ? 'opacity-90' : 'opacity-60'}`}>
          {currency} {card.total}
        </div>
        {card.items.length > 0 && (
          <div className={`app-subtext text-[8px] font-semibold leading-snug line-clamp-2 invoice-receipt-line ${isSelected ? 'opacity-65' : 'opacity-45'}`}>
            {formatReceiptItemLine(
              card.items[0].name || 'Item 1',
              card.items[0].quantity,
              card.items[0].price,
              currency,
              receiptSpec
            ).line}
            {card.items.length > 1 ? ` +${card.items.length - 1}` : ''}
          </div>
        )}
      </button>
    );
  };

  const renderVerticalStrip = (card: InvoiceCard) => {
    const isPaid = printedNames.has(card.name);

    return (
      <div className="h-full px-4 flex items-center justify-between gap-3 border-b border-black/8 bg-white text-black">
        <div className="min-w-0 flex items-center gap-2">
          <span className="app-subtext text-[9px] font-black opacity-45 shrink-0 text-black/60">
            {card.isCurrent ? 'Current' : isPaid ? 'Paid' : 'Saved'}
          </span>
          <span className="text-sm font-black tracking-tight truncate">{card.name}</span>
        </div>
        <span className="text-xs font-black shrink-0 opacity-70">
          {currency} {card.total}
        </span>
      </div>
    );
  };

  const renderCardContent = (card: InvoiceCard, isActive: boolean) => {
    const attendant = getAttendantForInvoice(card.name);
    const rule = '-'.repeat(Math.floor(receiptSpec.maxCols * 0.95));
    const rawTitle = card.isCurrent && isActive ? invoiceName : card.name;
    const titleDisplay = truncateReceiptText(rawTitle.toUpperCase(), receiptSpec.maxInvoiceTitleChars);
    const compact = receiptPaperWidth === '25mm';
    const lineSize = compact ? 'text-[10px]' : 'text-xs';
    const metaSize = compact ? 'text-[8px]' : 'text-[9px]';

    return (
      <div className={`flex-1 flex flex-col min-h-0 text-black invoice-receipt-line ${compact ? 'px-2 py-2 gap-1' : 'px-3 py-3 gap-1.5'}`}>
        <div className="text-center shrink-0">
          <div className={`font-bold uppercase tracking-tight ${lineSize}`}>{titleDisplay}</div>
          <div className={`opacity-50 ${metaSize}`}>iCalc Spatial POS Receipt</div>
          {isActive && (
            <div className={`opacity-45 ${metaSize}`}>
              Served by: {truncateReceiptText(attendant, receiptSpec.maxCols - 11)}
            </div>
          )}
        </div>

        <div className={`opacity-30 text-center ${metaSize}`}>{rule}</div>

        <div
          className="flex-1 overflow-y-auto flex flex-col gap-0.5 custom-scrollbar"
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
            card.items.map((item, i) => {
              const { displayName, priceText, line } = formatReceiptItemLine(
                item.name || `Item ${i + 1}`,
                item.quantity,
                item.price,
                currency,
                receiptSpec
              );
              return (
                <div
                  key={i}
                  className={`invoice-receipt-line flex items-baseline justify-between gap-1 ${lineSize} opacity-85`}
                  title={line}
                >
                  <span className="min-w-0 truncate">{displayName}</span>
                  <span className="shrink-0 tabular-nums">{priceText}</span>
                </div>
              );
            })
          )}
        </div>

        <div className={`opacity-30 text-center ${metaSize}`}>{rule}</div>
        <div className={`text-right font-bold tabular-nums ${lineSize}`}>
          TOTAL: {currency}{card.total}
        </div>

        {isActive && activeReceiptValidation && activeReceiptValidation.warnings.length > 0 && (
          <div className="shrink-0 mt-1 px-1.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200/80 text-[8px] leading-snug text-amber-900">
            {activeReceiptValidation.warnings.map((warning, i) => (
              <div key={i}>{warning}</div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderCardFooter = (card: InvoiceCard, isActive: boolean) => {
    if (!isActive) return null;
    const attendant = getAttendantForInvoice(card.name);

    const compact = receiptPaperWidth === '25mm';

    return (
      <div
        className={`shrink-0 border-t border-black/6 bg-white flex items-center gap-2 ${
          compact ? 'px-2 py-2' : 'px-3 py-2.5'
        }`}
        style={{ touchAction: 'auto' }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAttendantPickerInvoice(card.name);
            setAttendantPickerOpen(true);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 text-left px-4 py-3 rounded-xl border border-black/8 bg-black/[0.03] text-sm font-black tracking-tight text-black hover:bg-black/[0.06] active:scale-[0.99] transition-all truncate"
          aria-label="Choose name for print"
        >
          {attendant}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handlePrintClick(card);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={isPrinting || card.items.length === 0}
          className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-emerald-500 text-white shadow-[0_8px_24px_rgba(0,0,0,0.22),0_0_14px_rgb(16,185,129)] active:scale-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Print and mark paid"
        >
          <Icons.Check size={18} />
        </button>
      </div>
    );
  };

  const renderCardBody = (card: InvoiceCard, isActive: boolean) => {
    const isPaid = printedNames.has(card.name);
    const compact = receiptPaperWidth === '25mm';
    const headerPad = compact ? 'px-2 pt-3 pb-2' : 'px-3 pt-4 pb-3';

    return (
    <>
      <div
        className={`${headerPad} flex items-center justify-between gap-2 shrink-0 text-black bg-white border-b border-black/6`}
      >
        <div className="flex-1 min-w-0">
          <div className="app-subtext text-[8px] font-black text-black/40 mb-0.5">
            {receiptPaperWidth} receipt · {receiptSpec.maxCols} cols
            {card.isCurrent ? ' · Current' : isPaid ? ' · Paid' : ' · Unpaid'}
          </div>
          {card.isCurrent && isActive ? (
            <input
              id="invoice-title"
              type="text"
              value={invoiceName}
              onChange={e => onInvoiceNameChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              placeholder="Invoice #1"
              aria-label="Invoice name"
              className={`w-full min-w-0 font-black tracking-tighter bg-transparent outline-none border-b border-transparent focus:border-black/20 transition-colors placeholder:text-black/30 text-black invoice-receipt-line ${
                compact ? 'text-base' : 'text-xl'
              }`}
            />
          ) : (
            <div
              id={isActive ? 'invoice-title' : undefined}
              className={`font-black tracking-tighter invoice-receipt-line truncate ${
                compact ? 'text-base' : 'text-xl'
              }`}
              title={card.name}
            >
              {truncateReceiptText(card.name, receiptSpec.maxInvoiceTitleChars)}
            </div>
          )}
          {card.isCurrent && isActive && invoiceName.length > receiptSpec.maxInvoiceTitleChars && (
            <div className="app-subtext text-[8px] text-amber-700 mt-0.5">
              Title truncates to {receiptSpec.maxInvoiceTitleChars} chars on {receiptPaperWidth} paper
            </div>
          )}
        </div>

        {isActive && (switcherMode !== 'grid' || gridZoomed) && (
          <div className="flex items-center gap-2 shrink-0">
            {switcherMode === 'grid' && gridZoomed && (
              <button
                type="button"
                onClick={() => setGridZoomed(false)}
                aria-label="Back to invoice grid"
                className={`p-2.5 rounded-full transition-colors duration-150 shrink-0 ${
                  isLight ? 'text-black hover:bg-black/8' : 'text-white hover:bg-white/8'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
            )}
            {!onSwitcherModeChange && renderCloseButton()}
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col min-h-0 bg-white text-black overflow-hidden">
        {renderCardContent(card, isActive)}
        {renderCardFooter(card, isActive)}
      </div>

      {isActive && switcherMode === 'horizontal' && cards.length > 1 && (
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
              onClick={() => selectInvoice(i)}
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
  };

  return (
    <div
      ref={rootRef}
      inert={!isOpen ? true : undefined}
      className={`fixed inset-0 z-120 transition-all duration-280 ${
        switcherMode === 'grid'
          ? ''
          : 'flex items-end sm:items-center justify-center p-4 pb-6 sm:pb-4 pt-[4.75rem] sm:pt-20'
      } ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
    >
      <div
        className={`absolute inset-0 transition-opacity duration-280 ${
          isLight ? 'bg-[#f2f2f7]' : 'bg-[#0a0a0c]'
        } ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={() => {
          if (switcherMode === 'grid' && gridZoomed) setGridZoomed(false);
          else handleClose();
        }}
        aria-hidden="true"
      />

      {renderSwitcherLayoutToolbar()}

      {switcherMode === 'grid' ? (
        <>
          <div
            className={`absolute inset-0 z-10 flex flex-col transition-all duration-500 ${
              isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            role="region"
            aria-label="Invoice grid"
          >
            <div className="shrink-0 px-5 pt-[4.5rem] pb-3">
              <div className={`text-sm font-black tracking-tight ${isLight ? 'text-black' : 'text-white'}`}>
                Invoices
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 pb-6 sm:px-5 sm:pb-8">
              <div
                className={`grid gap-2 sm:gap-3 min-h-full content-start ${
                  switcherGridCols === 4 ? 'grid-cols-4' : 'grid-cols-3'
                }`}
              >
                {cards.map((card, idx) => renderGridTile(card, idx))}
              </div>
            </div>
          </div>

          {gridZoomed && cards[activeIdx] && (
            <div
              className={`absolute inset-0 z-20 flex items-center justify-center p-4 pb-6 sm:pb-4 pt-[4.75rem] sm:pt-20 pointer-events-none transition-all duration-500 ${
                isOpen ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <div
                className={`relative ${receiptStageClass} select-none pointer-events-auto transition-all duration-500 ${
                  isOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-90 translate-y-8'
                }`}
                role="dialog"
                aria-modal="true"
                aria-label={`Invoice card: ${cards[activeIdx].name}`}
              >
                <div className="absolute inset-0 flex flex-col rounded-[32px] overflow-hidden bg-white text-black shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
                  {renderCardBody(cards[activeIdx], true)}
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
      <div
        ref={stageRef}
        className={`relative z-20 ${receiptStageClass} select-none transition-all duration-500 overflow-visible ${
          isOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-[calc(100%+2rem)]'
        }`}
        style={{
          touchAction:
            switcherMode === 'horizontal' ? 'pan-x' : switcherMode === 'vertical' ? 'pan-y' : 'auto',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Invoice switcher"
        role="region"
      >
        {switcherMode === 'vertical' ? (
          cards.map((card, idx) => {
            const {
              translateX,
              translateY,
              scale,
              opacity,
              blurPx,
              zIndex,
              transformOrigin,
              isActive,
              isStrip,
              hidden,
            } = getVerticalCardStyle(idx);

            if (hidden) return null;

            return (
              <div
                key={card.id}
                aria-label={`Invoice card: ${card.name}`}
                inert={!isActive || !isOpen ? true : undefined}
                role={isActive ? 'dialog' : undefined}
                aria-modal={isActive ? true : undefined}
                className={`absolute left-0 right-0 flex flex-col rounded-[32px] overflow-hidden bg-white text-black shadow-[0_24px_80px_rgba(0,0,0,0.55)] ${
                  isStrip ? 'mx-3' : 'inset-0'
                }`}
                style={{
                  top: isStrip ? (idx < activeIdx ? 0 : 'auto') : 0,
                  bottom: isStrip && idx > activeIdx ? 0 : 'auto',
                  height: isStrip ? VERTICAL_STRIP_HEIGHT : '100%',
                  transform: `translateX(${translateX}) translateY(${translateY}) scale(${scale})`,
                  transformOrigin,
                  opacity,
                  zIndex,
                  filter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
                  transition: isDragging
                    ? 'none'
                    : 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease, filter 0.22s ease',
                  pointerEvents: 'auto',
                  cursor: isActive ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
                }}
                onClick={() => handleCardSelectClick(idx)}
              >
                {isStrip ? renderVerticalStrip(card) : renderCardBody(card, isActive)}
              </div>
            );
          })
        ) : (
          cards.map((card, idx) => {
            const { translateX, translateY, scale, opacity, blurPx, zIndex, transformOrigin, isActive, hidden } = getCardStyle(idx);

            if (hidden) return null;

            return (
              <div
                key={card.id}
                aria-label={`Invoice card: ${card.name}`}
                inert={!isActive || !isOpen ? true : undefined}
                role={isActive ? 'dialog' : undefined}
                aria-modal={isActive ? true : undefined}
                className="absolute inset-0 flex flex-col rounded-[32px] overflow-hidden bg-white text-black shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
                style={{
                  transform: `translateX(${translateX}) translateY(${translateY}px) scale(${scale})`,
                  transformOrigin,
                  opacity,
                  zIndex,
                  filter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
                  transition: isDragging
                    ? 'none'
                    : 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease, filter 0.22s ease',
                  pointerEvents: 'auto',
                  cursor: isActive ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
                }}
                onClick={() => handleCardSelectClick(idx)}
              >
                {renderCardBody(card, isActive)}
              </div>
            );
          })
        )}
      </div>
      )}

      <InvoiceAttendantPicker
        isOpen={attendantPickerOpen}
        onClose={() => setAttendantPickerOpen(false)}
        isLight={isLight}
        profiles={profiles}
        selectedName={attendantPickerInvoice ? getAttendantForInvoice(attendantPickerInvoice) : ''}
        onSelectName={(name) => {
          if (attendantPickerInvoice) {
            setAttendantForInvoice(attendantPickerInvoice, name);
          }
        }}
      />

      <PrinterConnectModal
        isOpen={printerModalOpen}
        onClose={() => {
          setPrinterModalOpen(false);
          setPendingPrintCard(null);
        }}
        isLight={isLight}
        isPrinting={isPrinting}
        onPrint={handleModalPrint}
        autoPrintOnConnect={!!pendingPrintCard}
      />
    </div>
  );
};

export default HistoryPanel;