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
import { InvoiceSwitcherProductLine, InvoiceSwitcherTotalRow } from './InvoiceSwitcherLine';
import { storage } from '../hooks/storage';
import { resolveWallpaperImage } from '../utils/wallpapers';
import InvoiceAttendantPicker from './InvoiceAttendantPicker';
import InvoiceReceiptPreview from './InvoiceReceiptPreview';
import BusinessReceiptIdentity from './BusinessReceiptIdentity';
import PrinterConnectModal from './PrinterConnectModal';
import {
  copyInvoiceImageToClipboard,
  sendInvoiceImageToLinkedTelegram,
  type ShareReceiptSettings,
} from '../utils/invoiceShareImage';
import { MORPH_EXIT_MS, MorphPresence, useMorphModeSwap } from './MorphCrossfade';
import FluidSegmentControl from './FluidSegmentControl';

const ATTENDANT_NAMES_KEY = 'invoice_attendant_names';

type SwitcherMode = 'horizontal' | 'list';

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
  switcherMode?: SwitcherMode;
  onSwitcherModeChange?: (mode: SwitcherMode) => void;
  onActiveChange?: (active: boolean) => void;
  wallpapers?: { image: string }[];
  shareReceiptSettings?: ShareReceiptSettings;
  businessName?: string;
  businessPhone?: string;
  businessAddress?: string;
  getSavedInvoices?: () => { name: string; expression: string; isCurrent: boolean }[];
  onRemoveInvoice?: (name: string) => { ok: true } | { ok: false; error: string };
  onUndoRemoveInvoice?: () => { ok: true; name: string } | { ok: false };
  canUndoRemove?: boolean;
}

const SWITCHER_LAYOUT_OPTIONS = [
  { id: 'horizontal' as const, label: 'Horizontal carousel', icon: Icons.Carousel },
  { id: 'list' as const, label: 'List view', icon: Icons.List },
];

