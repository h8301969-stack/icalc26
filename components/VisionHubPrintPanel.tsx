import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '../constants';
import { CartLineItem } from '../types';
import { printerInstance } from '../utils/bluetoothPrinter';
import PrinterConnectModal from './PrinterConnectModal';

export interface HubInvoice {
  id: string;
  name: string;
  items: CartLineItem[];
  total: string;
  isCurrent: boolean;
  isPaid?: boolean;
}

export type VisionHubDrawerMode = 'drag' | 'click';

interface VisionHubPrintPanelProps {
  isLight: boolean;
  invertedBarSubtextClass: string;
  currentTimeLabel: string;
  currency: string;
  formatCurrency: (val: string) => string;
  accentColor: string;
  invoices: HubInvoice[];
  attendantName: string;
  drawerMode?: VisionHubDrawerMode;
  printDrawerEnabled?: boolean;
  onInvoicePrinted?: (invoiceName: string, total: string, items: CartLineItem[]) => void;
  onInteractionChange?: (active: boolean) => void;
  onThemeToggle: () => void;
  onSettingsOpen: () => void;
  onCloseDashboard: () => void;
  isThemeAnimating: boolean;
  isSettingsAnimating: boolean;
  isCloseAnimating: boolean;
  onThemeAnimationEnd: () => void;
  onSettingsAnimationEnd: () => void;
  onCloseAnimationEnd: () => void;
}

const OPEN_THRESHOLD = 68;
const PRINT_SWIPE_THRESHOLD = 112;
const TAP_MOVE_THRESHOLD = 10;
const RECONNECT_PROMPT_MS = 4200;

const DRAWER_HEIGHT_DRAG = 320;
const DRAWER_HEIGHT_CLICK = 380;

