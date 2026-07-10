import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '../constants';
import { CartLineItem, InvoiceActionLog, InvoicePrintLog, UserProfile } from '../types';
import { printerInstance } from '../utils/bluetoothPrinter';
import {
  getReceiptSpec,
  logReceiptPrint,
  truncateReceiptText,
  validateReceiptPrint,
  type PaperWidth,
} from '../utils/receiptLayout';
import { storage } from '../hooks/storage';
import { resolveWallpaperImage } from '../utils/wallpapers';
import InvoiceAttendantPicker from './InvoiceAttendantPicker';
import PrinterConnectModal from './PrinterConnectModal';
import { shareInvoiceAsImage, type ShareReceiptSettings } from '../utils/invoiceShareImage';

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
  switcherMode?: 'horizontal' | 'grid' | 'vertical' | 'list';
  onSwitcherModeChange?: (mode: 'horizontal' | 'grid' | 'vertical' | 'list') => void;
  onActiveChange?: (active: boolean) => void;
  wallpapers?: { image: string }[];
  shareReceiptSettings?: ShareReceiptSettings;
  businessName?: string;
}

const SWITCHER_LAYOUT_OPTIONS = [
  { id: 'horizontal' as const, label: 'Horizontal carousel', icon: Icons.Carousel },
  { id: 'vertical' as const, label: 'Vertical stack', icon: Icons.Stack },
  { id: 'grid' as const, label: 'Scattered grid', icon: Icons.Grid },
  { id: 'list' as const, label: 'List view', icon: Icons.List },
];

const LONG_PRESS_MS = 480;
const INVOICE_LOAD_MS = 400;
const SCATTERED_GRID_MIN_TILE = 'min(100%, 148px)';
const SCATTERED_GRID_GAP = '1.1rem';

interface InvoiceCard {
  id: string;
  name: string;
  items: CartLineItem[];
  logs: InvoiceActionLog[];
  total: string;
  isCurrent: boolean;
}

const DRAG_FACTOR = 1.25;
const SWIPE_THRESHOLD = 22;

