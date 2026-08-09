import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '../constants';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { CartLineItem } from '../types';
import { printerInstance } from '../utils/bluetoothPrinter';
import InvoiceReceiptPreview from './InvoiceReceiptPreview';
import PrinterConnectModal from './PrinterConnectModal';
import { AppLoadingSpinner } from './AppLoading';
import {
  buildInvoiceDayList,
  dayKeyFromTs,
  endOfDayTs,
  formatDayButtonLabel,
  msUntilNextFourAm,
  runVisionHubStashIfDue,
  startOfDayTs,
} from '../utils/visionHubStash';

export interface HubInvoice {
  id: string;
  name: string;
  items: CartLineItem[];
  total: string;
  isCurrent: boolean;
  isPaid?: boolean;
  /** Latest activity timestamp for date filtering / archive. */
  latestTimestamp?: number;
}

export interface HubNotepadJob {
  id: string;
  title: string;
  body: string;
}

/** @deprecated Vision Hub is click-only; kept for call-site compat. */
export type VisionHubDrawerMode = 'click';

interface VisionHubPrintPanelProps {
  isLight: boolean;
  invertedBarSubtextClass: string;
  currentTimeLabel: string;
  currency: string;
  formatCurrency: (val: string) => string;
  accentColor: string;
  invoices: HubInvoice[];
  attendantName: string;
  /** Ignored — drawer is click-only. */
  drawerMode?: VisionHubDrawerMode | 'drag';
  printDrawerEnabled?: boolean;
  queuedNotepad?: HubNotepadJob | null;
  onQueuedNotepadConsumed?: () => void;
  onInvoicePrinted?: (invoiceName: string, total: string, items: CartLineItem[]) => void;
  onInteractionChange?: (active: boolean) => void;
  onThemeToggle: () => void;
  onSettingsOpen: () => void;
  onCloseDashboard: () => void;
  /** Leave POS and open calculator on a fresh invoice. */
  onNewInvoice?: () => void;
  /**
   * Registers a hierarchical back handler for left-edge swipe / Escape.
   * Return true if the gesture was consumed (date picker, focus, or drawer).
   */
  onBindBackHandler?: (handler: (() => boolean) | null) => void;
  isThemeAnimating: boolean;
  isSettingsAnimating: boolean;
  isCloseAnimating: boolean;
  onThemeAnimationEnd: () => void;
  onSettingsAnimationEnd: () => void;
  onCloseAnimationEnd: () => void;
  businessName?: string;
  businessPhone?: string;
  businessAddress?: string;
}

const RECONNECT_PROMPT_MS = 4200;
const DRAWER_HEIGHT = 380;