const VisionHubPrintPanel: React.FC<VisionHubPrintPanelProps> = ({
  isLight,
  invertedBarSubtextClass,
  currentTimeLabel,
  currency,
  formatCurrency,
  accentColor,
  invoices,
  attendantName,
  drawerMode = 'drag',
  printDrawerEnabled = true,
  onInvoicePrinted,
  onInteractionChange,
  onThemeToggle,
  onSettingsOpen,
  onCloseDashboard,
  isThemeAnimating,
  isSettingsAnimating,
  isCloseAnimating,
  onThemeAnimationEnd,
  onSettingsAnimationEnd,
  onCloseAnimationEnd,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [swipeInvoiceId, setSwipeInvoiceId] = useState<string | null>(null);
  const [swipeDeltaX, setSwipeDeltaX] = useState(0);
  const [isSwipeDragging, setIsSwipeDragging] = useState(false);
  const [printerModalOpen, setPrinterModalOpen] = useState(false);
  const [pendingPrint, setPendingPrint] = useState<HubInvoice | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printFlash, setPrintFlash] = useState<string | null>(null);
  const [focusedInvoiceId, setFocusedInvoiceId] = useState<string | null>(null);
  const [printerConnected, setPrinterConnected] = useState(() => printerInstance.isConnected);
  const [reconnectPrompt, setReconnectPrompt] = useState(false);
  const [printSuccess, setPrintSuccess] = useState(false);

  const dragStartY = useRef(0);
  const swipeStartX = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const printSuccessTimerRef = useRef<number | null>(null);

  const isClickMode = drawerMode === 'click';
  const drawerHeight = isClickMode ? DRAWER_HEIGHT_CLICK : DRAWER_HEIGHT_DRAG;

  const hubActive =
    printDrawerEnabled && (expanded || isDragging || dragY > 4 || focusedInvoiceId !== null);

  useEffect(() => {
    onInteractionChange?.(hubActive);
  }, [hubActive, onInteractionChange]);

  useEffect(() => {
    setSwipeInvoiceId(null);
    setSwipeDeltaX(0);
    setIsSwipeDragging(false);
  }, [drawerMode]);

  useEffect(() => {
    const syncConnection = () => setPrinterConnected(printerInstance.isConnected);
    syncConnection();
    printerInstance.setConnectionChangeListener(syncConnection);
    return () => printerInstance.removeConnectionChangeListener(syncConnection);
  }, []);

  useEffect(() => {
    if (!expanded) setFocusedInvoiceId(null);
  }, [expanded]);

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
    setDragY(0);
    setFocusedInvoiceId(null);
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (!printDrawerEnabled && expanded) {
      collapseDrawer();
    }
  }, [printDrawerEnabled, expanded, collapseDrawer]);

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

  const handleHubPointerDown = (e: React.PointerEvent) => {
    if (!printDrawerEnabled || isSwipeDragging) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStartY.current = e.clientY;
    setIsDragging(true);
  };

  const handleHubPointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const delta = e.clientY - dragStartY.current;
    if (expanded) {
      setDragY(Math.min(0, delta * 0.92));
    } else {
      setDragY(Math.max(0, delta * 0.88));
    }
  };

  const handleHubPointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setIsDragging(false);
    const moved = Math.abs(e.clientY - dragStartY.current);

    if (printDrawerEnabled && !expanded && (dragY >= OPEN_THRESHOLD || moved < 14)) {
      setExpanded(true);
      setDragY(0);
      return;
    }
    setDragY(0);
  };

  const handleCloseClick = () => {
    if (expanded) {
      collapseDrawer();
      return;
    }
    onCloseDashboard();
  };

  const handleInvoicePointerDown = (e: React.PointerEvent, invoice: HubInvoice) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    swipeStartX.current = e.clientX;
    setSwipeInvoiceId(invoice.id);
    setSwipeDeltaX(0);
    setIsSwipeDragging(true);
  };

  const handleInvoicePointerMove = (e: React.PointerEvent) => {
    if (!isSwipeDragging || !swipeInvoiceId) return;
    const delta = Math.max(0, e.clientX - swipeStartX.current);
    setSwipeDeltaX(delta);
  };

  const handleInvoicePointerUp = (e: React.PointerEvent, invoice: HubInvoice) => {
    if (!isSwipeDragging) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setIsSwipeDragging(false);
    const delta = swipeDeltaX;
    const shouldPrint = delta >= PRINT_SWIPE_THRESHOLD;
    setSwipeInvoiceId(null);
    setSwipeDeltaX(0);
    if (shouldPrint) {
      void runPrint(invoice);
      return;
    }
    if (delta < TAP_MOVE_THRESHOLD) {
      if (focusedInvoiceId === invoice.id) {
        unfocusInvoice();
      } else {
        focusInvoice(invoice.id);
      }
    }
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
      className={`vision-hub-printer-status ${extraClass} ${
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

  const renderClickDrawer = () => {
    const focusedInvoice = invoices.find((inv) => inv.id === focusedInvoiceId) ?? null;

    return (
      <div
        className={`vision-hub-drawer__inner vision-hub-drawer__inner--click mt-5 pt-5 border-t border-current/10 ${
          focusedInvoiceId ? 'vision-hub-drawer__inner--focused' : ''
        }`}
        onClick={handleDrawerBackgroundClick}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="vision-hub-click-toolbar">
          {renderPrinterStatusButton()}
          {printSuccess ? (
            <div className="vision-hub-print-success vision-hub-print-success--inline" role="status" aria-label="Print successful">
              <Icons.Check size={16} />
            </div>
          ) : isPrinting ? (
            <div className="vision-hub-print-loading vision-hub-print-loading--inline" aria-label="Printing">
              <span className="auth-spinner" aria-hidden="true" />
            </div>
          ) : null}
        </div>

        {focusedInvoice ? (
          <div className="vision-hub-click-focus" onClick={(e) => e.stopPropagation()}>
            <div
              className={`vision-hub-invoice-row vision-hub-invoice-row--focused vision-hub-invoice-row--click ${
                printFlash === focusedInvoice.id ? 'vision-hub-invoice-row--flash' : ''
              } ${focusedInvoice.isPaid ? 'vision-hub-invoice-row--paid' : ''}`}
            >
              <div className="vision-hub-invoice-row__head">
                <p className="vision-hub-invoice-name">{focusedInvoice.name}</p>
                {focusedInvoice.isPaid && (
                  <span className="vision-hub-invoice-paid-badge">Paid</span>
                )}
              </div>
              <span className="vision-hub-invoice-total">{formatCurrency(focusedInvoice.total)}</span>
            </div>
            <button
              type="button"
              className="vision-hub-click-print-btn"
              style={{ backgroundColor: accentColor }}
              disabled={isPrinting || (focusedInvoice.items.length === 0 && !(parseFloat(focusedInvoice.total) || 0))}
              onClick={() => void runPrint(focusedInvoice)}
            >
              <Icons.Printer size={18} />
              Print
            </button>
            <button
              type="button"
              className="vision-hub-click-back-btn"
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
            {invoices.map((invoice) => (
              <button
                key={invoice.id}
                type="button"
                className={`vision-hub-click-row ${
                  printFlash === invoice.id ? 'vision-hub-click-row--flash' : ''
                } ${invoice.isPaid ? 'vision-hub-click-row--paid' : ''}`}
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
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderDragDrawer = () => (
    <div
      className={`vision-hub-drawer__inner mt-5 pt-5 border-t border-current/10 ${
        focusedInvoiceId ? 'vision-hub-drawer__inner--focused' : ''
      }`}
      onClick={handleDrawerBackgroundClick}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {invoices.length === 0 ? (
        <p className="pos-subtext text-[10px] opacity-45 py-8 text-center">No invoices yet</p>
      ) : (
        <div className={`vision-hub-drawer-stage ${isSwipeDragging ? 'vision-hub-drawer-stage--dragging' : ''}`}>
          {focusedInvoiceId ? (
            <>
              <div className="vision-hub-focus-dismiss" aria-hidden="true" />
              <div className="vision-hub-focused-slot">
                {invoices
                  .filter((inv) => inv.id === focusedInvoiceId)
                  .map((invoice) => renderInvoiceButton(invoice, 'focused'))}
              </div>
            </>
          ) : (
            <div className="vision-hub-invoice-strip custom-scrollbar">
              {invoices.map((invoice) => renderInvoiceButton(invoice, 'compact'))}
            </div>
          )}

          <div
            className={`vision-hub-printer-zone ${printerGlow > 0.2 ? 'vision-hub-printer-zone--glow' : ''}`}
            style={{
              boxShadow:
                printerGlow > 0.2
                  ? `0 0 ${24 + printerGlow * 36}px rgba(16,185,129,${0.25 + printerGlow * 0.45})`
                  : undefined,
              transform: `scale(${1 + printerGlow * 0.08})`,
              transition: isSwipeDragging ? 'none' : 'transform 0.25s ease, box-shadow 0.25s ease',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {renderPrinterStatusButton('mb-2')}
            {printSuccess ? (
              <div className="vision-hub-print-success" role="status" aria-label="Print successful">
                <Icons.Check size={22} />
              </div>
            ) : isPrinting ? (
              <div className="vision-hub-print-loading" aria-label="Printing">
                <span className="auth-spinner" aria-hidden="true" />
              </div>
            ) : (
              <div
                className="vision-hub-printer-icon"
                style={{
                  opacity: 0.55 + printerGlow * 0.45,
                }}
              >
                <Icons.Printer size={30} />
              </div>
            )}
            {reconnectPrompt && !printerConnected && (
              <p className="vision-hub-reconnect-prompt" role="alert">
                reconnect printer
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const renderInvoiceButton = (invoice: HubInvoice, mode: 'compact' | 'focused') => {
    const isSwiping = swipeInvoiceId === invoice.id;
    const isCarried = isSwiping && isSwipeDragging;
    const offsetX = isSwiping ? swipeDeltaX : 0;
    const isFlashing = printFlash === invoice.id;
    const isFocused = focusedInvoiceId === invoice.id;
    const carryLift = isCarried ? -8 - Math.min(offsetX / PRINT_SWIPE_THRESHOLD, 1) * 4 : 0;
    const carryScale = isCarried ? 1.06 + Math.min(offsetX / PRINT_SWIPE_THRESHOLD, 1) * 0.05 : 1;
    const rowTransform = isCarried
      ? `translateX(${offsetX}px) translateY(${carryLift}px) scale(${carryScale})`
      : undefined;

    const rowClass = `vision-hub-invoice-row vision-hub-invoice-row--${mode} ${
      isFlashing ? 'vision-hub-invoice-row--flash' : ''
    } ${isFocused ? 'vision-hub-invoice-row--focused' : ''} ${
      isCarried ? 'vision-hub-invoice-row--swiping vision-hub-invoice-row--carried' : ''
    } ${invoice.isPaid ? 'vision-hub-invoice-row--paid' : ''}`;

    const rowContent = (
      <>
        <div className="vision-hub-invoice-row__head">
          <p className="vision-hub-invoice-name">{invoice.name}</p>
          {invoice.isPaid && (
            <span className="vision-hub-invoice-paid-badge">Paid</span>
          )}
        </div>
        <span className="vision-hub-invoice-total">{formatCurrency(invoice.total)}</span>
      </>
    );

    return (
      <div
        key={invoice.id}
        className={`vision-hub-invoice-slot vision-hub-invoice-slot--${mode}`}
      >
        {isCarried && (
          <div className={`${rowClass} vision-hub-invoice-row--ghost`} aria-hidden="true">
            {rowContent}
          </div>
        )}
        <div
          className={rowClass}
          style={{
            transform: rowTransform,
            transition: isCarried ? 'none' : 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          onPointerDown={(e) => handleInvoicePointerDown(e, invoice)}
          onPointerMove={handleInvoicePointerMove}
          onPointerUp={(e) => handleInvoicePointerUp(e, invoice)}
          onPointerCancel={(e) => handleInvoicePointerUp(e, invoice)}
          onClick={(e) => e.stopPropagation()}
        >
          {rowContent}
        </div>
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

  const panelTranslate = expanded ? Math.max(0, dragY) : dragY;
  const drawerProgress = expanded ? 1 : Math.min(1, dragY / OPEN_THRESHOLD);

  const printerGlow = useMemo(() => {
    if (!swipeInvoiceId) return 0;
    return Math.min(1, swipeDeltaX / PRINT_SWIPE_THRESHOLD);
  }, [swipeDeltaX, swipeInvoiceId]);

  const headerShellClass = isLight
    ? 'bg-zinc-900 text-white'
    : 'bg-white text-zinc-900';

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
          style={{
            transform: `translateY(${panelTranslate}px)`,
            transition: isDragging ? 'none' : 'transform 0.38s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          onPointerDown={handleHubPointerDown}
          onPointerMove={handleHubPointerMove}
          onPointerUp={handleHubPointerUp}
          onPointerCancel={handleHubPointerUp}
        >
          <div
            className={`vision-hub-shell w-full rounded-xl p-8 shadow-[0_32px_80px_rgba(0,0,0,0.25)] pos-dashboard-card-motion ${headerShellClass} ${
              hubActive ? 'vision-hub-shell--active' : ''
            } ${expanded ? 'vision-hub-shell--drawer-open' : ''}`}
          >
            <div className="flex justify-between items-start gap-4">
              <div className="flex flex-col min-w-0 flex-1 pr-2">
                <span className={`pos-subtext text-[9px] font-black mb-1 ${invertedBarSubtextClass}`}>
                  Neural Terminal
                </span>
                <h2 className="vision-hub-title text-4xl font-black tracking-tighter">Vision Hub</h2>
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="font-num-medium text-xl tracking-tight leading-none shrink-0">{currentTimeLabel}</div>
                  <div className={`w-px h-4 shrink-0 ${isLight ? 'bg-white/20' : 'bg-zinc-900/20'}`} />
                  <div className={`pos-subtext text-[9px] font-bold shrink-0 ${invertedBarSubtextClass}`}>
                    {printDrawerEnabled ? (expanded ? 'Print hub open' : 'Live Session') : 'Admin print hub'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 relative z-20" onPointerDown={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={onThemeToggle}
                  onAnimationEnd={onThemeAnimationEnd}
                  className={`h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200 ${isThemeAnimating ? 'animate-plus-trigger' : ''} ${isLight ? 'bg-black/40 border-white/5 hover:bg-black/60 text-white' : 'bg-zinc-100 border-zinc-200 hover:bg-zinc-200 text-zinc-900'}`}
                  title="Toggle Theme"
                >
                  {isLight ? <Icons.Moon size={16} /> : <Icons.Sun size={16} />}
                </button>
                <button
                  type="button"
                  onClick={onSettingsOpen}
                  onAnimationEnd={onSettingsAnimationEnd}
                  className={`h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200 ${isSettingsAnimating ? 'animate-plus-trigger' : ''} ${isLight ? 'bg-black/40 border-white/5 hover:bg-black/60 text-white' : 'bg-zinc-100 border-zinc-200 hover:bg-zinc-200 text-zinc-900'}`}
                  title="Settings"
                >
                  <Icons.Settings size={16} />
                </button>
                <button
                  type="button"
                  onClick={handleCloseClick}
                  onAnimationEnd={onCloseAnimationEnd}
                  className={`vision-hub-close-btn h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200 border ${
                    isCloseAnimating ? 'animate-plus-trigger' : ''
                  } ${
                    expanded
                      ? 'vision-hub-close-btn--collapse'
                      : isLight
                        ? 'bg-black/40 border-white/5 hover:bg-black/60 text-white'
                        : 'bg-zinc-100 border-zinc-200 hover:bg-zinc-200 text-zinc-900'
                  }`}
                  title={expanded ? 'Close print hub' : 'Close'}
                >
                  <Icons.X size={16} />
                </button>
              </div>
            </div>

            {printDrawerEnabled && (
            <div
              className={`vision-hub-drawer ${expanded ? 'vision-hub-drawer--open' : 'overflow-hidden'} ${
                isClickMode ? 'vision-hub-drawer--click' : ''
              }`}
              style={{
                height: expanded ? drawerHeight : `${drawerProgress * drawerHeight}px`,
                maxHeight: expanded ? drawerHeight : `${drawerProgress * drawerHeight}px`,
                opacity: expanded ? 1 : drawerProgress,
                transition: isDragging ? 'none' : 'height 0.42s cubic-bezier(0.16, 1, 0.3, 1), max-height 0.42s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.28s ease',
              }}
            >
              {(expanded || drawerProgress > 0.12) && (
                invoices.length === 0 ? (
                  <div
                    className="vision-hub-drawer__inner mt-5 pt-5 border-t border-current/10"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <p className="pos-subtext text-[10px] opacity-45 py-8 text-center">No invoices yet</p>
                  </div>
                ) : isClickMode ? (
                  renderClickDrawer()
                ) : (
                  renderDragDrawer()
                )
              )}
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