const formatSwitcherAmount = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
};

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
  onSwitcherModeChange,
  onActiveChange,
  wallpapers = [],
  shareReceiptSettings = { layoutMode: 'summary' },
  businessName = '',
}) => {
  const invoiceBrandLabel = businessName.trim() || 'iCalc POS';
  const [attendantNames, setAttendantNames] = useState<Record<string, string>>(() =>
    storage.get(ATTENDANT_NAMES_KEY, {})
  );
  const [attendantPickerOpen, setAttendantPickerOpen] = useState(false);
  const [printerModalOpen, setPrinterModalOpen] = useState(false);
  const [pendingPrintCard, setPendingPrintCard] = useState<InvoiceCard | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [attendantPickerInvoice, setAttendantPickerInvoice] = useState<string | null>(null);
  const [receiptPaperWidth, setReceiptPaperWidth] = useState<PaperWidth>(() => printerInstance.paperWidth);
  const [wallpaperSlide, setWallpaperSlide] = useState(0);
  const wallpaperSlides = wallpapers.length > 0 ? wallpapers : [{ image: '' }];

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

  useEffect(() => {
    if (!isOpen) return;
    const onChange = () => {
      setReceiptPaperWidth(printerInstance.paperWidth);
    };
    printerInstance.setConnectionChangeListener(onChange);
    return () => printerInstance.removeConnectionChangeListener(onChange);
  }, [isOpen]);

  useEffect(() => {
    if (wallpaperSlides.length <= 1) return;
    const timer = setInterval(() => {
      setWallpaperSlide((prev) => (prev + 1) % wallpaperSlides.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [wallpaperSlides.length]);

  const getAttendantForInvoice = useCallback(
    (name: string) => attendantNames[name] ?? activeProfile?.name ?? 'Staff',
    [attendantNames, activeProfile]
  );

  const setAttendantForInvoice = useCallback((name: string, attendant: string) => {
    setAttendantNames((prev) => ({ ...prev, [name]: attendant }));
  }, []);

  const resolvePrintCard = useCallback(
    (card: InvoiceCard): InvoiceCard => {
      if (!card.isCurrent) return card;
      return {
        ...card,
        name: invoiceName.trim() || card.name,
        total: runningTotal || card.total,
        items: cartItems,
      };
    },
    [invoiceName, runningTotal, cartItems]
  );

  const canPrintCard = useCallback(
    (card: InvoiceCard) => {
      const resolved = resolvePrintCard(card);
      if (!resolved.name.trim()) return false;
      if (shareReceiptSettings.layoutMode === 'full' && resolved.items.length === 0) return false;
      return true;
    },
    [resolvePrintCard, shareReceiptSettings.layoutMode]
  );

  const executePrint = useCallback(
    async (card: InvoiceCard): Promise<{ ok: boolean; errors: string[] }> => {
      const printCard = resolvePrintCard(card);
      setReceiptPaperWidth(printerInstance.paperWidth);
      const numericTotal = parseFloat(printCard.total) || 0;
      const attendant = getAttendantForInvoice(printCard.name);
      const items = printCard.items.map((item, idx) => ({
        name: item.name || `Item ${idx + 1}`,
        price: item.price,
        quantity: item.quantity,
      }));

      const validation = validateReceiptPrint(
        printCard.name,
        items,
        printerInstance.paperWidth,
        !!attendant,
        currency,
        shareReceiptSettings.layoutMode
      );
      logReceiptPrint('validate', {
        context: 'invoice_switcher',
        invoiceName: printCard.name,
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
          invoiceName: printCard.name,
          errors: validation.errors,
        });
        return { ok: false, errors: validation.errors };
      }

      if (validation.warnings.length > 0) {
        logReceiptPrint('validate', {
          context: 'invoice_switcher',
          phase: 'warnings_acknowledged',
          invoiceName: printCard.name,
          warnings: validation.warnings,
        });
      }

      const ok = await printerInstance.printInvoiceImage(
        printCard.name,
        items,
        numericTotal,
        currency,
        attendant,
        shareReceiptSettings.layoutMode
      );

      if (ok) {
        logReceiptPrint('success', {
          context: 'invoice_switcher',
          invoiceName: printCard.name,
          paperWidth: printerInstance.paperWidth,
          itemCount: items.length,
          warnings: validation.warnings,
        });
        return { ok: true, errors: [] };
      }

      logReceiptPrint('failure', {
        context: 'invoice_switcher',
        reason: 'print_returned_false',
        invoiceName: printCard.name,
        message: 'Printer busy or print aborted.',
      });
      return { ok: false, errors: ['Printer busy or print aborted.'] };
    },
    [currency, getAttendantForInvoice, resolvePrintCard, shareReceiptSettings.layoutMode]
  );

  const handleShareClick = useCallback(
    async (card: InvoiceCard) => {
      if (isSharing || (shareReceiptSettings.layoutMode === 'full' && card.items.length === 0)) return;
      setIsSharing(true);
      try {
        const result = await shareInvoiceAsImage(
          {
            invoiceName: card.name,
            total: card.total,
            currency,
            attendantName: getAttendantForInvoice(card.name),
            items: card.items,
          },
          shareReceiptSettings
        );
        if (!result.ok) {
          alert(result.error || 'Could not share invoice.');
        }
      } finally {
        setIsSharing(false);
      }
    },
    [currency, getAttendantForInvoice, isSharing, shareReceiptSettings]
  );

  const handlePrintClick = useCallback(
    async (card: InvoiceCard) => {
      const printCard = resolvePrintCard(card);
      if (!canPrintCard(card)) return;
      if (isPrinting) {
        logReceiptPrint('skipped', {
          context: 'invoice_switcher',
          reason: 'print_in_progress',
          invoiceName: printCard.name,
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
            invoiceName: printCard.name,
            message: 'Opening printer connect modal.',
          });
          setPendingPrintCard(printCard);
          setPrinterModalOpen(true);
          return;
        }
        setReceiptPaperWidth(printerInstance.paperWidth);
        const result = await executePrint(card);
        if (result.ok) {
          onInvoicePrinted?.(printCard.name, printCard.total, printCard.items);
        } else {
          const detail = result.errors.join(' ');
          alert(detail || 'Print failed. Check the browser console for [iCalc Receipt] details.');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to print';
        logReceiptPrint('failure', {
          context: 'invoice_switcher',
          reason: 'exception',
          invoiceName: printCard.name,
          message,
        });
        alert(message);
      } finally {
        setIsPrinting(false);
      }
    },
    [canPrintCard, executePrint, isPrinting, onInvoicePrinted, resolvePrintCard]
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
  const [loadingInvoiceIdx, setLoadingInvoiceIdx] = useState<number | null>(null);
  const [focusZoomed, setFocusZoomed] = useState(false);
  const invoiceLoadTimerRef = useRef<number | null>(null);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const listLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listLongPressFired = useRef(false);
  const listLongPressIdx = useRef<number | null>(null);

  const isBrowseMode = switcherMode === 'grid' || switcherMode === 'list';

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
      currency,
      shareReceiptSettings.layoutMode
    );
  }, [cards, activeIdx, receiptPaperWidth, getAttendantForInvoice, currency, shareReceiptSettings.layoutMode]);
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

  const clearInvoiceLoadTimer = useCallback(() => {
    if (invoiceLoadTimerRef.current !== null) {
      window.clearTimeout(invoiceLoadTimerRef.current);
      invoiceLoadTimerRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    clearInvoiceLoadTimer();
    setLoadingInvoiceIdx(null);
    const root = rootRef.current;
    const active = document.activeElement as HTMLElement | null;
    if (root?.contains(active)) {
      active.blur();
    }
    onClose();
  }, [onClose, clearInvoiceLoadTimer]);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      setActiveIdx(Math.max(0, cards.length - 1));
      setFocusZoomed(false);
      setLoadingInvoiceIdx(null);
      clearInvoiceLoadTimer();
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

    clearInvoiceLoadTimer();
    setLoadingInvoiceIdx(null);
    const timer = window.setTimeout(() => setMounted(false), 500);
    return () => {
      window.clearTimeout(timer);
      clearInvoiceLoadTimer();
    };
  }, [isOpen, cards.length, clearInvoiceLoadTimer]);

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

  const beginInvoiceLoad = useCallback((idx: number) => {
    if (idx < 0 || idx >= cardsRef.current.length || loadingInvoiceIdx !== null) return;

    setActiveIdx(idx);
    setFocusZoomed(false);
    setLoadingInvoiceIdx(idx);
    clearInvoiceLoadTimer();

    invoiceLoadTimerRef.current = window.setTimeout(() => {
      invoiceLoadTimerRef.current = null;
      setLoadingInvoiceIdx(null);
      const card = cardsRef.current[idx];
      if (!card) return;
      onSelectInvoice?.(card.name, card.items);
    }, INVOICE_LOAD_MS);
  }, [loadingInvoiceIdx, onSelectInvoice, clearInvoiceLoadTimer]);

  const openInvoiceFocus = useCallback((idx: number) => {
    if (idx < 0 || idx >= cards.length || loadingInvoiceIdx !== null) return;
    setActiveIdx(idx);
    setFocusZoomed(true);
    if ('vibrate' in navigator) navigator.vibrate(10);
  }, [cards.length, loadingInvoiceIdx]);

  const cancelListLongPress = useCallback(() => {
    if (listLongPressTimer.current) {
      clearTimeout(listLongPressTimer.current);
      listLongPressTimer.current = null;
    }
    listLongPressIdx.current = null;
  }, []);

  const startListLongPress = useCallback((idx: number) => {
    cancelListLongPress();
    listLongPressIdx.current = idx;
    listLongPressFired.current = false;
    listLongPressTimer.current = setTimeout(() => {
      listLongPressFired.current = true;
      openInvoiceFocus(idx);
      listLongPressTimer.current = null;
    }, LONG_PRESS_MS);
  }, [cancelListLongPress, openInvoiceFocus]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isBrowseMode && focusZoomed) {
          setFocusZoomed(false);
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
  }, [isOpen, handleClose, cards.length, switcherMode, activeIdx, previewInvoice, focusZoomed, isBrowseMode]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (isBrowseMode) return;
    if ((e.target as HTMLElement).closest('input, button, textarea')) return;
    dragStartX.current = e.clientX;
    dragStartY.current = e.clientY;
    dragAxis.current = 'none';
    suppressClickSelectRef.current = false;
    setIsDragging(true);
    setDragDelta(0);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [isBrowseMode]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || isBrowseMode) return;
    const dx = e.clientX - dragStartX.current;
    const dy = e.clientY - dragStartY.current;
    const primaryAxis = switcherMode === 'vertical' ? 'y' : 'x';

    if (dragAxis.current === 'none' && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      dragAxis.current = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    }
    if (dragAxis.current !== primaryAxis) return;

    setDragDelta((primaryAxis === 'x' ? dx : dy) * DRAG_FACTOR);
  }, [isDragging, switcherMode, isBrowseMode]);

  const onPointerUp = useCallback(() => {
    if (!isDragging || isBrowseMode) return;
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
  }, [isDragging, isBrowseMode, dragDelta, cards.length, switcherMode, activeIdx, previewInvoice]);

  const handleCardSelectClick = useCallback((idx: number) => {
    if (suppressClickSelectRef.current) {
      suppressClickSelectRef.current = false;
      return;
    }
    beginInvoiceLoad(idx);
  }, [beginInvoiceLoad]);

  const handleSwitcherModeChange = useCallback(
    (mode: 'horizontal' | 'grid' | 'vertical' | 'list') => {
      if (mode !== 'grid' && mode !== 'list') setFocusZoomed(false);
      setDragDelta(0);
      setIsDragging(false);
      dragAxis.current = 'none';
      onSwitcherModeChange?.(mode);
    },
    [onSwitcherModeChange]
  );

  const textMuted = isLight ? 'text-zinc-400' : 'text-zinc-500';

  const renderInvoiceLoadingOverlay = (idx: number, roundedClass = 'rounded-[32px]') => {
    if (loadingInvoiceIdx !== idx) return null;
    return (
      <div
        className={`invoice-switcher-loading absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/88 backdrop-blur-[2px] ${roundedClass}`}
        aria-live="polite"
        aria-busy="true"
      >
        <span className="auth-spinner invoice-switcher-loading__spinner" aria-hidden="true" />
        <span className="app-subtext text-[10px] font-black uppercase tracking-[0.2em] mt-3 text-black/50">
          Loading
        </span>
      </div>
    );
  };

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
        hidden: true,
      };
    }

    let translateY = '0px';
    let translateX = 0;
    let scale = 1;
    let opacity = 0;
    let blurPx = 0;
    let zIndex = 100;
    let transformOrigin = 'center center';

    if (relativePos === 0) {
      opacity = 1;
      zIndex = 120;
      translateY = `${dragDelta}px`;
    } else if (relativePos === -1) {
      translateX = 6;
      scale = 0.98;
      opacity = 0.9;
      blurPx = 2.5;
      zIndex = 119;
      transformOrigin = 'center bottom';
      translateY = `calc(-65% + ${dragDelta}px)`;
    } else {
      translateX = 6;
      scale = 0.98;
      opacity = 0.9;
      blurPx = 2.5;
      zIndex = 119;
      transformOrigin = 'center top';
      translateY = `calc(65% + ${dragDelta}px)`;
    }

    return {
      translateX: `${translateX}px`,
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

        </div>

        <div className="pointer-events-auto shrink-0">
          {renderCloseButton()}
        </div>
      </div>
    );
  };

  const scatterRotate = (idx: number) => ((idx % 5) - 2) * 1.4;

  const renderSwitcherProductLine = (
    item: CartLineItem,
    index: number,
    options?: { compact?: boolean; inverted?: boolean }
  ) => {
    const name = item.name || `Item ${index + 1}`;
    const priceLabel = formatSwitcherAmount(item.price);
    const lineTotal = item.price * item.quantity;
    const totalLabel = formatSwitcherAmount(lineTotal);
    const totalClass = options?.inverted
      ? 'text-emerald-300'
      : 'invoice-switcher-card__line-total';

    return (
      <div
        key={`${name}-${index}`}
        className={`invoice-switcher-card__line ${options?.compact ? 'invoice-switcher-card__line--compact' : ''}`}
        title={`${name} ${priceLabel} * ${item.quantity} = ${currency}${totalLabel}`}
      >
        <span className="min-w-0 truncate">
          {name}{' '}
          <span className="font-semibold">{priceLabel}</span>
          {' * '}
          {item.quantity}
        </span>
        <span className={`${totalClass} shrink-0 tabular-nums font-semibold`}>
          {currency}{totalLabel}
        </span>
      </div>
    );
  };

  const renderGridTile = (card: InvoiceCard, idx: number) => {
    const isSelected = idx === activeIdx;
    const isPaid = printedNames.has(card.name);
    const isHiddenSelected = focusZoomed && isSelected;

    return (
      <button
        key={card.id}
        type="button"
        onClick={() => beginInvoiceLoad(idx)}
        disabled={loadingInvoiceIdx !== null}
        className={`relative text-left rounded-2xl w-full aspect-[6/13] flex flex-col transition-all duration-300 active:scale-[0.97] border p-3.5 sm:p-4 gap-2 ${
          isSelected && !focusZoomed
            ? 'bg-black text-white border-black shadow-lg ring-2 ring-white/20'
            : isLight
              ? 'bg-white/95 border-black/8 hover:bg-white text-black shadow-sm'
              : 'bg-white/12 border-white/12 hover:bg-white/18 text-white'
        } ${isHiddenSelected ? 'opacity-0 pointer-events-none' : ''} ${focusZoomed && !isHiddenSelected ? 'pointer-events-none' : ''}`}
        style={{
          transform: focusZoomed ? undefined : `rotate(${scatterRotate(idx)}deg)`,
        }}
        aria-hidden={isHiddenSelected}
        tabIndex={isHiddenSelected ? -1 : 0}
      >
        <div className="flex items-start justify-between gap-1">
          <span className={`app-subtext text-[9px] font-black ${isSelected ? 'opacity-70' : 'opacity-45'}`}>
            {card.isCurrent ? 'Current' : isPaid ? 'Paid' : 'Saved'}
          </span>
          <span className={`app-subtext text-[10px] font-black shrink-0 ${isSelected ? 'opacity-80' : 'opacity-55'}`}>
            {card.items.length}
          </span>
        </div>
        <div className="text-[12px] sm:text-[13px] font-black tracking-tight leading-tight line-clamp-2 min-h-[1.6em]">
          {card.name}
        </div>
        <div className={`mt-1 space-y-0.5 min-h-0 flex-1 overflow-hidden ${isSelected ? 'opacity-90' : 'opacity-70'}`}>
          {card.items.length === 0 ? (
            <div className="app-subtext text-[9px] opacity-45">No items yet</div>
          ) : (
            card.items.slice(0, 4).map((item, i) =>
              renderSwitcherProductLine(item, i, { compact: true, inverted: isSelected })
            )
          )}
          {card.items.length > 4 && (
            <div className={`app-subtext text-[8px] ${isSelected ? 'opacity-60' : 'opacity-45'}`}>
              +{card.items.length - 4} more
            </div>
          )}
        </div>
        <div className={`app-subtext text-[11px] font-semibold mt-auto shrink-0 ${isSelected ? 'text-emerald-300' : 'text-emerald-600'}`}>
          Total {currency}{card.total}
        </div>
        {renderInvoiceLoadingOverlay(idx, 'rounded-2xl')}
      </button>
    );
  };

  const renderListRow = (card: InvoiceCard, idx: number) => {
    const isSelected = idx === activeIdx;
    const isPaid = printedNames.has(card.name);

    return (
      <button
        key={card.id}
        type="button"
        onPointerDown={() => startListLongPress(idx)}
        onPointerUp={cancelListLongPress}
        onPointerCancel={cancelListLongPress}
        onClick={() => {
          if (listLongPressFired.current) {
            listLongPressFired.current = false;
            return;
          }
          beginInvoiceLoad(idx);
        }}
        disabled={loadingInvoiceIdx !== null}
        className={`relative w-full text-left rounded-2xl px-4 py-3.5 border flex items-center gap-3 transition-all duration-200 active:scale-[0.99] ${
          isSelected
            ? isLight
              ? 'bg-black text-white border-black shadow-md'
              : 'bg-white text-black border-white shadow-md'
            : isLight
              ? 'bg-white/95 border-black/8 text-black hover:bg-white'
              : 'bg-white/10 border-white/12 text-white hover:bg-white/16'
        } ${focusZoomed ? 'pointer-events-none' : ''}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`app-subtext text-[9px] font-black ${isSelected ? 'opacity-70' : 'opacity-45'}`}>
              {card.isCurrent ? 'Current' : isPaid ? 'Paid' : 'Saved'}
            </span>
            <span className={`app-subtext text-[9px] font-black ${isSelected ? 'opacity-60' : 'opacity-40'}`}>
              {card.items.length} items
            </span>
          </div>
          <div className="text-sm font-black tracking-tight truncate">{card.name}</div>
          {card.items.length > 0 && (
            <div className="mt-1.5 space-y-0.5 max-h-[4.5rem] overflow-hidden">
              {card.items.slice(0, 3).map((item, i) =>
                renderSwitcherProductLine(item, i, { compact: true, inverted: isSelected })
              )}
            </div>
          )}
        </div>
        <div className={`app-subtext text-xs font-semibold shrink-0 ${isSelected ? 'text-emerald-300' : 'text-emerald-600'}`}>
          {currency}{card.total}
        </div>
        {renderInvoiceLoadingOverlay(idx, 'rounded-2xl')}
      </button>
    );
  };

  const renderFocusOverlay = () => {
    if (!focusZoomed || !cards[activeIdx]) return null;

    return (
      <div
        className={`absolute inset-0 z-20 transition-all duration-500 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setFocusZoomed(false)}
        role="presentation"
      >
        <div className="absolute inset-0 bg-black/35 backdrop-blur-md" aria-hidden="true" />

        <div className="relative z-10 flex items-center justify-center h-full p-4 pb-6 sm:pb-4 pt-[4.75rem] sm:pt-20 pointer-events-none">
          <div
            className={`relative ${receiptStageClass} select-none pointer-events-auto transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] cursor-pointer ${
              isOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-[0.88] translate-y-6'
            }`}
            role="dialog"
            aria-modal="true"
            aria-label={`Invoice card: ${cards[activeIdx].name}. Tap to load in calculator.`}
            onClick={(e) => {
              e.stopPropagation();
              beginInvoiceLoad(activeIdx);
            }}
          >
            <div className="absolute inset-0 flex flex-col rounded-[32px] overflow-hidden bg-white text-black shadow-[0_32px_96px_rgba(0,0,0,0.65)] ring-1 ring-white/20">
              {renderCardBody(cards[activeIdx], true)}
              {renderInvoiceLoadingOverlay(activeIdx)}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCardContent = (card: InvoiceCard, isActive: boolean) => {
    const attendant = getAttendantForInvoice(card.name);

    return (
      <div className="invoice-switcher-card__body invoice-receipt-line">
        <div className="invoice-switcher-card__rule" aria-hidden="true" />

        <div
          className="invoice-switcher-card__lines custom-scrollbar"
          style={{ touchAction: 'pan-y' }}
        >
          {card.items.length === 0 ? (
            <div className={`flex-1 flex items-center justify-center ${textMuted} text-[10px] font-black uppercase tracking-[0.28em] opacity-50`}>
              No items yet
            </div>
          ) : (
            card.items.map((item, i) => renderSwitcherProductLine(item, i))
          )}
        </div>

        <div className="invoice-switcher-card__rule" aria-hidden="true" />
        <div className="invoice-switcher-card__total">
          <span className="opacity-50 text-[10px] font-black uppercase tracking-widest">Total</span>
          <span className="invoice-switcher-card__line-total tabular-nums font-semibold">{currency}{card.total}</span>
        </div>

        {isActive && (
          <p className="text-[9px] font-bold opacity-45 truncate">
            Served by &ldquo;{truncateReceiptText(attendant, receiptSpec.maxCols - 13)}&rdquo;
          </p>
        )}

        {isActive && activeReceiptValidation && activeReceiptValidation.warnings.length > 0 && (
          <div className="shrink-0 px-2 py-1.5 rounded-lg bg-amber-50 border border-amber-200/80 text-[8px] leading-snug text-amber-900">
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

    return (
      <div className="invoice-switcher-card__footer" style={{ touchAction: 'auto' }}>
        <div className="invoice-switcher-card__footer-actions">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setAttendantPickerInvoice(card.name);
              setAttendantPickerOpen(true);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 text-left px-3 py-2.5 rounded-xl border border-black/8 bg-white text-xs font-black tracking-tight text-black hover:bg-black/[0.03] active:scale-[0.99] transition-all truncate"
            aria-label="Choose name for print"
          >
            {attendant}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleShareClick(card);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={isSharing || isPrinting || card.items.length === 0}
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center bg-blue-500 text-white shadow-[0_6px_18px_rgba(59,130,246,0.35)] active:scale-90 transition-all disabled:opacity-40"
            aria-label="Share invoice as image"
            title="Share (WhatsApp, etc.)"
          >
            <Icons.Share size={16} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handlePrintClick(card);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={isPrinting || isSharing || !canPrintCard(card)}
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center bg-emerald-500 text-white shadow-[0_6px_18px_rgba(16,185,129,0.35)] active:scale-90 transition-all disabled:opacity-40"
            aria-label="Print invoice name, total, and served by"
            title="Print invoice name, total, and served by"
          >
            <Icons.Printer size={16} />
          </button>
        </div>
      </div>
    );
  };

  const renderCardBody = (card: InvoiceCard, isActive: boolean) => {
    const isPaid = printedNames.has(card.name);
    const rawTitle = card.isCurrent && isActive ? invoiceName : card.name;
    const statusLabel = card.isCurrent ? 'Current' : isPaid ? 'Paid' : 'Open';

    return (
    <>
      <header className="invoice-switcher-card__header relative">
        <div className="invoice-switcher-card__brand-row">
          <span className="invoice-switcher-card__brand" title={invoiceBrandLabel}>
            {invoiceBrandLabel}
          </span>
          <span className={`invoice-switcher-card__badge ${isPaid ? 'invoice-switcher-card__badge--paid' : ''}`}>
            {statusLabel}
          </span>
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
            className="invoice-switcher-card__title w-full min-w-0 bg-transparent outline-none border-b border-transparent focus:border-white/25 transition-colors placeholder:text-white/35 invoice-receipt-line"
          />
        ) : (
          <div
            id={isActive ? 'invoice-title' : undefined}
            className="invoice-switcher-card__title invoice-receipt-line truncate"
            title={card.name}
          >
            {truncateReceiptText(rawTitle, receiptSpec.maxInvoiceTitleChars)}
          </div>
        )}

        <p className="invoice-switcher-card__meta">
          {receiptPaperWidth} · {card.items.length} items · raw sync
        </p>

        {isActive && (!isBrowseMode || focusZoomed) && (
          <div className="absolute top-3 right-3 flex items-center gap-2">
            {isBrowseMode && focusZoomed && (
              <button
                type="button"
                onClick={() => setFocusZoomed(false)}
                aria-label="Back to invoice browse view"
                className="p-2 rounded-full text-white/80 hover:bg-white/10 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
            )}
            {!onSwitcherModeChange && renderCloseButton()}
          </div>
        )}
      </header>

      <div className="invoice-switcher-card flex-1 flex flex-col min-h-0 overflow-hidden relative">
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
              onClick={() => beginInvoiceLoad(i)}
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
        isBrowseMode
          ? ''
          : 'flex items-end sm:items-center justify-center p-4 pb-6 sm:pb-4 pt-[4.75rem] sm:pt-20'
      } ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
    >
      <div
        className={`absolute inset-0 overflow-hidden transition-opacity duration-280 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={() => {
          if (isBrowseMode && focusZoomed) setFocusZoomed(false);
          else handleClose();
        }}
        aria-hidden="true"
      >
        {wallpaperSlides.map((slide, index) => {
          const imageUrl = resolveWallpaperImage(slide.image);
          if (!imageUrl) return null;

          return (
            <div
              key={`${imageUrl}-${index}`}
              className={`absolute inset-[-12%] transition-opacity duration-[2000ms] ease-in-out ${
                index === wallpaperSlide ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <div
                className="wallpaper-layer wallpaper-layer--sharp absolute inset-0 bg-cover bg-center bg-no-repeat"
                style={{ backgroundImage: `url("${imageUrl}")` }}
              />
            </div>
          );
        })}

        <div
          className={`absolute inset-0 transition-colors duration-700 ${
            isLight ? 'bg-white/30' : 'bg-black/40'
          }`}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20" />
      </div>

      {renderSwitcherLayoutToolbar()}

      {switcherMode === 'grid' ? (
        <>
          <div
            className={`absolute inset-0 z-10 flex flex-col transition-all duration-500 ${
              isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            } ${focusZoomed ? 'pointer-events-none' : ''}`}
            role="region"
            aria-label="Invoice scattered grid"
          >
            <div className={`shrink-0 px-5 pt-[4.5rem] pb-3 transition-all duration-500 ${focusZoomed ? 'blur-md opacity-40' : ''}`}>
              <div className="text-sm font-black tracking-tight text-white drop-shadow-sm">
                Invoices
              </div>
            </div>

            <div
              className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 pb-6 sm:px-5 sm:pb-8 transition-all duration-500 ${
                focusZoomed ? 'blur-xl brightness-[0.45] scale-[0.96]' : ''
              }`}
            >
              <div
                className="grid min-h-full content-start"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(${SCATTERED_GRID_MIN_TILE}, 1fr))`,
                  gap: SCATTERED_GRID_GAP,
                }}
              >
                {cards.map((card, idx) => renderGridTile(card, idx))}
              </div>
            </div>
          </div>
          {renderFocusOverlay()}
        </>
      ) : switcherMode === 'list' ? (
        <>
          <div
            className={`absolute inset-0 z-10 flex flex-col transition-all duration-500 ${
              isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            } ${focusZoomed ? 'pointer-events-none' : ''}`}
            role="region"
            aria-label="Invoice list"
          >
            <div className={`shrink-0 px-5 pt-[4.5rem] pb-3 transition-all duration-500 ${focusZoomed ? 'blur-md opacity-40' : ''}`}>
              <div className="text-sm font-black tracking-tight text-white drop-shadow-sm">
                Invoices
              </div>
              <p className="app-subtext text-[10px] text-white/50 mt-1">Tap to load · Hold to preview</p>
            </div>

            <div
              className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 pb-6 sm:px-5 sm:pb-8 transition-all duration-500 ${
                focusZoomed ? 'blur-xl brightness-[0.45] scale-[0.96]' : ''
              }`}
            >
              <div className="flex flex-col gap-2.5 min-h-full">
                {cards.map((card, idx) => renderListRow(card, idx))}
              </div>
            </div>
          </div>
          {renderFocusOverlay()}
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
                className="absolute inset-0 flex flex-col rounded-[32px] overflow-hidden bg-white text-black shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
                style={{
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
                {renderCardBody(card, isActive)}
                {renderInvoiceLoadingOverlay(idx)}
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
                {renderInvoiceLoadingOverlay(idx)}
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