const VisionHubPrintPanel: React.FC<VisionHubPrintPanelProps> = ({
  isLight,
  invertedBarSubtextClass,
  currentTimeLabel,
  currency,
  formatCurrency,
  accentColor,
  invoices,
  attendantName,
  drawerMode: _drawerMode,
  printDrawerEnabled = true,
  queuedNotepad = null,
  onQueuedNotepadConsumed,
  onInvoicePrinted,
  onInteractionChange,
  onThemeToggle,
  onSettingsOpen,
  onCloseDashboard,
  onNewInvoice,
  onBindBackHandler,
  isThemeAnimating,
  isSettingsAnimating,
  isCloseAnimating,
  onThemeAnimationEnd,
  onSettingsAnimationEnd,
  onCloseAnimationEnd,
  businessName = '',
  businessPhone = '',
  businessAddress = '',
}) => {
  const invoiceBrandLabel = 'iCalc POS';
  const [expanded, setExpanded] = useState(false);
  const [printerModalOpen, setPrinterModalOpen] = useState(false);
  const [pendingPrint, setPendingPrint] = useState<HubInvoice | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printFlash, setPrintFlash] = useState<string | null>(null);
  const [focusedInvoiceId, setFocusedInvoiceId] = useState<string | null>(null);
  const [printerConnected, setPrinterConnected] = useState(() => printerInstance.isConnected);
  const [reconnectPrompt, setReconnectPrompt] = useState(false);
  const [printSuccess, setPrintSuccess] = useState(false);
  /** Live drawer hides invoices before this (4am auto-stash). */
  const [stashCutoff, setStashCutoff] = useState(() => runVisionHubStashIfDue());
  /** Selected day start (ms); null = live list (after last stash). */
  const [selectedDayStart, setSelectedDayStart] = useState<number | null>(null);
  const [dateDrawerOpen, setDateDrawerOpen] = useState(false);
  const [isNewAnimating, setIsNewAnimating] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const printSuccessTimerRef = useRef<number | null>(null);
  const stashTimerRef = useRef<number | null>(null);
  const newInvoicePendingRef = useRef(false);
  const newAnimTimerRef = useRef<number | null>(null);

  const finishNewInvoiceAnim = useCallback(() => {
    if (newAnimTimerRef.current != null) {
      window.clearTimeout(newAnimTimerRef.current);
      newAnimTimerRef.current = null;
    }
    setIsNewAnimating(false);
    if (!newInvoicePendingRef.current) return;
    newInvoicePendingRef.current = false;
    onNewInvoice?.();
  }, [onNewInvoice]);

  useEffect(() => {
    return () => {
      if (newAnimTimerRef.current != null) {
        window.clearTimeout(newAnimTimerRef.current);
      }
    };
  }, []);

  void _drawerMode;

  const hubActive = printDrawerEnabled && (expanded || focusedInvoiceId !== null);
  /** Active drawer always paints white (even if app theme is dark). */
  const drawerLight = expanded;

  useEffect(() => {
    onInteractionChange?.(hubActive);
  }, [hubActive, onInteractionChange]);

  useEffect(() => {
    const syncConnection = () => setPrinterConnected(printerInstance.isConnected);
    syncConnection();
    printerInstance.setConnectionChangeListener(syncConnection);
    return () => printerInstance.removeConnectionChangeListener(syncConnection);
  }, []);

  useEffect(() => {
    if (!expanded) {
      setFocusedInvoiceId(null);
      setDateDrawerOpen(false);
    }
  }, [expanded]);

  // Auto-stash invoice list every day at 4:00 AM
  useEffect(() => {
    const apply = () => {
      const next = runVisionHubStashIfDue();
      setStashCutoff(next);
      setSelectedDayStart(null);
      setFocusedInvoiceId(null);
    };
    apply();

    const schedule = () => {
      if (stashTimerRef.current !== null) window.clearTimeout(stashTimerRef.current);
      stashTimerRef.current = window.setTimeout(() => {
        apply();
        schedule();
      }, msUntilNextFourAm());
    };
    schedule();
    return () => {
      if (stashTimerRef.current !== null) window.clearTimeout(stashTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (printerConnected) setReconnectPrompt(false);
  }, [printerConnected]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (printSuccessTimerRef.current !== null) {
        window.clearTimeout(printSuccessTimerRef.current);
      }
    };
  }, []);

  const showPrintSuccess = useCallback(() => {
    setPrintSuccess(true);
    if (printSuccessTimerRef.current !== null) {
      window.clearTimeout(printSuccessTimerRef.current);
    }
    printSuccessTimerRef.current = window.setTimeout(() => {
      setPrintSuccess(false);
      printSuccessTimerRef.current = null;
    }, 2600);
  }, []);

  const showReconnectPrompt = useCallback(() => {
    setReconnectPrompt(true);
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
    }
    reconnectTimerRef.current = window.setTimeout(() => {
      setReconnectPrompt(false);
      reconnectTimerRef.current = null;
    }, RECONNECT_PROMPT_MS);
  }, []);

  const collapseDrawer = useCallback(() => {
    setExpanded(false);
    setFocusedInvoiceId(null);
    setDateDrawerOpen(false);
  }, []);

  const openDrawer = useCallback(() => {
    if (!printDrawerEnabled) return;
    setExpanded(true);
    setSelectedDayStart(null);
  }, [printDrawerEnabled]);

  /** Date picker → invoice focus → close drawer. Returns true if handled. */
  const tryBack = useCallback(() => {
    if (dateDrawerOpen) {
      setDateDrawerOpen(false);
      return true;
    }
    if (focusedInvoiceId) {
      setFocusedInvoiceId(null);
      return true;
    }
    if (expanded) {
      collapseDrawer();
      return true;
    }
    return false;
  }, [dateDrawerOpen, focusedInvoiceId, expanded, collapseDrawer]);

  useEffect(() => {
    if (!onBindBackHandler) return;
    onBindBackHandler(tryBack);
    return () => onBindBackHandler(null);
  }, [onBindBackHandler, tryBack]);

  const firstInvoiceTs = useMemo(() => {
    let min = 0;
    for (const inv of invoices) {
      const t = inv.latestTimestamp ?? 0;
      if (t > 0 && (min === 0 || t < min)) min = t;
    }
    return min;
  }, [invoices]);

  const dateList = useMemo(
    () => buildInvoiceDayList(firstInvoiceTs || Date.now()),
    [firstInvoiceTs]
  );

  const visibleInvoices = useMemo(() => {
    if (selectedDayStart != null) {
      const start = startOfDayTs(selectedDayStart);
      const end = endOfDayTs(selectedDayStart);
      return invoices.filter((inv) => {
        if (inv.isCurrent && selectedDayStart === startOfDayTs(Date.now())) return true;
        const t = inv.latestTimestamp ?? 0;
        return t >= start && t <= end;
      });
    }
    // Live list: after last 4am stash (current invoice always stays)
    return invoices.filter((inv) => {
      if (inv.isCurrent) return true;
      const t = inv.latestTimestamp ?? 0;
      return t >= stashCutoff;
    });
  }, [invoices, selectedDayStart, stashCutoff]);

  const dateButtonLabel = formatDayButtonLabel(
    selectedDayStart ?? startOfDayTs(Date.now())
  );

  useEffect(() => {
    if (!printDrawerEnabled && expanded) {
      collapseDrawer();
    }
  }, [printDrawerEnabled, expanded, collapseDrawer]);

  useEffect(() => {
    if (queuedNotepad && printDrawerEnabled) {
      setExpanded(true);
    }
  }, [queuedNotepad, printDrawerEnabled]);

  const focusInvoice = useCallback((invoiceId: string) => {
    setFocusedInvoiceId(invoiceId);
  }, []);

  const unfocusInvoice = useCallback(() => {
    setFocusedInvoiceId(null);
  }, []);

  const executePrint = useCallback(
    async (invoice: HubInvoice): Promise<boolean> => {
      const items = invoice.items.map((item, i) => ({
        name: item.name || `Item ${i + 1}`,
        price: item.price,
        quantity: item.quantity,
      }));
      const total = parseFloat(invoice.total) || 0;
      return printerInstance.printInvoiceImage(
        invoice.name,
        items,
        total,
        currency,
        attendantName,
        'full'
      );
    },
    [attendantName, currency]
  );

  const runNotepadPrint = useCallback(async () => {
    if (!printDrawerEnabled || !queuedNotepad || isPrinting) return;
    setIsPrinting(true);
    try {
      const connected =
        printerInstance.isConnected || (await printerInstance.ensureConnected());
      if (!connected) {
        showReconnectPrompt();
        setPrinterModalOpen(true);
        return;
      }
      const ok = await printerInstance.printNotepadImage(
        queuedNotepad.title,
        queuedNotepad.body,
        attendantName
      );
      if (ok) {
        showPrintSuccess();
        onQueuedNotepadConsumed?.();
      }
    } finally {
      setIsPrinting(false);
    }
  }, [
    attendantName,
    isPrinting,
    onQueuedNotepadConsumed,
    printDrawerEnabled,
    queuedNotepad,
    showPrintSuccess,
    showReconnectPrompt,
  ]);

  const runPrint = useCallback(
    async (invoice: HubInvoice) => {
      if (!printDrawerEnabled || !onInvoicePrinted) return;
      if (isPrinting) return;
      const hasTotal = (parseFloat(invoice.total) || 0) > 0;
      if (invoice.items.length === 0 && !hasTotal) return;
      setIsPrinting(true);
      setPrintFlash(invoice.id);
      try {
        const connected =
          printerInstance.isConnected || (await printerInstance.ensureConnected());
        if (!connected) {
          showReconnectPrompt();
          setPendingPrint(invoice);
          setPrinterModalOpen(true);
          return;
        }
        const ok = await executePrint(invoice);
        if (ok) {
          onInvoicePrinted?.(invoice.name, invoice.total, invoice.items);
          showPrintSuccess();
        }
      } finally {
        setIsPrinting(false);
        window.setTimeout(() => setPrintFlash(null), 520);
      }
    },
    [executePrint, isPrinting, onInvoicePrinted, printDrawerEnabled, showReconnectPrompt, showPrintSuccess]
  );

  const handleCloseClick = () => {
    if (expanded) {
      collapseDrawer();
      return;
    }
    onCloseDashboard();
  };

  const handleHubClick = () => {
    if (!printDrawerEnabled || expanded) return;
    openDrawer();
  };

  const handleDrawerBackgroundClick = () => {
    if (focusedInvoiceId) unfocusInvoice();
  };

  const handleClickInvoiceSelect = (invoice: HubInvoice) => {
    if (focusedInvoiceId === invoice.id) {
      unfocusInvoice();
      return;
    }
    focusInvoice(invoice.id);
  };

  const renderPrinterStatusButton = (extraClass = '') => (
    <button
      type="button"
      className={`vision-hub-printer-status vision-hub-trio-pressable ${extraClass} ${
        printerConnected
          ? 'vision-hub-printer-status--connected'
          : 'vision-hub-printer-status--disconnected'
      }`}
      onClick={() => setPrinterModalOpen(true)}
      onPointerDown={(e) => e.stopPropagation()}
      title={printerConnected ? 'Printer connected' : 'Printer disconnected — tap to connect'}
    >
      <span className="vision-hub-printer-status__dot" aria-hidden="true" />
      {printerConnected ? 'On' : 'Off'}
    </button>
  );

  const renderQueuedNotepadBlock = () => {
    if (!queuedNotepad) return null;
    return (
      <div
        className="vision-hub-notepad-queue mb-4 p-4 rounded-2xl border border-current/12 bg-black/5"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-black tracking-tight truncate">{queuedNotepad.title}</p>
        <pre className="text-[11px] font-medium leading-relaxed whitespace-pre-wrap opacity-75 max-h-36 overflow-y-auto mt-2 custom-scrollbar">
          {queuedNotepad.body}
        </pre>
        <button
          type="button"
          onClick={() => void runNotepadPrint()}
          disabled={isPrinting}
          className="mt-3 w-full py-3 rounded-full font-black text-xs uppercase tracking-[0.2em] disabled:opacity-50 text-black"
          style={{ backgroundColor: accentColor }}
        >
          Print notepad
        </button>
      </div>
    );
  };

  const renderClickDrawer = () => {
    const focusedInvoice = visibleInvoices.find((inv) => inv.id === focusedInvoiceId) ?? null;

    return (
      <div
        className={`vision-hub-drawer__inner vision-hub-drawer__inner--click vision-hub-drawer__inner--force-light vision-hub-drawer__inner--trio-morph mt-5 pt-5 border-t border-black/10 ${
          focusedInvoiceId ? 'vision-hub-drawer__inner--focused' : ''
        }`}
        onClick={handleDrawerBackgroundClick}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {renderQueuedNotepadBlock()}
        <div className="vision-hub-click-toolbar vision-hub-morph-text vision-hub-morph-text--5">
          {renderPrinterStatusButton()}
          {printSuccess ? (
            <div className="vision-hub-print-success vision-hub-print-success--inline" role="status" aria-label="Print successful">
              <Icons.Check size={16} />
            </div>
          ) : isPrinting ? (
            <div className="vision-hub-print-loading vision-hub-print-loading--inline" aria-label="Printing">
              <AppLoadingSpinner size="sm" label="Printing" />
            </div>
          ) : null}
        </div>

        {focusedInvoice ? (
          <div
            key={`focus-${focusedInvoice.id}`}
            className="vision-hub-click-focus vision-hub-morph-text vision-hub-morph-text--6"
            onClick={(e) => e.stopPropagation()}
          >
            <InvoiceReceiptPreview
              brandLabel={invoiceBrandLabel}
              businessName={businessName}
              businessPhone={businessPhone}
              businessAddress={businessAddress}
              title={focusedInvoice.name}
              status={
                focusedInvoice.isCurrent ? 'Current' : focusedInvoice.isPaid ? 'Paid' : 'Open'
              }
              items={focusedInvoice.items}
              total={focusedInvoice.total}
              currency={currency}
              variant="drawer"
              maxItemLines={6}
              className={printFlash === focusedInvoice.id ? 'invoice-receipt-preview-wrap--flash' : ''}
            />
            <button
              type="button"
              className="vision-hub-click-print-btn vision-hub-trio-pressable"
              style={{ backgroundColor: accentColor }}
              disabled={isPrinting || (focusedInvoice.items.length === 0 && !(parseFloat(focusedInvoice.total) || 0))}
              onClick={() => void runPrint(focusedInvoice)}
            >
              <Icons.Printer size={18} />
              Print
            </button>
            <button
              type="button"
              className="vision-hub-click-back-btn vision-hub-trio-pressable"
              onClick={unfocusInvoice}
            >
              Back to list
            </button>
            {reconnectPrompt && !printerConnected && (
              <p className="vision-hub-reconnect-prompt" role="alert">
                reconnect printer
              </p>
            )}
          </div>
        ) : (
          <div className="vision-hub-click-list custom-scrollbar">
            {visibleInvoices.length === 0 ? (
              <p className="vision-hub-morph-text vision-hub-morph-text--6 pos-subtext text-[10px] opacity-45 py-8 text-center text-black/50">
                No invoices for this day
              </p>
            ) : (
              visibleInvoices.map((invoice, idx) => (
                <button
                  key={invoice.id}
                  type="button"
                  className={`vision-hub-click-row vision-hub-trio-pressable vision-hub-morph-text ${
                    printFlash === invoice.id ? 'vision-hub-click-row--flash' : ''
                  } ${invoice.isPaid ? 'vision-hub-click-row--paid' : ''}`}
                  style={{ animationDelay: `${0.05 + Math.min(idx, 8) * 0.03}s` }}
                  onClick={() => handleClickInvoiceSelect(invoice)}
                >
                  <span className="vision-hub-click-row__name">
                    {invoice.name}
                    {invoice.isPaid && (
                      <span className="vision-hub-invoice-paid-badge vision-hub-invoice-paid-badge--inline">Paid</span>
                    )}
                  </span>
                  <span className="vision-hub-click-row__total">{formatCurrency(invoice.total)}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  const handleModalPrint = useCallback(async () => {
    if (!printDrawerEnabled || !onInvoicePrinted || !pendingPrint) return;
    const ok = await executePrint(pendingPrint);
    if (!ok) throw new Error('Print failed.');
    onInvoicePrinted?.(pendingPrint.name, pendingPrint.total, pendingPrint.items);
    showPrintSuccess();
    setPendingPrint(null);
  }, [pendingPrint, executePrint, onInvoicePrinted, printDrawerEnabled, showPrintSuccess]);

  // When drawer is open, force white shell even if app theme is dark
  const headerShellClass = drawerLight
    ? 'bg-white text-zinc-900'
    : isLight
      ? 'bg-zinc-900 text-white'
      : 'bg-white text-zinc-900';
  const iconOnShell = drawerLight
    ? 'pos-dashboard-icon-lift--on-light bg-zinc-100 border-zinc-200 hover:bg-zinc-200 text-zinc-900'
    : isLight
      ? 'pos-dashboard-icon-lift--on-dark bg-black/40 border-white/5 hover:bg-black/60 text-white'
      : 'pos-dashboard-icon-lift--on-light bg-zinc-100 border-zinc-200 hover:bg-zinc-200 text-zinc-900';
  const shellSubtext = drawerLight ? 'text-zinc-500' : invertedBarSubtextClass;
  const shellDivider = drawerLight
    ? 'bg-zinc-900/20'
    : isLight
      ? 'bg-white/20'
      : 'bg-zinc-900/20';

  const isOnline = useOnlineStatus();
  const showSessionStatus = printDrawerEnabled && !expanded;
  const sessionLabel = !printDrawerEnabled
    ? 'Admin Print Hub'
    : expanded
      ? 'Print Hub Open'
      : isOnline
        ? 'Live Session · Tap to print'
        : 'Connect Internet';

  return (
    <>
      {expanded && (
        <button
          type="button"
          className="vision-hub-backdrop"
          aria-label="Close print hub"
          onClick={collapseDrawer}
        />
      )}

      <div ref={panelRef} className="vision-hub-panel relative shrink-0 z-[70]">
        <div
          className={`relative pt-8 px-6 pb-2 touch-manipulation ${expanded ? 'overflow-hidden' : 'overflow-visible'}`}
        >
          <div
            className={`vision-hub-shell w-full rounded-xl p-8 shadow-[0_32px_80px_rgba(0,0,0,0.25)] pos-dashboard-card-motion ${headerShellClass} ${
              hubActive ? 'vision-hub-shell--active' : ''
            } ${expanded ? 'vision-hub-shell--drawer-open vision-hub-shell--force-light vision-hub-shell--trio-morph' : ''} ${
              printDrawerEnabled && !expanded ? 'cursor-pointer' : ''
            }`}
            onClick={handleHubClick}
            role={printDrawerEnabled && !expanded ? 'button' : undefined}
            aria-label={printDrawerEnabled && !expanded ? 'Open print hub' : undefined}
          >
            <div className="flex justify-between items-start gap-4">
              <div className="flex flex-col min-w-0 flex-1 pr-2">
                <span
                  className={`vision-hub-morph-text vision-hub-morph-text--1 pos-subtext text-[9px] font-black mb-1 ${shellSubtext}`}
                >
                  Neural Terminal
                </span>
                <h2 className="vision-hub-morph-text vision-hub-morph-text--2 vision-hub-title text-4xl font-black tracking-tighter">
                  Vision Hub
                </h2>
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="vision-hub-morph-text vision-hub-morph-text--3 font-num-medium text-xl tracking-tight leading-none shrink-0">
                    {currentTimeLabel}
                  </div>
                  <div className={`vision-hub-morph-text vision-hub-morph-text--3 w-px h-4 shrink-0 ${shellDivider}`} />
                  <div className="flex items-center gap-1.5 shrink-0 min-w-0">
                    {showSessionStatus && (
                      <span
                        className={`vision-hub-wifi-icon ${
                          isOnline ? 'vision-hub-wifi-icon--online' : 'vision-hub-wifi-icon--offline'
                        }`}
                        aria-hidden
                      >
                        <Icons.Wifi size={12} />
                      </span>
                    )}
                    <span
                      key={sessionLabel}
                      className={`vision-hub-morph-text vision-hub-morph-text--4 vision-hub-session-label text-[9px] font-bold shrink-0 ${shellSubtext} ${
                        showSessionStatus && !isOnline ? 'vision-hub-session-label--pulse' : ''
                      }`}
                    >
                      {sessionLabel}
                    </span>
                  </div>
                </div>
              </div>

              <div
                className="flex flex-col items-end gap-2 shrink-0 relative z-20"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {/* Trio+new ↔ date morph (Settings Save/Discard spring) */}
                <div
                  className={`vision-hub-actions-cluster ${
                    expanded && printDrawerEnabled
                      ? 'vision-hub-actions-cluster--date'
                      : 'vision-hub-actions-cluster--trio'
                  }`}
                >
                  <div
                    className="vision-hub-actions-trio"
                    aria-hidden={expanded && printDrawerEnabled}
                  >
                    <div className="vision-hub-actions-trio__row">
                      <button
                        type="button"
                        onClick={onThemeToggle}
                        onAnimationEnd={onThemeAnimationEnd}
                        tabIndex={expanded && printDrawerEnabled ? -1 : 0}
                        disabled={expanded && printDrawerEnabled}
                        className={`vision-hub-actions-trio__btn h-8 w-8 rounded-full flex items-center justify-center border pos-dashboard-icon-lift ${iconOnShell} ${isThemeAnimating ? 'animate-trio-press' : ''}`}
                        title="Toggle Theme"
                      >
                        {isLight ? <Icons.Moon size={16} /> : <Icons.Sun size={16} />}
                      </button>
                      <button
                        type="button"
                        onClick={onSettingsOpen}
                        onAnimationEnd={onSettingsAnimationEnd}
                        tabIndex={expanded && printDrawerEnabled ? -1 : 0}
                        disabled={expanded && printDrawerEnabled}
                        className={`vision-hub-actions-trio__btn h-8 w-8 rounded-full flex items-center justify-center border pos-dashboard-icon-lift ${iconOnShell} ${isSettingsAnimating ? 'animate-trio-press' : ''}`}
                        title="Settings"
                      >
                        <Icons.Settings size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={handleCloseClick}
                        onAnimationEnd={onCloseAnimationEnd}
                        tabIndex={expanded && printDrawerEnabled ? -1 : 0}
                        disabled={expanded && printDrawerEnabled}
                        className={`vision-hub-actions-trio__btn vision-hub-close-btn h-8 w-8 rounded-full flex items-center justify-center border pos-dashboard-icon-lift ${iconOnShell} ${isCloseAnimating ? 'animate-trio-press' : ''}`}
                        title="Close"
                      >
                        <Icons.X size={16} />
                      </button>
                    </div>
                  </div>

                  <div
                    className="vision-hub-actions-date"
                    aria-hidden={!(expanded && printDrawerEnabled)}
                  >
                    <div className="vision-hub-actions-date__row relative flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDateDrawerOpen((v) => !v);
                        }}
                        tabIndex={expanded && printDrawerEnabled ? 0 : -1}
                        disabled={!(expanded && printDrawerEnabled)}
                        className={`vision-hub-actions-date__btn vision-hub-trio-pressable h-8 min-w-[2.75rem] px-2.5 rounded-full flex items-center justify-center text-[11px] font-black tabular-nums tracking-tight border pos-dashboard-icon-lift ${iconOnShell}`}
                        title="Browse invoices by date"
                        aria-expanded={dateDrawerOpen}
                        aria-label={`Invoice date ${dateButtonLabel}`}
                      >
                        {dateButtonLabel}
                      </button>
                      {/* X always available while drawer is open (collapse print hub) */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          collapseDrawer();
                        }}
                        tabIndex={expanded && printDrawerEnabled ? 0 : -1}
                        disabled={!(expanded && printDrawerEnabled)}
                        className={`vision-hub-actions-date__btn vision-hub-drawer-close-btn vision-hub-trio-pressable h-8 w-8 rounded-full flex items-center justify-center border pos-dashboard-icon-lift ${iconOnShell}`}
                        title="Close print hub"
                        aria-label="Close print hub drawer"
                      >
                        <Icons.X size={16} />
                      </button>
                      {dateDrawerOpen && expanded && printDrawerEnabled && (
                        <div
                          className="vision-hub-date-drawer absolute right-0 top-[calc(100%+0.4rem)] z-50 w-[9.5rem] max-h-[14rem] overflow-y-auto custom-scrollbar rounded-2xl border border-black/10 bg-white text-zinc-900 shadow-[0_16px_48px_rgba(0,0,0,0.28)] fluid-pop-in"
                          role="listbox"
                          aria-label="Invoice dates"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            role="option"
                            aria-selected={selectedDayStart == null}
                            className={`w-full text-left px-3 py-2.5 text-[11px] font-black border-b border-black/6 ${
                              selectedDayStart == null
                                ? 'bg-blue-500 text-white'
                                : 'text-zinc-800 hover:bg-zinc-100'
                            }`}
                            onClick={() => {
                              setSelectedDayStart(null);
                              setFocusedInvoiceId(null);
                              setDateDrawerOpen(false);
                            }}
                          >
                            Live · today
                          </button>
                          {[...dateList].reverse().map((dayTs) => {
                            const active =
                              selectedDayStart != null &&
                              dayKeyFromTs(selectedDayStart) === dayKeyFromTs(dayTs);
                            return (
                              <button
                                key={dayTs}
                                type="button"
                                role="option"
                                aria-selected={active}
                                className={`w-full text-left px-3 py-2.5 text-[11px] font-black tabular-nums border-b border-black/6 last:border-0 ${
                                  active
                                    ? 'bg-blue-500 text-white'
                                    : 'text-zinc-800 hover:bg-zinc-100'
                                }`}
                                onClick={() => {
                                  setSelectedDayStart(dayTs);
                                  setFocusedInvoiceId(null);
                                  setDateDrawerOpen(false);
                                }}
                              >
                                {formatDayButtonLabel(dayTs)}
                                <span className="block text-[9px] font-bold opacity-60 mt-0.5">
                                  {new Date(dayTs).toLocaleDateString(undefined, {
                                    weekday: 'short',
                                    year: 'numeric',
                                  })}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Always clickable — outside date morph; plays trio-press then navigates */}
                {onNewInvoice && (
                  <button
                    type="button"
                    tabIndex={0}
                    aria-busy={isNewAnimating}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (isNewAnimating || newInvoicePendingRef.current) return;
                      newInvoicePendingRef.current = true;
                      setIsNewAnimating(true);
                      // Safety if animationend is missed (~fluid-in 280ms)
                      if (newAnimTimerRef.current != null) {
                        window.clearTimeout(newAnimTimerRef.current);
                      }
                      newAnimTimerRef.current = window.setTimeout(() => {
                        finishNewInvoiceAnim();
                      }, 320);
                    }}
                    onAnimationEnd={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (!newInvoicePendingRef.current && !isNewAnimating) return;
                      finishNewInvoiceAnim();
                    }}
                    className={`vision-hub-new-btn vision-hub-new-btn--standalone vision-hub-trio-pressable pointer-events-auto h-8 min-w-[3.25rem] px-3 rounded-full flex items-center justify-center text-[10px] font-black uppercase tracking-[0.14em] border ${
                      isNewAnimating ? 'animate-trio-press' : ''
                    }`}
                    title="New invoice on calculator"
                    aria-label="New invoice, open calculator"
                  >
                    +new
                  </button>
                )}
              </div>
            </div>

            {printDrawerEnabled && (
            <div
              className={`vision-hub-drawer vision-hub-drawer--click ${expanded ? 'vision-hub-drawer--open vision-hub-drawer--force-light' : 'overflow-hidden'}`}
              style={{
                height: expanded ? DRAWER_HEIGHT : 0,
                maxHeight: expanded ? DRAWER_HEIGHT : 0,
                opacity: expanded ? 1 : 0,
                transition:
                  'height var(--fluid-in-ms, 280ms) var(--fluid-spring, cubic-bezier(0.34, 1.45, 0.64, 1)), max-height var(--fluid-in-ms, 280ms) var(--fluid-spring, cubic-bezier(0.34, 1.45, 0.64, 1)), opacity var(--fluid-out-ms, 280ms) var(--fluid-ease, cubic-bezier(0.22, 1, 0.36, 1))',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {expanded &&
                (invoices.length === 0 ? (
                  <div className="vision-hub-drawer__inner vision-hub-drawer__inner--force-light mt-5 pt-5 border-t border-black/10">
                    <p className="pos-subtext text-[10px] opacity-45 py-8 text-center text-black/50">No invoices yet</p>
                  </div>
                ) : (
                  renderClickDrawer()
                ))}
            </div>
            )}
          </div>
        </div>
      </div>

      {printDrawerEnabled && (
      <PrinterConnectModal
        isOpen={printerModalOpen}
        onClose={() => {
          setPrinterModalOpen(false);
          setPendingPrint(null);
        }}
        isLight={isLight}
        isPrinting={isPrinting}
        autoPrintOnConnect
        onPrint={handleModalPrint}
      />
      )}
    </>
  );
};

export default VisionHubPrintPanel;