const LONG_PRESS_MS = 480;
const INVOICE_LOAD_MS = 400;
/** Match invoice-switcher-enter duration (+ settle buffer for exit unmount). */
const SWITCHER_SHEET_MS = 240;
const SWITCHER_DISPLAY_PAPER_WIDTH: PaperWidth = '58mm';
const INVOICE_SWITCHER_RADIUS = 'rounded-2xl';
const SCATTERED_GRID_MIN_TILE = 'min(100%, 168px)';
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
/** Swipe up on the active card to remove it (undoable). */
const SWIPE_UP_REMOVE_THRESHOLD = 72;

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
  businessPhone = '',
  businessAddress = '',
  getSavedInvoices,
  onRemoveInvoice,
  onUndoRemoveInvoice,
  canUndoRemove = false,
}) => {
  const safeSwitcherMode: SwitcherMode =
    switcherMode === 'list' ? 'list' : 'horizontal';
  const invoiceBrandLabel = '';
  const [attendantNames, setAttendantNames] = useState<Record<string, string>>(() =>
    storage.get(ATTENDANT_NAMES_KEY, {})
  );
  const [attendantPickerOpen, setAttendantPickerOpen] = useState(false);
  const [printerModalOpen, setPrinterModalOpen] = useState(false);
  const [pendingPrintCard, setPendingPrintCard] = useState<InvoiceCard | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [attendantPickerInvoice, setAttendantPickerInvoice] = useState<string | null>(null);
  const [receiptPaperWidth, setReceiptPaperWidth] = useState<PaperWidth>(() => printerInstance.paperWidth);
  const [wallpaperSlide, setWallpaperSlide] = useState(0);
  const wallpaperSlides = wallpapers.length > 0 ? wallpapers : [{ image: '' }];
  const INACTIVITY_STALE_MS = 10 * 60 * 1000;
  const [invoiceActivityAt, setInvoiceActivityAt] = useState<Record<string, number>>({});

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;
  const switcherReceiptSpec = useMemo(
    () => getReceiptSpec(SWITCHER_DISPLAY_PAPER_WIDTH),
    []
  );
  const receiptStageClass = 'invoice-receipt-stage invoice-receipt-stage--58mm';

  const printedNames = useMemo(
    () => new Set(printLogs.map((log) => log.invoiceName)),
    [printLogs]
  );

  useEffect(() => {
    storage.set(ATTENDANT_NAMES_KEY, attendantNames);
  }, [attendantNames]);

  const getAttendantForInvoice = useCallback(
    (name: string) => {
      // Sticky: once stamped for this invoice, never follow a later profile switch.
      if (attendantNames[name]) return attendantNames[name];
      return activeProfile?.name ?? 'Staff';
    },
    [attendantNames, activeProfile]
  );

  const setAttendantForInvoice = useCallback((name: string, attendant: string) => {
    setAttendantNames((prev) => ({ ...prev, [name]: attendant }));
  }, []);

  /** Lock served-by to the creating profile the first time we see this invoice name. */
  const ensureAttendantStamped = useCallback(
    (name: string) => {
      const key = name.trim();
      if (!key) return;
      setAttendantNames((prev) => {
        if (prev[key]) return prev;
        const stamp = activeProfile?.name ?? 'Staff';
        return { ...prev, [key]: stamp };
      });
    },
    [activeProfile?.name]
  );

  useEffect(() => {
    if (!isOpen) return;
    const key = (invoiceName || '').trim();
    if (!key) return;
    setInvoiceActivityAt((prev) => ({ ...prev, [key]: Date.now() }));
    // Write-once stamp under the profile active at first touch.
    ensureAttendantStamped(key);
  }, [isOpen, invoiceName, cartItems, runningTotal, ensureAttendantStamped]);

  const isHeaderStale = useCallback(
    (card: InvoiceCard) => {
      // Only the current invoice may keep blue while fresh; past cards are grey.
      if (!card.isCurrent) return true;
      if (printedNames.has(card.name) || printedNames.has(invoiceName)) return false;
      const key = invoiceName.trim();
      const last = invoiceActivityAt[key] ?? Date.now();
      return Date.now() - last >= INACTIVITY_STALE_MS;
    },
    [INACTIVITY_STALE_MS, invoiceActivityAt, invoiceName, printedNames]
  );

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

      const ok = await printerInstance.printInvoice(
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

  const flashCopyFeedback = useCallback((state: 'copied' | 'failed') => {
    setCopyFeedback(state);
    if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
    copyFeedbackTimerRef.current = setTimeout(() => setCopyFeedback('idle'), 1800);
  }, []);

  useEffect(
    () => () => {
      if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
    },
    []
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
        // Count toward dashboard stats on Print click (paid invoice).
        onInvoicePrinted?.(printCard.name, printCard.total, printCard.items);

        // Always copy receipt image to clipboard on click
        const imagePayload = {
          invoiceName: printCard.name,
          total: printCard.total,
          currency,
          attendantName: getAttendantForInvoice(printCard.name),
          items: printCard.items,
        };
        const copyResult = await copyInvoiceImageToClipboard(imagePayload, shareReceiptSettings);
        flashCopyFeedback(copyResult.ok ? 'copied' : 'failed');
        if (!copyResult.ok) {
          console.warn('[iCalc] clipboard image copy failed', copyResult.error);
        }

        // Always try Telegram sendPhoto when a testing bot is linked (Skip/dev / admin).
        void sendInvoiceImageToLinkedTelegram(imagePayload, shareReceiptSettings).then((tg) => {
          if (!tg.ok) console.warn('[iCalc] Telegram invoice image send failed', tg.error);
        });

        const connected =
          printerInstance.isConnected || (await printerInstance.ensureConnected());
        if (!connected) {
          logReceiptPrint('skipped', {
            context: 'invoice_switcher',
            reason: 'printer_not_connected',
            invoiceName: printCard.name,
            message: 'Image copied; opening printer connect modal.',
          });
          setPendingPrintCard(printCard);
          setPrinterModalOpen(true);
          return;
        }
        setReceiptPaperWidth(printerInstance.paperWidth);
        const result = await executePrint(card);
        if (!result.ok) {
          const detail = result.errors.join(' ');
          // Image may still have been copied — only alert if print failed
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
    [
      canPrintCard,
      currency,
      executePrint,
      flashCopyFeedback,
      getAttendantForInvoice,
      isPrinting,
      onInvoicePrinted,
      resolvePrintCard,
      shareReceiptSettings,
    ]
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
      // Already recorded on Print click; refresh timestamp if user reprints from modal.
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

    const roster =
      getSavedInvoices?.() ??
      [...new Set([invoiceName, ...actionLogs.map((l) => l.invoiceName)])].map((name) => ({
        name,
        expression: '0',
        isCurrent: name === invoiceName,
      }));

    const built: InvoiceCard[] = [];
    for (const inv of roster) {
      if (inv.name === invoiceName) continue;
      const logs = grouped.get(inv.name) ?? [];
      const items =
        logs.length > 0
          ? logs.map((l) => ({ price: l.price, quantity: l.quantity, name: l.itemName }))
          : [];
      const total =
        logs.length > 0
          ? logs.reduce((s, l) => s + l.price * l.quantity, 0).toFixed(2)
          : '0.00';
      built.push({
        id: `past-${inv.name}`,
        name: inv.name,
        items,
        logs,
        total,
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
  }, [actionLogs, cartItems, invoiceName, runningTotal, getSavedInvoices]);

  const [activeIdx, setActiveIdx] = useState(0);
  const [loadingInvoiceIdx, setLoadingInvoiceIdx] = useState<number | null>(null);
  const [focusZoomed, setFocusZoomed] = useState(false);
  const invoiceLoadTimerRef = useRef<number | null>(null);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const listLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listLongPressFired = useRef(false);
  const listLongPressIdx = useRef<number | null>(null);

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
  /** Drives sheet enter after first paint at the "below" pose. */
  const [sheetIn, setSheetIn] = useState(false);
  /** True after a full enter so close can run the exit animation. */
  const [sheetExiting, setSheetExiting] = useState(false);
  const prevCardCountRef = useRef(cards.length);
  const { renderMode, contentIn } = useMorphModeSwap(safeSwitcherMode);
  const isBrowseMode = renderMode === 'list';

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
      // Start at static "out" pose, then insight-pop enter.
      setSheetExiting(false);
      setSheetIn(false);
      setActiveIdx(Math.max(0, cards.length - 1));
      setFocusZoomed(false);
      setLoadingInvoiceIdx(null);
      clearInvoiceLoadTimer();
      lastFocusedRef.current = document.activeElement as HTMLElement | null;

      let raf1 = 0;
      let raf2 = 0;
      let focusId = 0;
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          setSheetIn(true);
          focusId = requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
        });
      });

      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
        cancelAnimationFrame(focusId);
      };
    }

    // Close: play exit, then unmount
    setSheetIn(false);
    setSheetExiting(true);

    const root = rootRef.current;
    const active = document.activeElement as HTMLElement | null;
    if (root?.contains(active)) {
      active.blur();
    }
    lastFocusedRef.current?.focus?.({ preventScroll: true });

    clearInvoiceLoadTimer();
    setLoadingInvoiceIdx(null);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setSheetExiting(false);
    }, SWITCHER_SHEET_MS + 40);
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
      if (renderMode === 'horizontal') {
        if (e.key === 'ArrowRight') previewInvoice(Math.min(activeIdx + 1, cards.length - 1));
        if (e.key === 'ArrowLeft') previewInvoice(Math.max(activeIdx - 1, 0));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose, cards.length, renderMode, activeIdx, previewInvoice, focusZoomed, isBrowseMode]);

  const dragRafRef = useRef<number | null>(null);
  const pendingDeltaRef = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (isBrowseMode) return;
    if ((e.target as HTMLElement).closest('input, button, textarea')) return;
    dragStartX.current = e.clientX;
    dragStartY.current = e.clientY;
    dragAxis.current = 'none';
    suppressClickSelectRef.current = false;
    pendingDeltaRef.current = 0;
    setIsDragging(true);
    setDragDelta(0);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [isBrowseMode]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || isBrowseMode) return;
    const dx = e.clientX - dragStartX.current;
    const dy = e.clientY - dragStartY.current;
    if (dragAxis.current === 'none' && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      dragAxis.current = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    }
    if (dragAxis.current === 'x') {
      pendingDeltaRef.current = dx * DRAG_FACTOR;
    } else if (dragAxis.current === 'y') {
      // Only allow upward dismiss gesture
      pendingDeltaRef.current = Math.min(0, dy);
    } else {
      return;
    }
    if (dragRafRef.current !== null) return;
    dragRafRef.current = window.requestAnimationFrame(() => {
      dragRafRef.current = null;
      setDragDelta(pendingDeltaRef.current);
    });
  }, [isDragging, isBrowseMode]);

  const onPointerUp = useCallback(() => {
    if (!isDragging || isBrowseMode) return;
    if (dragRafRef.current !== null) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    setIsDragging(false);
    const delta = pendingDeltaRef.current;
    if (dragAxis.current === 'x') {
      const absDelta = Math.abs(delta);
      let nextIdx = activeIdx;
      if (delta < -SWIPE_THRESHOLD) {
        nextIdx = Math.min(activeIdx + 1, cards.length - 1);
      } else if (delta > SWIPE_THRESHOLD) {
        nextIdx = Math.max(activeIdx - 1, 0);
      }
      if (nextIdx !== activeIdx) {
        previewInvoice(nextIdx);
        suppressClickSelectRef.current = true;
      } else if (absDelta >= SWIPE_THRESHOLD) {
        suppressClickSelectRef.current = true;
      }
    } else if (dragAxis.current === 'y' && delta <= -SWIPE_UP_REMOVE_THRESHOLD && onRemoveInvoice) {
      const card = cardsRef.current[activeIdx];
      if (card) {
        const result = onRemoveInvoice(card.name);
        if (result.ok) {
          suppressClickSelectRef.current = true;
          setActiveIdx((idx) => Math.max(0, Math.min(idx, cardsRef.current.length - 2)));
        }
      }
    }
    dragAxis.current = 'none';
    pendingDeltaRef.current = 0;
    setDragDelta(0);
  }, [isDragging, isBrowseMode, cards.length, activeIdx, previewInvoice, onRemoveInvoice]);

  const handleCardSelectClick = useCallback((idx: number) => {
    if (suppressClickSelectRef.current) {
      suppressClickSelectRef.current = false;
      return;
    }
    beginInvoiceLoad(idx);
  }, [beginInvoiceLoad]);

  const handleSwitcherModeChange = useCallback(
    (mode: SwitcherMode) => {
      if (mode !== 'list') setFocusZoomed(false);
      setDragDelta(0);
      setIsDragging(false);
      dragAxis.current = 'none';
      onSwitcherModeChange?.(mode);
    },
    [onSwitcherModeChange]
  );

  const textMuted = isLight ? 'text-zinc-400' : 'text-zinc-500';

  const renderInvoiceLoadingOverlay = (idx: number, roundedClass = INVOICE_SWITCHER_RADIUS) => (
    <MorphPresence show={loadingInvoiceIdx === idx} exitMs={220}>
      {(visible) => (
        <div
          className={`invoice-switcher-loading absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/88 backdrop-blur-[2px] morph-scrim ${
            visible ? 'morph-scrim--in' : 'morph-scrim--out'
          } ${roundedClass}`}
          aria-live="polite"
          aria-busy="true"
        >
          <span className="auth-spinner invoice-switcher-loading__spinner" aria-hidden="true" />
          <span className="app-subtext text-[10px] font-black uppercase mt-3 text-black/50">
            Loading
          </span>
        </div>
      )}
    </MorphPresence>
  );

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
    const verticalDismiss = dragAxis.current === 'y';
    let translateXValue = verticalDismiss ? '0px' : `${dragDelta}px`;
    const neighborBlur = isDragging ? 0 : 2.5;

    if (relativePos === 0) {
      opacity = 1;
      zIndex = 120;
      if (verticalDismiss) {
        translateY = dragDelta;
        opacity = Math.max(0.2, 1 + dragDelta / 160);
        scale = Math.max(0.92, 1 + dragDelta / 400);
      }
    } else if (relativePos === -1) {
      translateY = 6;
      scale = 0.98;
      opacity = isDragging ? 0.7 : 0.9;
      blurPx = neighborBlur;
      zIndex = 119;
      transformOrigin = 'right center';
      translateXValue = verticalDismiss ? '-65%' : `calc(-65% + ${dragDelta}px)`;
    } else {
      translateY = 6;
      scale = 0.98;
      opacity = isDragging ? 0.7 : 0.9;
      blurPx = neighborBlur;
      zIndex = 119;
      transformOrigin = 'left center';
      translateXValue = verticalDismiss ? '65%' : `calc(65% + ${dragDelta}px)`;
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
    <div className="flex items-center gap-2 shrink-0 pointer-events-auto">
      {canUndoRemove && onUndoRemoveInvoice ? (
        <button
          type="button"
          onClick={() => {
            const result = onUndoRemoveInvoice();
            if (result.ok) {
              // Focus restored invoice after roster rebuild
              window.setTimeout(() => {
                const idx = cardsRef.current.findIndex((c) => c.name === result.name);
                if (idx >= 0) setActiveIdx(idx);
              }, 0);
            }
          }}
          aria-label="Undo remove invoice"
          className={`h-11 px-3 rounded-full flex items-center justify-center gap-1.5 transition-all active:scale-90 border text-[10px] font-black uppercase ${
            isLight
              ? 'bg-white/70 backdrop-blur-xl text-black border-black/10 hover:bg-white/90'
              : 'bg-white/10 backdrop-blur-xl text-white border-white/15 hover:bg-white/20'
          }`}
        >
          Undo
        </button>
      ) : null}
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
    </div>
  );

  const renderSwitcherLayoutToolbar = () => {
    if (!mounted || !onSwitcherModeChange) return null;

    return (
      <div
        className={`absolute top-0 left-0 right-0 z-30 pt-5 px-4 sm:px-5 flex items-center justify-between gap-3 pointer-events-none invoice-switcher-toolbar ${
          sheetIn ? 'invoice-switcher-toolbar--in' : 'invoice-switcher-toolbar--out'
        }`}
        role="toolbar"
        aria-label="Invoice switcher layout"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-11 shrink-0" aria-hidden="true" />

        <div className={`${sheetIn ? 'pointer-events-auto' : 'pointer-events-none'}`}>
          <FluidSegmentControl
            isLight={isLight}
            size="sm"
            variant="slide"
            ariaLabel="Invoice switcher layout"
            value={safeSwitcherMode}
            onChange={(id) => handleSwitcherModeChange(id as SwitcherMode)}
            options={SWITCHER_LAYOUT_OPTIONS.map(({ id, label, icon: Icon }) => ({
              id,
              label: label.split(' ')[0] ?? label,
              icon: <Icon size={14} />,
            }))}
          />
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
    options?: { compact?: boolean }
  ) => (
    <InvoiceSwitcherProductLine
      key={`${item.name || 'item'}-${index}`}
      item={item}
      index={index}
      currency={currency}
      compact={options?.compact}
    />
  );

  const getReceiptStatus = (card: InvoiceCard): 'Current' | 'Paid' | 'Open' | 'Saved' => {
    if (card.isCurrent) return 'Current';
    if (printedNames.has(card.name)) return 'Paid';
    return 'Saved';
  };

  const renderGridTile = (card: InvoiceCard, idx: number) => {
    const isSelected = idx === activeIdx;
    const isHiddenSelected = focusZoomed && isSelected;

    return (
      <button
        key={card.id}
        type="button"
        onClick={() => beginInvoiceLoad(idx)}
        disabled={loadingInvoiceIdx !== null}
        className={`relative text-left rounded-2xl flex flex-col transition-all duration-300 active:scale-[0.97] ${
          isSelected && !focusZoomed
            ? 'invoice-grid-tile--58mm p-0 border-0 bg-transparent shadow-lg ring-2 ring-blue-400/35 overflow-hidden'
            : `w-full aspect-[6/13] border p-3.5 sm:p-4 gap-2 ${
                isLight
                  ? 'bg-white/95 border-black/8 hover:bg-white text-black shadow-sm'
                  : 'bg-white/12 border-white/12 hover:bg-white/18 text-white'
              }`
        } ${isHiddenSelected ? 'opacity-0 pointer-events-none' : ''} ${focusZoomed && !isHiddenSelected ? 'pointer-events-none' : ''}`}
        style={{
          transform: focusZoomed ? undefined : `rotate(${scatterRotate(idx)}deg)`,
        }}
        aria-hidden={isHiddenSelected}
        tabIndex={isHiddenSelected ? -1 : 0}
      >
        {isSelected && !focusZoomed ? (
          <InvoiceReceiptPreview
            brandLabel={invoiceBrandLabel}
            businessName={businessName}
            businessPhone={businessPhone}
            businessAddress={businessAddress}
            title={card.name}
            status={getReceiptStatus(card)}
            items={card.items}
            total={card.total}
            currency={currency}
            variant="tile"
            maxItemLines={4}
            meta={`58mm · ${card.items.length} items`}
          />
        ) : (
          <>
            <div className="flex items-start justify-between gap-1">
              <span className="app-subtext text-[9px] font-black opacity-45">
                {card.isCurrent ? 'Current' : printedNames.has(card.name) ? 'Paid' : 'Saved'}
              </span>
              <span className="app-subtext text-[10px] font-black shrink-0 opacity-55">
                {card.items.length}
              </span>
            </div>
            <div className="text-[12px] sm:text-[13px] font-black leading-tight line-clamp-2 min-h-[1.6em]">
              {card.name}
            </div>
            <div className="mt-1 space-y-0.5 min-h-0 flex-1 overflow-hidden opacity-70">
              {card.items.length === 0 ? (
                <div className="app-subtext text-[10px] opacity-45">No items yet</div>
              ) : (
                card.items.slice(0, 4).map((item, i) =>
                  renderSwitcherProductLine(item, i, { compact: true })
                )
              )}
              {card.items.length > 4 && (
                <div className="app-subtext text-[8px] opacity-45">
                  +{card.items.length - 4} more
                </div>
              )}
            </div>
            <div className="app-subtext text-[11px] font-semibold mt-auto shrink-0 text-emerald-600">
              Total {currency}{card.total}
            </div>
          </>
        )}
        {renderInvoiceLoadingOverlay(idx, 'rounded-2xl')}
      </button>
    );
  };

  const renderListRow = (card: InvoiceCard, idx: number) => {
    const isSelected = idx === activeIdx;

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
        className={`relative w-full text-left rounded-2xl transition-all duration-200 active:scale-[0.99] ${
          isSelected
            ? 'p-0 border-0 bg-transparent shadow-md ring-2 ring-blue-400/35 overflow-hidden'
            : `px-4 py-3.5 border flex items-center gap-3 ${
                isLight
                  ? 'bg-white/95 border-black/8 text-black hover:bg-white'
                  : 'bg-white/10 border-white/12 text-white hover:bg-white/16'
              }`
        } ${focusZoomed ? 'pointer-events-none' : ''}`}
      >
        {isSelected ? (
          <InvoiceReceiptPreview
            brandLabel={invoiceBrandLabel}
            businessName={businessName}
            businessPhone={businessPhone}
            businessAddress={businessAddress}
            title={card.name}
            status={getReceiptStatus(card)}
            items={card.items}
            total={card.total}
            currency={currency}
            variant="list"
            maxItemLines={3}
            meta={`58mm · ${card.items.length} items`}
          />
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="app-subtext text-[9px] font-black opacity-45">
                  {card.isCurrent ? 'Current' : printedNames.has(card.name) ? 'Paid' : 'Saved'}
                </span>
                <span className="app-subtext text-[9px] font-black opacity-40">
                  {card.items.length} items
                </span>
              </div>
              <div className="text-sm font-black truncate">{card.name}</div>
              {card.items.length > 0 && (
                <div className="mt-1.5 space-y-0.5 max-h-[4.5rem] overflow-hidden">
                  {card.items.slice(0, 3).map((item, i) =>
                    renderSwitcherProductLine(item, i, { compact: true })
                  )}
                </div>
              )}
            </div>
            <div className="app-subtext text-xs font-semibold shrink-0 text-emerald-600">
              {currency}{card.total}
            </div>
          </>
        )}
        {renderInvoiceLoadingOverlay(idx, 'rounded-2xl')}
      </button>
    );
  };

  const renderFocusOverlay = () => {
    if (!cards[activeIdx]) return null;

    return (
      <MorphPresence show={focusZoomed && isOpen} exitMs={MORPH_EXIT_MS}>
        {(visible) => (
          <div
            className={`absolute inset-0 z-20 ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`}
            onClick={() => setFocusZoomed(false)}
            role="presentation"
          >
            <div
              className={`absolute inset-0 bg-black/35 backdrop-blur-md morph-scrim ${
                visible ? 'morph-scrim--in' : 'morph-scrim--out'
              }`}
              aria-hidden="true"
            />

            <div className="relative z-10 flex items-center justify-center h-full p-4 pb-6 sm:pb-4 pt-[4.75rem] sm:pt-20 pointer-events-none">
              <div
                className={`relative ${receiptStageClass} select-none pointer-events-auto cursor-pointer morph-panel ${
                  visible ? 'morph-panel--in' : 'morph-panel--out'
                }`}
                role="dialog"
                aria-modal="true"
                aria-label={`Invoice card: ${cards[activeIdx].name}. Tap to load in calculator.`}
                onClick={(e) => {
                  e.stopPropagation();
                  beginInvoiceLoad(activeIdx);
                }}
              >
                <div
                  className={`absolute inset-0 flex flex-col ${INVOICE_SWITCHER_RADIUS} overflow-hidden bg-white text-black shadow-[0_32px_96px_rgba(0,0,0,0.65)] ring-1 ring-white/20`}
                >
                  {renderCardBody(cards[activeIdx], true)}
                  {renderInvoiceLoadingOverlay(activeIdx)}
                </div>
              </div>
            </div>
          </div>
        )}
      </MorphPresence>
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
            <div className={`flex-1 flex items-center justify-center ${textMuted} text-[10px] font-black uppercase opacity-50`}>
              No items yet
            </div>
          ) : (
            card.items.map((item, i) => renderSwitcherProductLine(item, i))
          )}
        </div>

        <div className="invoice-switcher-card__rule" aria-hidden="true" />
        <InvoiceSwitcherTotalRow total={card.total} currency={currency} />

        {isActive && (
          <p className="invoice-switcher-card__served-by truncate">
            Served by &ldquo;{truncateReceiptText(attendant, switcherReceiptSpec.maxCols - 13)}&rdquo;
          </p>
        )}

        {isActive && (
          <p className="invoice-switcher-card__thanks">Thank you for your purchase</p>
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
      <div className="invoice-switcher-card__footer invoice-switcher-card__footer--actions" style={{ touchAction: 'auto' }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAttendantPickerInvoice(card.name);
            setAttendantPickerOpen(true);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="invoice-switcher-card__attendant-btn"
          aria-label="Choose name for print"
        >
          @{attendant}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handlePrintClick(card);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={isPrinting || !canPrintCard(card)}
          className={`invoice-switcher-card__print-btn ${
            copyFeedback === 'copied'
              ? 'invoice-switcher-card__print-btn--copied'
              : copyFeedback === 'failed'
                ? 'invoice-switcher-card__print-btn--failed'
                : ''
          }`}
          aria-label="Print invoice and copy image"
          title="Copies receipt image to clipboard, then prints"
        >
          <Icons.Printer size={16} />
          <span>
            {copyFeedback === 'copied'
              ? 'Copied'
              : copyFeedback === 'failed'
                ? 'Copy failed'
                : isPrinting
                  ? 'Printing…'
                  : 'Print'}
          </span>
        </button>
      </div>
    );
  };

  const renderCardBody = (card: InvoiceCard, isActive: boolean) => {
    const isPaid = printedNames.has(card.name);
    const rawTitle = card.isCurrent && isActive ? invoiceName : card.name;
    const statusLabel = card.isCurrent ? 'Current' : isPaid ? 'Paid' : 'Open';
    const headerStale = isHeaderStale(card);

    return (
    <div className="invoice-switcher-shell flex flex-col h-full min-h-0">
      <div className="invoice-switcher-shell__row flex flex-1 min-h-0">
        <div className="invoice-switcher-printable invoice-switcher-printable--full flex flex-col min-h-0 min-w-0 flex-1">
          <header
            className={`invoice-switcher-card__header relative${
              headerStale ? ' invoice-switcher-card__header--stale' : ''
            }`}
          >
            <div className="invoice-switcher-card__brand-row invoice-switcher-card__brand-row--badge-only">
              <span aria-hidden="true" />
              <span className={`invoice-switcher-card__badge ${isPaid ? 'invoice-switcher-card__badge--paid' : ''}`}>
                {statusLabel}
              </span>
            </div>

            <BusinessReceiptIdentity
              businessName={businessName}
              businessPhone={businessPhone}
              businessAddress={businessAddress}
            />

            {card.isCurrent && isActive ? (
              <input
                id="invoice-title"
                type="text"
                value={invoiceName}
                onChange={(e) => {
                  const next = e.target.value;
                  const prev = invoiceName;
                  onInvoiceNameChange(next);
                  // Rename Invoice #N → Helen: notify Telegram + keep served-by on original profile
                  const wasGeneric = /^invoice\s*#\d+/i.test(prev.trim());
                  const nowNamed = next.trim().length > 0 && !/^invoice\s*#\d+/i.test(next.trim());
                  if (wasGeneric && nowNamed) {
                    ensureAttendantStamped(next.trim());
                    const profile = getAttendantForInvoice(prev) || activeProfile?.name || 'Staff';
                    const msg = `${profile} created new invoice for ${next.trim()}.`;
                    void import('../utils/telegramDb').then(({ sendTelegramTextNotify }) => {
                      void sendTelegramTextNotify({ text: msg });
                    });
                  } else {
                    ensureAttendantStamped(next.trim() || prev);
                  }
                }}
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
                {truncateReceiptText(rawTitle, switcherReceiptSpec.maxInvoiceTitleChars)}
              </div>
            )}

            <p className="invoice-switcher-card__meta">
              58mm · {card.items.length} items
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
          </div>
        </div>

      </div>

      {renderCardFooter(card, isActive)}

      {isActive && renderMode === 'horizontal' && cards.length > 1 && (
        <div
          className="invoice-switcher-shell__dots"
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
    </div>
    );
  };

  const modeContentClass = `morph-panel-content ${
    sheetIn && contentIn ? 'morph-panel-content--in' : 'morph-panel-content--out'
  }`;
  const sheetPose = sheetIn
    ? 'invoice-switcher-sheet--in'
    : sheetExiting
      ? 'invoice-switcher-sheet--out invoice-switcher-sheet--exiting'
      : 'invoice-switcher-sheet--out';
  const sheetClass = `invoice-switcher-sheet ${sheetPose}`;
  const browseSheetClass = `invoice-switcher-sheet invoice-switcher-sheet--browse ${sheetPose}`;

  return (
    <div
      ref={rootRef}
      inert={!isOpen ? true : undefined}
      className={`fixed inset-0 z-120 ${
        isBrowseMode
          ? ''
          : 'flex items-end sm:items-center justify-center p-4 pb-6 sm:pb-4 pt-[4.75rem] sm:pt-20'
      } ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
    >
      <div
        className={`absolute inset-0 overflow-hidden invoice-switcher-scrim ${
          sheetIn ? 'invoice-switcher-scrim--in' : 'invoice-switcher-scrim--out'
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

      {renderMode === 'list' ? (
        <>
          <div
            className={`absolute inset-0 z-10 flex flex-col ${browseSheetClass} ${
              focusZoomed ? 'pointer-events-none' : ''
            }`}
            role="region"
            aria-label="Invoice list"
          >
            <div className={`${modeContentClass} flex flex-col flex-1 min-h-0`}>
              <div
                className={`shrink-0 px-5 pt-[4.5rem] pb-3 transition-[filter,opacity] duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  focusZoomed ? 'blur-md opacity-40' : ''
                }`}
              >
                <div className="text-sm font-black text-white drop-shadow-sm">
                  Invoices
                </div>
                <p className="app-subtext text-[10px] opacity-45 text-white/50 mt-1">
                  Tap to load · Hold to preview
                </p>
              </div>

              <div
                className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 pb-6 sm:px-5 sm:pb-8 transition-[filter,opacity,transform] duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  focusZoomed ? 'blur-xl brightness-[0.45] scale-[0.96]' : ''
                }`}
              >
                <div className="flex flex-col gap-2.5 min-h-full">
                  {cards.map((card, idx) => renderListRow(card, idx))}
                </div>
              </div>
            </div>
          </div>
          {renderFocusOverlay()}
        </>
      ) : (
        <div
          ref={stageRef}
          className={`relative z-20 ${receiptStageClass} select-none overflow-visible ${sheetClass}`}
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="Invoice switcher. Swipe sideways to browse, swipe up to remove."
          role="region"
        >
          <div className={`absolute inset-0 ${modeContentClass}`}>
            {cards.map((card, idx) => {
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
                  } = getCardStyle(idx);

                  if (hidden) return null;

                  return (
                    <div
                      key={card.id}
                      aria-label={`Invoice card: ${card.name}`}
                      inert={!isActive || !isOpen ? true : undefined}
                      role={isActive ? 'dialog' : undefined}
                      aria-modal={isActive ? true : undefined}
                      className={`absolute inset-0 flex flex-col ${INVOICE_SWITCHER_RADIUS} overflow-hidden bg-white text-black shadow-[0_24px_80px_rgba(0,0,0,0.55)]`}
                      style={{
                        transform: `translateX(${translateX}) translateY(${translateY}) scale(${scale})`,
                        transformOrigin,
                        opacity,
                        zIndex,
                        filter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
                        transition: isDragging
                          ? 'none'
                          : 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1), filter 0.18s cubic-bezier(0.22, 1, 0.36, 1)',
                        willChange: isDragging ? 'transform, opacity' : undefined,
                        pointerEvents: 'auto',
                        cursor: isActive ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
                      }}
                      onClick={() => handleCardSelectClick(idx)}
                    >
                      {renderCardBody(card, isActive)}
                      {renderInvoiceLoadingOverlay(idx)}
                    </div>
                  );
                })}
          </div>
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