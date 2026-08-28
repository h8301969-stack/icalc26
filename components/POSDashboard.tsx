import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  HistoryItem,
  InvoiceActionLog,
  InvoicePrintLog,
  CartLineItem,
  POSRequest,
  RestockNote,
  SupplierRecord,
} from '../types';
import { formatPosLineItemDisplay, formatPriceLabel } from '../utils/posExpression';
import { Icons } from '../constants';
import {
  InventoryItem,
  ActivityLogEntry,
  PurchaseRecord,
  WholesaleList,
  ArchivedWholesale,
  defaultWholesaleId,
} from '../hooks/usePOS';
import { isAdminProfile } from '../utils/auth';

import SettingsPanel from './SettingsPanel';
import { printerInstance } from '../utils/bluetoothPrinter';
import VisionHubPrintPanel, { HubInvoice } from './VisionHubPrintPanel';
import { DEFAULT_INVENTORY_IMAGE, resolveInventoryImage, WALLPAPER_IMAGE_URLS } from '../utils/wallpapers';
import { formInputClass } from '../utils/formFields';
import { MorphPresence } from './MorphCrossfade';
import FluidSegmentControl from './FluidSegmentControl';
import InventoryItemImage from './InventoryItemImage';
import { Capacitor } from '@capacitor/core';
import { pickPhotoFromGallery } from '../utils/nativeCamera';
import { isTelegramDbConnected, telegramUploadItemImage } from '../utils/telegramDb';

interface POSDashboardProps {
  history: HistoryItem[];
  items: InventoryItem[];
  setItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  purchases: PurchaseRecord[];
  setPurchases: React.Dispatch<React.SetStateAction<PurchaseRecord[]>>;
  suppliers: SupplierRecord[];
  setSuppliers: React.Dispatch<React.SetStateAction<SupplierRecord[]>>;
  requests: POSRequest[];
  setRequests: React.Dispatch<React.SetStateAction<POSRequest[]>>;
  restocks: RestockNote[];
  setRestocks: React.Dispatch<React.SetStateAction<RestockNote[]>>;
  wholesales: WholesaleList[];
  activeWholesaleId: string;
  setActiveWholesaleId: (id: string) => void;
  renameWholesale: (id: string, name: string) => void;
  addWholesale: () => WholesaleList | null;
  archivedWholesales: ArchivedWholesale[];
  archiveWholesale: (id: string) => { ok: true } | { ok: false; error: string };
  restoreWholesale: (id: string) => { ok: true } | { ok: false; error: string };
  invoiceActionLogs: InvoiceActionLog[];
  invoiceName: string;
  cartItems: CartLineItem[];
  runningTotal: string;
  printLogs: InvoicePrintLog[];
  currency: string;
  isOpen: boolean;
  onClose: () => void;
  isLight: boolean;
  accentColor: string;
  formatCurrency: (val: string) => string;
  settings: {
    themeMode: 'light' | 'dark' | 'system';
    disableCalculatorCard?: boolean;
    layoutMode?: 'portrait' | 'landscape';
    visionHubDrawerMode?: 'drag' | 'click';
    profiles?: import('../types').UserProfile[];
    activeProfileId?: string;
    currency?: string;
    businessName?: string;
    businessPhone?: string;
    businessAddress?: string;
  };
  updateSettings: (keyOrPatch: string | Record<string, unknown>, value?: unknown) => void;
  onInvoicePrinted?: (invoiceName: string, total: string, items: CartLineItem[]) => void;
  onResolveUnidentifiedPrice?: (price: number, itemName: string) => void;
  canViewTransactions?: boolean;
  accountUsername?: string;
  /** Signed-in shop account — used to store/retrieve item photos on Telegram. */
  accountId?: string | null;
  onChangePassword?: (current: string, newPassword: string) => Promise<{ error?: string; ok?: boolean }>;
  onLogout?: () => void;
  onVerifyAdminPassword?: (password: string) => Promise<{ error?: string; ok?: boolean }>;
  /** Fan-out inventory change alerts to other profiles on this account. */
  onAccountNotify?: (input: {
    kind: 'item_added' | 'item_restocked' | 'price_updated' | 'stock_updated' | 'image_updated';
    title: string;
    body: string;
  }) => void;
  /** Assets Hub carting — tap product adds +1 and syncs calculator expression. */
  onAddProductToCart?: (price: number) => void;
  /** Cart panel + button — start a fresh invoice (same as calculator +). */
  onStartNewInvoice?: () => void;
}

/** Accept any common photo container; empty MIME (HEIC etc.) falls back to extension. */
const PHOTO_ACCEPT =
  'image/*,image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif,image/tiff,.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif,.heic,.heif,.tif,.tiff,.jfif,.dng';
const PHOTO_EXT_RE = /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|tiff?|jfif|dng)$/i;

const isLikelyImageFile = (file: File): boolean => {
  if (file.type.startsWith('image/')) return true;
  if (!file.type || file.type === 'application/octet-stream') {
    return PHOTO_EXT_RE.test(file.name);
  }
  return PHOTO_EXT_RE.test(file.name);
};


type DashboardLogFilter = 'all' | 'restock' | 'sale' | 'invoice' | 'unidentified' | 'updates' | '24h' | '48h' | '7d';

interface DashboardLogEntry {
  id: string;
  timestamp: number;
  action: string;
  itemName?: string;
  type: ActivityLogEntry['type'] | 'invoice-add' | 'invoice-unidentified';
  isUnidentified?: boolean;
  price?: number;
  quantity?: number;
  invoiceName?: string;
  profileName?: string;
  source: 'inventory' | 'invoice';
}

type SortOption = 'a-z' | 'high-stock' | 'low-stock';

/** Press-and-hold duration to rename a wholesale chip. */
const WHOLESALE_HOLD_MS = 480;

const INVENTORY_SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: 'a-z', label: 'A-Z' },
  { id: 'high-stock', label: 'Stock ↓' },
  { id: 'low-stock', label: 'Stock ↑' },
];

/** Matches FluidSegmentControl / wholesale toggle outer height (h-10). */
const HUB_BACK_BTN =
  'inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-[14px] font-semibold text-[11px] uppercase active:scale-95 transition-all duration-150';

const HubBackChevron = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

function formatRequestElapsed(timestamp: number, now: Date): string {
  const ms = Math.max(0, now.getTime() - timestamp);
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (secs < 60) return `${secs}s`;
  if (mins < 60) return `${mins}m`;
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${days}d ${hrs % 24}h`;
}

/** Real calendar stamp for action-log rows, e.g. Aug-23 · 2:45 PM */
function formatActionLogStamp(timestamp: number): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '—';
  const mon = d.toLocaleString([], { month: 'short' });
  const day = String(d.getDate()).padStart(2, '0');
  const time = d.toLocaleString([], { hour: 'numeric', minute: '2-digit' });
  return `${mon}-${day} · ${time}`;
}

/** Business day rolls at 05:00 local — logs are hidden for prior days, never deleted. */
const ACTION_LOG_DAY_HOUR = 5;

function getBusinessDayStart(at: Date | number, hour = ACTION_LOG_DAY_HOUR): number {
  const d = new Date(at);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0, 0);
  if (d.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
  return start.getTime();
}

function getBusinessDayKey(at: Date | number): string {
  const start = new Date(getBusinessDayStart(at));
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, '0');
  const day = String(start.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatBusinessDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  const mon = date.toLocaleString([], { month: 'short' }).toUpperCase();
  return `${mon}-${String(date.getDate()).padStart(2, '0')}`;
}

function businessDayRange(dayKey: string): { start: number; end: number } {
  const [y, m, d] = dayKey.split('-').map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1, ACTION_LOG_DAY_HOUR, 0, 0, 0).getTime();
  const end = start + 86400000;
  return { start, end };
}

/** e.g. AUG-23.today · AUG-22.yesterday · AUG-21.friday */
function formatBusinessDayOptionLabel(dayKey: string, todayKey: string): string {
  const base = formatBusinessDayLabel(dayKey);
  if (dayKey === todayKey) return `${base}.today`;
  const yesterdayKey = getBusinessDayKey(businessDayRange(todayKey).start - 1);
  if (dayKey === yesterdayKey) return `${base}.yesterday`;
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  const weekday = date.toLocaleString([], { weekday: 'long' }).toLowerCase();
  return `${base}.${weekday}`;
}

const POSDashboard: React.FC<POSDashboardProps> = ({
  history: _history,
  items,
  setItems,
  purchases,
  suppliers: _suppliers,
  setSuppliers: _setSuppliers,
  requests: _requests,
  setRequests: _setRequests,
  restocks: _restocks,
  setRestocks: _setRestocks,
  wholesales,
  activeWholesaleId,
  setActiveWholesaleId,
  renameWholesale,
  addWholesale,
  archivedWholesales,
  archiveWholesale,
  restoreWholesale,
  invoiceActionLogs,
  invoiceName,
  cartItems,
  runningTotal,
  printLogs,
  currency,
  isOpen,
  onClose,
  isLight,
  accentColor,
  formatCurrency,
  settings,
  updateSettings,
  onInvoicePrinted,
  onResolveUnidentifiedPrice,
  canViewTransactions = false,
  accountUsername,
  accountId = null,
  onChangePassword,
  onLogout,
  onVerifyAdminPassword,
  onAccountNotify,
  onAddProductToCart,
  onStartNewInvoice,
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [renamingWholesaleId, setRenamingWholesaleId] = useState<string | null>(null);
  const [renamingWholesaleName, setRenamingWholesaleName] = useState('');
  const [wholesaleHoldMenuId, setWholesaleHoldMenuId] = useState<string | null>(null);
  const [wholesaleHoldMenuPos, setWholesaleHoldMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [wholesaleDeleteConfirmId, setWholesaleDeleteConfirmId] = useState<string | null>(null);
  const [wholesaleActionError, setWholesaleActionError] = useState<string | null>(null);
  const [showWholesaleArchive, setShowWholesaleArchive] = useState(false);
  const wholesaleHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wholesaleHoldFiredRef = useRef(false);
  const wholesaleHoldTargetRef = useRef<string | null>(null);
  const newItemImageInputRef = useRef<HTMLInputElement | null>(null);
  const editItemImageInputRef = useRef<HTMLInputElement | null>(null);
  const wholesaleTrackRef = useRef<HTMLDivElement>(null);
  const wholesaleBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [wholesaleThumb, setWholesaleThumb] = useState({ width: 0, left: 0 });
  const [wholesaleThumbReady, setWholesaleThumbReady] = useState(false);

  const activeProfile = useMemo(() => {
    const profiles = settings.profiles ?? [];
    return profiles.find((p) => p.id === settings.activeProfileId) ?? profiles[0] ?? null;
  }, [settings.profiles, settings.activeProfileId]);

  const activeProfileName = activeProfile?.name ?? 'Staff';

  const canEditStock = isAdminProfile(activeProfile) || activeProfile?.sellerType === 'wholesaler';
  const canEditPrice = isAdminProfile(activeProfile) || activeProfile?.sellerType === 'retailer';
  const canEditName = canEditStock;

  const [stockEditValue, setStockEditValue] = useState('');
  const [priceEditValue, setPriceEditValue] = useState('');
  const [nameEditValue, setNameEditValue] = useState('');
  const [inventoryExpanded, setInventoryExpanded] = useState(false);
  /** Dark-mode Asset Hub: brief white flash key (remounts animation). */
  const [assetHubFlashKey, setAssetHubFlashKey] = useState(0);
  const [purchasesExpanded, setPurchasesExpanded] = useState(false);
  const [avgCustomerExpanded, setAvgCustomerExpanded] = useState(false);
  const [invoicesTodayExpanded, setInvoicesTodayExpanded] = useState(false);
  const [monthlyRevExpanded, setMonthlyRevExpanded] = useState(false);
  const [dailySalesExpanded, setDailySalesExpanded] = useState(false);
  const [actionLogsExpanded, setActionLogsExpanded] = useState(false);
  const [actionLogSearchQuery, setActionLogSearchQuery] = useState('');
  const [showActionLogSearch, setShowActionLogSearch] = useState(false);
  const [actionLogFilter, setActionLogFilter] = useState<DashboardLogFilter>('all');
  /** Selected business day (5am→5am). Logs are never deleted — only filtered by this day. */
  const [actionLogDayKey, setActionLogDayKey] = useState(() => getBusinessDayKey(Date.now()));
  const [namingUnidentified, setNamingUnidentified] = useState<{ price: number; quantity: number } | null>(null);
  /** Asset Hub + menu: dropdown for add item / restock forms */
  type AssetActionMode = 'add' | 'restock';
  const [assetActionMode, setAssetActionMode] = useState<AssetActionMode>('add');
  const [showAssetMenu, setShowAssetMenu] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isThemeAnimating, setIsThemeAnimating] = useState(false);
  const [isSettingsAnimating, setIsSettingsAnimating] = useState(false);
  const [isCloseAnimating, setIsCloseAnimating] = useState(false);
  const [visionHubFocus, setVisionHubFocus] = useState(false);
  
  const [sortOption, setSortOption] = useState<SortOption>('a-z');
  const [inventoryLayout, setInventoryLayout] = useState<'grid' | 'list'>('grid');

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const itemLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemLongPressFired = useRef(false);

  useEffect(() => {
    if (!selectedItem) return;
    const item = items.find((i) => i.id === selectedItem.id) ?? selectedItem;
    setStockEditValue(String(item.stock));
    setPriceEditValue(String(item.price));
    setNameEditValue(item.name);
  }, [selectedItem?.id, items]);
  
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('0');
  const [newItemTag, setNewItemTag] = useState('');
  const [newItemStock, setNewItemStock] = useState('0');
  const [newItemGrams, setNewItemGrams] = useState('0');
  const [newItemImage, setNewItemImage] = useState(DEFAULT_INVENTORY_IMAGE);
  const [restockSearch, setRestockSearch] = useState('');
  const [restockItemId, setRestockItemId] = useState<string | null>(null);
  const [restockQty, setRestockQty] = useState('0');
  const [restockGrams, setRestockGrams] = useState('0');
  // Dark-mode Asset Hub: random white flashes every 10–40s
  useEffect(() => {
    if (!isOpen || !inventoryExpanded || isLight || selectedItem) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    let cancelled = false;
    let activeTimer: number | null = null;

    const scheduleNext = () => {
      const delayMs = 10_000 + Math.random() * 30_000; // 10–40s
      activeTimer = window.setTimeout(() => {
        if (cancelled) return;
        setAssetHubFlashKey((k) => k + 1);
        activeTimer = window.setTimeout(() => {
          if (!cancelled) scheduleNext();
        }, 220);
      }, delayMs);
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (activeTimer !== null) window.clearTimeout(activeTimer);
    };
  }, [isOpen, inventoryExpanded, isLight, selectedItem]);

  // Keyboard accessibility: close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (wholesaleDeleteConfirmId) {
          setWholesaleDeleteConfirmId(null);
        } else if (wholesaleHoldMenuId) {
          setWholesaleHoldMenuId(null);
        } else if (showWholesaleArchive) {
          setShowWholesaleArchive(false);
        } else if (showAssetMenu) {
          setShowAssetMenu(false);
          setAssetActionMode('add');
        } else if (cartOpen) {
          setCartOpen(false);
        } else if (namingUnidentified) {
          setNamingUnidentified(null);
        } else if (actionLogsExpanded) {
          setActionLogsExpanded(false);
          setShowActionLogSearch(false);
          setActionLogSearchQuery('');
        } else if (selectedItem && inventoryExpanded) {
          setSelectedItem(null);
        } else if (inventoryExpanded) {
          setSelectedItem(null);
          setInventoryExpanded(false);
        } else if (purchasesExpanded) {
          setPurchasesExpanded(false);
        } else if (avgCustomerExpanded) {
          setAvgCustomerExpanded(false);
        } else if (invoicesTodayExpanded) {
          setInvoicesTodayExpanded(false);
        } else if (monthlyRevExpanded) {
          setMonthlyRevExpanded(false);
        } else if (dailySalesExpanded) {
          setDailySalesExpanded(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // closeAssetAction defined later; Escape closes form via setState
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, onClose, showAssetMenu, cartOpen, namingUnidentified, actionLogsExpanded, selectedItem, inventoryExpanded, purchasesExpanded, avgCustomerExpanded, invoicesTodayExpanded, monthlyRevExpanded, dailySalesExpanded, wholesaleDeleteConfirmId, wholesaleHoldMenuId, showWholesaleArchive]);

  useEffect(() => {
    if (!canViewTransactions) {
      setPurchasesExpanded(false);
      setMonthlyRevExpanded(false);
      setDailySalesExpanded(false);
      setAvgCustomerExpanded(false);
      setInvoicesTodayExpanded(false);
    }
  }, [canViewTransactions]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setAvgCustomerExpanded(false);
      setInvoicesTodayExpanded(false);
      setMonthlyRevExpanded(false);
      setDailySalesExpanded(false);
      setVisionHubFocus(false);
    }
  }, [isOpen]);

  // Re-check printers when POS opens (may wake Bluetooth for printing).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        if (printerInstance.isConnected) return;
        // ensureConnected clears idle-suspend and allows BLE again
        const ok = await printerInstance.ensureConnected();
        if (cancelled || !ok) return;
        console.info(
          '[Printer] POS auto-connected',
          printerInstance.transport,
          printerInstance.getConnectedDeviceName()
        );
      } catch (err) {
        console.info(
          '[Printer] POS auto-scan idle',
          err instanceof Error ? err.message : String(err)
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const paidInvoiceCards = useMemo(() => {
    const latestPrintByInvoice = new Map<string, InvoicePrintLog>();
    for (const log of printLogs) {
      latestPrintByInvoice.set(log.invoiceName, log);
    }

    return [...latestPrintByInvoice.values()]
      .map((log) => {
        const logs = invoiceActionLogs.filter((l) => l.invoiceName === log.invoiceName);
        const items = log.items?.length
          ? log.items
          : logs.map((l) => ({ price: l.price, quantity: l.quantity, name: l.itemName }));
        const total = log.total ?? logs.reduce((s, l) => s + l.price * l.quantity, 0).toFixed(2);
        return {
          id: `paid-${log.invoiceName}`,
          name: log.invoiceName,
          items,
          logs,
          total,
          isCurrent: log.invoiceName === invoiceName,
          latestTimestamp: log.timestamp,
        };
      })
      .filter((card) => card.items.length > 0 || (parseFloat(card.total) || 0) > 0);
  }, [printLogs, invoiceActionLogs, invoiceName]);

  const currentBusinessDayKey = useMemo(() => getBusinessDayKey(currentTime), [currentTime]);

  const actionLogFollowTodayRef = useRef(true);
  // When the clock crosses 05:00, snap to the new day unless the user picked another date.
  useEffect(() => {
    if (actionLogFollowTodayRef.current) {
      setActionLogDayKey(currentBusinessDayKey);
    }
  }, [currentBusinessDayKey]);

  /** Preferred day range drives both Action Logs and dashboard stat cards. */
  const selectedDayRange = useMemo(() => businessDayRange(actionLogDayKey), [actionLogDayKey]);

  const monthStart = useMemo(() => {
    const [y, m] = actionLogDayKey.split('-').map(Number);
    return new Date(y, (m || 1) - 1, 1).getTime();
  }, [actionLogDayKey]);

  const stats = useMemo(() => {
    const { start, end } = selectedDayRange;
    const dayCards = paidInvoiceCards.filter(
      (c) => c.latestTimestamp >= start && c.latestTimestamp < end
    );
    const monthlyRev = paidInvoiceCards
      .filter((c) => c.latestTimestamp >= monthStart)
      .reduce((acc, c) => acc + (parseFloat(c.total) || 0), 0);
    const dailyRev = dayCards.reduce((acc, c) => acc + (parseFloat(c.total) || 0), 0);
    const totalRev = paidInvoiceCards.reduce((acc, c) => acc + (parseFloat(c.total) || 0), 0);
    const invoicesToday = dayCards.length;
    const customerCount = paidInvoiceCards.length;
    const avgPerCustomer = customerCount > 0 ? totalRev / customerCount : 0;
    const stockLevel = items.length > 0
      ? Math.round(items.reduce((acc, item) => acc + (item.stock / item.threshold) * 100, 0) / items.length)
      : 0;
    const criticalItems = items.filter((i) => i.stock < i.threshold).length;

    return { totalRev, monthlyRev, dailyRev, avgPerCustomer, invoicesToday, stockLevel, criticalItems };
  }, [paidInvoiceCards, items, monthStart, selectedDayRange]);

  const invoicesTodayList = useMemo(() => {
    const { start, end } = selectedDayRange;
    return paidInvoiceCards
      .filter((card) => card.latestTimestamp >= start && card.latestTimestamp < end)
      .sort((a, b) => b.latestTimestamp - a.latestTimestamp);
  }, [paidInvoiceCards, selectedDayRange]);

  const customerPrintCounts = useMemo(() => {
    const printCounts = new Map<string, number>();
    for (const log of printLogs) {
      printCounts.set(log.invoiceName, (printCounts.get(log.invoiceName) ?? 0) + 1);
    }

    const names = new Set<string>([invoiceName, ...invoiceActionLogs.map((l) => l.invoiceName)]);
    return [...names]
      .map((name) => ({
        name,
        printCount: printCounts.get(name) ?? 0,
        invoiceNum: parseInt(name.match(/Invoice #(\d+)/)?.[1] ?? '0', 10),
      }))
      .sort((a, b) => {
        if (a.invoiceNum && b.invoiceNum) return a.invoiceNum - b.invoiceNum;
        return a.name.localeCompare(b.name);
      });
  }, [printLogs, invoiceActionLogs, invoiceName]);

  const monthlyRevList = useMemo(() => {
    const rows: Array<{
      id: string;
      name: string;
      total: number;
      timestamp: number;
      items: CartLineItem[];
      kind: 'invoice' | 'purchase';
    }> = [];

    paidInvoiceCards
      .filter((c) => c.latestTimestamp >= monthStart)
      .forEach((c) => {
        rows.push({
          id: c.id,
          name: c.name,
          total: parseFloat(c.total) || 0,
          timestamp: c.latestTimestamp,
          items: c.items,
          kind: 'invoice',
        });
      });

    return rows.sort((a, b) => b.timestamp - a.timestamp);
  }, [paidInvoiceCards, monthStart]);

  const dailySalesList = useMemo(() => {
    const rows: Array<{
      id: string;
      name: string;
      total: number;
      timestamp: number;
      items: CartLineItem[];
      kind: 'invoice' | 'purchase';
    }> = [];

    const { start, end } = selectedDayRange;
    paidInvoiceCards
      .filter((c) => c.latestTimestamp >= start && c.latestTimestamp < end)
      .forEach((c) => {
        rows.push({
          id: c.id,
          name: c.name,
          total: parseFloat(c.total) || 0,
          timestamp: c.latestTimestamp,
          items: c.items,
          kind: 'invoice',
        });
      });

    return rows.sort((a, b) => b.timestamp - a.timestamp);
  }, [paidInvoiceCards, selectedDayRange]);

  const hubCollapsed = !inventoryExpanded && !purchasesExpanded
    && !avgCustomerExpanded && !invoicesTodayExpanded
    && !monthlyRevExpanded && !dailySalesExpanded && !actionLogsExpanded && !namingUnidentified;

  const printedInvoiceNames = useMemo(
    () => new Set(printLogs.map((log) => log.invoiceName)),
    [printLogs]
  );

  const hubInvoices = useMemo<HubInvoice[]>(() => {
    const grouped = new Map<string, InvoiceActionLog[]>();
    for (const log of invoiceActionLogs) {
      if (!grouped.has(log.invoiceName)) grouped.set(log.invoiceName, []);
      grouped.get(log.invoiceName)!.push(log);
    }

    const built: HubInvoice[] = [];
    for (const name of grouped.keys()) {
      if (name === invoiceName) continue;
      const logs = grouped.get(name)!;
      built.push({
        id: `past-${name}`,
        name,
        items: logs.map((l) => ({
          price: l.price,
          quantity: l.quantity,
          name: l.itemName,
        })),
        total: logs.reduce((s, l) => s + l.price * l.quantity, 0).toFixed(2),
        isCurrent: false,
        isPaid: printedInvoiceNames.has(name),
      });
    }

    built.push({
      id: 'current',
      name: invoiceName,
      items: cartItems,
      total: runningTotal,
      isCurrent: true,
      isPaid: printedInvoiceNames.has(invoiceName),
    });

    return built.filter((inv) => inv.isCurrent || inv.items.length > 0);
  }, [invoiceActionLogs, cartItems, invoiceName, runningTotal, printedInvoiceNames]);

  const latestPurchaseItems = useMemo(() => {
    if (purchases.length === 0) return [];
    const latestRecord = purchases[0]; 
    if (!latestRecord) return [];
    return [{
      id: latestRecord.id,
      name: latestRecord.itemName,
      price: latestRecord.total / latestRecord.quantity,
      quantity: latestRecord.quantity
    }];
  }, [purchases]);

  const latestPurchaseTotal = purchases.length > 0 ? purchases[0].total : 0;
  const latestPurchaseName = purchases.length > 0 ? purchases[0].itemName : 'Latest Transaction';

  /** Full durable feed — never wiped; print events included so stats and logs stay in sync. */
  const allSystemLogs = useMemo((): DashboardLogEntry[] => {
    const inventoryLogs: DashboardLogEntry[] = items.flatMap((item) =>
      item.activities.map((log) => ({
        id: log.id,
        timestamp: log.timestamp,
        action: log.action,
        itemName: item.name,
        type: log.type,
        isUnidentified: false,
        profileName: log.profileName,
        source: 'inventory' as const,
      }))
    );
    const invoiceLogs: DashboardLogEntry[] = invoiceActionLogs.map((log) => ({
      id: log.id,
      timestamp: log.timestamp,
      action: log.message,
      itemName: log.itemName ?? formatPriceLabel(log.price, currency),
      type: log.isUnidentified ? 'invoice-unidentified' as const : 'invoice-add' as const,
      isUnidentified: !!log.isUnidentified,
      price: log.price,
      quantity: log.quantity,
      invoiceName: log.invoiceName,
      profileName: log.profileName,
      source: 'invoice' as const,
    }));
    const printEntries: DashboardLogEntry[] = printLogs.map((log) => ({
      id: log.id,
      timestamp: log.timestamp,
      action: `Printed invoice ${log.invoiceName}`,
      itemName: formatCurrency(log.total),
      type: 'sale' as const,
      isUnidentified: false,
      invoiceName: log.invoiceName,
      source: 'invoice' as const,
    }));
    return [...inventoryLogs, ...invoiceLogs, ...printEntries].sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }, [items, invoiceActionLogs, printLogs, currency, formatCurrency]);

  const actionLogDayOptions = useMemo(() => {
    const keys = new Set<string>([currentBusinessDayKey]);
    for (const log of allSystemLogs) keys.add(getBusinessDayKey(log.timestamp));
    return [...keys].sort((a, b) => (a < b ? 1 : -1));
  }, [allSystemLogs, currentBusinessDayKey]);

  /** Visible logs for the selected business day (5am→5am). Older days stay stored. */
  const systemLogs = useMemo((): DashboardLogEntry[] => {
    const { start, end } = businessDayRange(actionLogDayKey);
    return allSystemLogs.filter((log) => log.timestamp >= start && log.timestamp < end);
  }, [allSystemLogs, actionLogDayKey]);

  const filteredActionLogs = useMemo(() => {
    const now = Date.now();
    const oneDay = 86400000;
    // Time-span filters look across all stored days; type filters stay on the selected day.
    const timeSpan =
      actionLogFilter === '24h' || actionLogFilter === '48h' || actionLogFilter === '7d';
    let result = [...(timeSpan ? allSystemLogs : systemLogs)];

    if (actionLogFilter === 'restock') {
      result = result.filter((log) => log.type === 'restock');
    } else if (actionLogFilter === 'sale') {
      result = result.filter((log) => log.type === 'sale');
    } else if (actionLogFilter === 'invoice') {
      result = result.filter(
        (log) =>
          log.type === 'invoice-add' ||
          log.type === 'invoice-unidentified' ||
          log.action.startsWith('Printed invoice')
      );
    } else if (actionLogFilter === 'unidentified') {
      result = result.filter((log) => log.isUnidentified);
    } else if (actionLogFilter === 'updates') {
      result = result.filter((log) => log.type === 'price-update' || log.type === 'stock-update');
    } else if (actionLogFilter === '24h') {
      result = result.filter((log) => now - log.timestamp <= oneDay);
    } else if (actionLogFilter === '48h') {
      result = result.filter((log) => now - log.timestamp <= oneDay * 2);
    } else if (actionLogFilter === '7d') {
      result = result.filter((log) => now - log.timestamp <= oneDay * 7);
    }

    const q = actionLogSearchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (log) =>
          log.action.toLowerCase().includes(q) ||
          (log.itemName?.toLowerCase().includes(q) ?? false) ||
          (log.invoiceName?.toLowerCase().includes(q) ?? false)
      );
    }

    return result;
  }, [allSystemLogs, systemLogs, actionLogFilter, actionLogSearchQuery]);

  const fallbackWholesaleId = defaultWholesaleId(wholesales);

  const activeWholesaleName = useMemo(
    () => wholesales.find((w) => w.id === activeWholesaleId)?.name ?? 'Wholesale',
    [wholesales, activeWholesaleId]
  );

  const filteredInventory = useMemo(() => {
    let result = items.filter(
      (item) => (item.wholesaleId || fallbackWholesaleId) === activeWholesaleId
    );
    if (searchQuery) {
      result = result.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    result.sort((a, b) => {
      if (sortOption === 'a-z') return a.name.localeCompare(b.name);
      if (sortOption === 'high-stock') return b.stock - a.stock;
      if (sortOption === 'low-stock') return a.stock - b.stock;
      return 0;
    });
    return result;
  }, [items, searchQuery, sortOption, activeWholesaleId, fallbackWholesaleId]);

  const beginRenameWholesale = useCallback(
    (id: string) => {
      const current = wholesales.find((w) => w.id === id);
      if (!current) return;
      setWholesaleHoldMenuId(null);
      setWholesaleHoldMenuPos(null);
      setRenamingWholesaleId(id);
      setRenamingWholesaleName(current.name);
    },
    [wholesales]
  );

  const commitRenameWholesale = useCallback(() => {
    if (!renamingWholesaleId) return;
    renameWholesale(renamingWholesaleId, renamingWholesaleName);
    setRenamingWholesaleId(null);
    setRenamingWholesaleName('');
  }, [renamingWholesaleId, renamingWholesaleName, renameWholesale]);

  const clearWholesaleHold = useCallback(() => {
    if (wholesaleHoldTimerRef.current) {
      clearTimeout(wholesaleHoldTimerRef.current);
      wholesaleHoldTimerRef.current = null;
    }
  }, []);

  const openWholesaleHoldMenu = useCallback((id: string, el: HTMLElement | null) => {
    if (!el) {
      setWholesaleHoldMenuId(id);
      setWholesaleHoldMenuPos(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setWholesaleHoldMenuPos({
      top: rect.bottom + 6,
      left: rect.left + rect.width / 2,
    });
    setWholesaleHoldMenuId(id);
    setWholesaleActionError(null);
  }, []);

  const startWholesaleHold = useCallback(
    (id: string, el: HTMLElement | null) => {
      clearWholesaleHold();
      wholesaleHoldFiredRef.current = false;
      wholesaleHoldTargetRef.current = id;
      wholesaleHoldTimerRef.current = setTimeout(() => {
        wholesaleHoldFiredRef.current = true;
        wholesaleHoldTimerRef.current = null;
        if ('vibrate' in navigator) navigator.vibrate(12);
        openWholesaleHoldMenu(id, el);
      }, WHOLESALE_HOLD_MS);
    },
    [clearWholesaleHold, openWholesaleHoldMenu]
  );

  const endWholesaleHold = useCallback(
    (id: string, select: boolean) => {
      clearWholesaleHold();
      if (wholesaleHoldFiredRef.current) {
        wholesaleHoldFiredRef.current = false;
        wholesaleHoldTargetRef.current = null;
        return;
      }
      wholesaleHoldTargetRef.current = null;
      if (select) {
        setActiveWholesaleId(id);
        setSelectedItem(null);
        setWholesaleHoldMenuId(null);
        setWholesaleHoldMenuPos(null);
      }
    },
    [clearWholesaleHold, setActiveWholesaleId]
  );

  const closeWholesaleHoldMenu = useCallback(() => {
    setWholesaleHoldMenuId(null);
    setWholesaleHoldMenuPos(null);
  }, []);

  useEffect(
    () => () => {
      clearWholesaleHold();
    },
    [clearWholesaleHold]
  );

  const handleAddWholesale = useCallback(() => {
    setWholesaleActionError(null);
    const created = addWholesale();
    if (created) {
      setSelectedItem(null);
      setRenamingWholesaleId(created.id);
      setRenamingWholesaleName(created.name);
    }
  }, [addWholesale]);

  const confirmArchiveWholesale = useCallback(() => {
    if (!wholesaleDeleteConfirmId) return;
    const result = archiveWholesale(wholesaleDeleteConfirmId);
    if (result.ok === false) {
      setWholesaleActionError(result.error);
      return;
    }
    setWholesaleDeleteConfirmId(null);
    setWholesaleHoldMenuId(null);
    setWholesaleActionError(null);
    setSelectedItem(null);
  }, [archiveWholesale, wholesaleDeleteConfirmId]);

  const wholesaleLists = wholesales?.length
    ? wholesales
    : [
        { id: 'wholesale-1', name: 'Wholesale 1' },
        { id: 'wholesale-2', name: 'Wholesale 2' },
        { id: 'wholesale-3', name: 'Wholesale 3' },
      ];
  const activeWholesaleIdx = Math.max(
    0,
    wholesaleLists.findIndex((w) => w.id === activeWholesaleId)
  );

  const measureWholesaleThumb = useCallback(() => {
    const track = wholesaleTrackRef.current;
    const btn = wholesaleBtnRefs.current[activeWholesaleIdx];
    if (!track || !btn) return;
    const trackRect = track.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    setWholesaleThumb({
      width: btnRect.width,
      left: btnRect.left - trackRect.left,
    });
    setWholesaleThumbReady(true);
  }, [activeWholesaleIdx]);

  useEffect(() => {
    measureWholesaleThumb();
    const track = wholesaleTrackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(() => measureWholesaleThumb());
    ro.observe(track);
    return () => ro.disconnect();
  }, [measureWholesaleThumb, wholesaleLists.length, activeWholesaleId, renamingWholesaleId]);

  /**
   * Equal-width fluid segment row + green add.
   * Tap selects; press-and-hold → Edit / Remove.
   */
  const renderWholesaleToggleBar = () => (
    <div className="w-full flex flex-col items-center gap-2">
      <div className="w-full max-w-lg flex items-center gap-2">
        <div
          ref={wholesaleTrackRef}
          className={`relative flex flex-1 min-w-0 items-stretch gap-0.5 p-0.5 rounded-[14px] fluid-segment ${
            isLight ? 'fluid-segment--light' : 'fluid-segment--dark'
          }`}
          role="tablist"
          aria-label="Wholesale inventory lists"
        >
          <span
            aria-hidden
            className={`fluid-segment-thumb absolute top-0.5 bottom-0.5 rounded-[11px] pointer-events-none z-0 ${
              wholesaleThumbReady ? 'fluid-segment-thumb--ready' : ''
            }`}
            style={{
              width: wholesaleThumb.width,
              transform: `translateX(${wholesaleThumb.left}px)`,
            }}
          />
          {wholesaleLists.map((list, index) => {
            const isActive = list.id === activeWholesaleId;
            const isRenaming = renamingWholesaleId === list.id;
            if (isRenaming) {
              return (
                <input
                  key={list.id}
                  autoFocus
                  value={renamingWholesaleName}
                  onChange={(e) => setRenamingWholesaleName(e.target.value)}
                  onBlur={commitRenameWholesale}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRenameWholesale();
                    }
                    if (e.key === 'Escape') {
                      setRenamingWholesaleId(null);
                      setRenamingWholesaleName('');
                    }
                  }}
                  aria-label="Rename wholesale list"
                  className={`relative z-10 flex-1 min-w-0 mx-0.5 px-2 py-2 rounded-[11px] font-black text-[10px] uppercase outline-none border text-center ${
                    isLight
                      ? 'bg-white border-zinc-300 text-zinc-900'
                      : 'bg-black/40 border-white/20 text-white'
                  }`}
                />
              );
            }
            return (
              <button
                key={list.id}
                ref={(el) => {
                  wholesaleBtnRefs.current[index] = el;
                }}
                type="button"
                role="tab"
                aria-selected={isActive}
                title="Tap to open · hold for Edit or Remove"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  startWholesaleHold(list.id, e.currentTarget);
                }}
                onPointerUp={() => endWholesaleHold(list.id, false)}
                onPointerCancel={() => clearWholesaleHold()}
                onPointerLeave={() => clearWholesaleHold()}
                onClick={() => {
                  if (wholesaleHoldFiredRef.current) {
                    wholesaleHoldFiredRef.current = false;
                    return;
                  }
                  setActiveWholesaleId(list.id);
                  setSelectedItem(null);
                  setWholesaleHoldMenuId(null);
                  setWholesaleHoldMenuPos(null);
                }}
                onContextMenu={(e) => e.preventDefault()}
                className={`relative z-10 flex-1 min-w-0 px-2 py-2 rounded-[11px] font-semibold text-[11px] truncate select-none touch-manipulation fluid-segment-btn ${
                  isActive
                    ? 'fluid-segment-btn--active text-white'
                    : `fluid-segment-btn--idle ${isLight ? 'text-zinc-700' : 'text-white/85'}`
                }`}
              >
                {list.name}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleAddWholesale}
          aria-label="Add wholesale list"
          className="shrink-0 h-10 w-10 rounded-full flex items-center justify-center font-black text-lg active:scale-95 transition-all bg-emerald-500 text-white shadow-md"
        >
          +
        </button>
      </div>

      <p className={`pos-subtext text-[9px] font-bold text-center ${isLight ? 'text-black/50' : 'text-white/50'}`}>
        {filteredInventory.length} item{filteredInventory.length !== 1 ? 's' : ''} in {activeWholesaleName}
        <span className="opacity-60"> · hold for edit / remove</span>
      </p>

      {wholesaleActionError && !wholesaleDeleteConfirmId && (
        <p className="text-center text-[10px] font-bold text-red-500">{wholesaleActionError}</p>
      )}
    </div>
  );

  const resetAssetFormFields = useCallback(() => {
    setNewItemName('');
    setNewItemPrice('0');
    setNewItemTag('');
    setNewItemStock('0');
    setNewItemGrams('0');
    setNewItemImage(DEFAULT_INVENTORY_IMAGE);
    setRestockSearch('');
    setRestockItemId(null);
    setRestockQty('0');
    setRestockGrams('0');
  }, []);

  const closeAssetAction = useCallback(() => {
    setShowAssetMenu(false);
    setAssetActionMode('add');
    resetAssetFormFields();
  }, [resetAssetFormFields]);

  /** Open single asset drawer (Add / Restock) with trio morph animation. */
  const openAssetAction = useCallback((mode: AssetActionMode = 'add') => {
    resetAssetFormFields();
    setAssetActionMode(mode);
    setShowAssetMenu(true);
  }, [resetAssetFormFields]);

  const toggleAssetMenu = useCallback(() => {
    setShowAssetMenu((open) => {
      if (open) {
        setAssetActionMode('add');
        resetAssetFormFields();
        return false;
      }
      setAssetActionMode('add');
      resetAssetFormFields();
      return true;
    });
  }, [resetAssetFormFields]);

  const readImageFileAsDataUrl = useCallback((file: File): Promise<string | null> => {
    if (!isLikelyImageFile(file)) return Promise.resolve(null);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(typeof reader.result === 'string' ? reader.result : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }, []);

  const handlePickItemImage = useCallback(
    async (file: File | null) => {
      if (!file) return;
      const dataUrl = await readImageFileAsDataUrl(file);
      if (dataUrl) setNewItemImage(dataUrl);
    },
    [readImageFileAsDataUrl]
  );

  const handleChooseItemPhoto = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      const result = await pickPhotoFromGallery();
      if (result.success && result.imageData) {
        setNewItemImage(result.imageData);
        return;
      }
      if (result.error) {
        console.warn('[iCalc] photo pick failed', result.error);
        alert(result.error);
      }
      return;
    }
    newItemImageInputRef.current?.click();
  }, []);

  const handleAddItem = () => {
    if (!newItemName.trim()) return;
    const now = new Date();
    const stock = Math.max(0, Math.floor(parseFloat(newItemStock) || 0));
    const grams = Math.max(0, parseFloat(newItemGrams) || 0);
    const newItem: InventoryItem = {
      id: crypto.randomUUID(),
      name: newItemName.trim(),
      stock,
      price: parseFloat(newItemPrice) || 0,
      threshold: 20,
      category: newItemTag.trim(),
      dateAdded: now.toLocaleDateString(),
      supplier: 'Generic Systems',
      lastStocked: now.toISOString(),
      image: newItemImage || DEFAULT_INVENTORY_IMAGE,
      grams,
      wholesaleId: activeWholesaleId || fallbackWholesaleId,
      activities: [{
        id: crypto.randomUUID(),
        type: 'restock',
        action: `Added item · stock ${stock}${grams > 0 ? ` · ${grams}g` : ''}`,
        time: 'Just now',
        timestamp: Date.now(),
        profileName: activeProfileName,
      }]
    };
    setItems(prev => [newItem, ...prev]);
    const hasPhoto = /^data:image\//i.test(newItem.image) || /^blob:/i.test(newItem.image);
    if (hasPhoto && accountId && isTelegramDbConnected(accountId)) {
      void telegramUploadItemImage({
        accountId,
        itemId: newItem.id,
        image: newItem.image,
        itemName: newItem.name,
      }).then((uploaded) => {
        if (uploaded.ok === false) {
          console.warn('[iCalc] new item image Telegram upload failed', uploaded.error);
          return;
        }
        setItems((prev) =>
          prev.map((row) => (row.id === newItem.id ? { ...row, image: uploaded.imageRef } : row))
        );
      });
    }
    onAccountNotify?.({
      kind: 'item_added',
      title: `Added ${newItem.name}`,
      body: `Stock ${stock}${grams > 0 ? ` · ${grams}g` : ''} · ${formatCurrency(String(newItem.price))}${
        hasPhoto ? ' · photo added' : ''
      }`,
    });
    closeAssetAction();
  };

  const restockSearchResults = useMemo(() => {
    const q = restockSearch.trim().toLowerCase();
    const list = items.filter(
      (item) => (item.wholesaleId || fallbackWholesaleId) === activeWholesaleId
    );
    if (!q) return list.slice(0, 8);
    return list
      .filter((item) => item.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [items, restockSearch, activeWholesaleId, fallbackWholesaleId]);

  const handleRestockExisting = () => {
    if (!restockItemId) return;
    const addQty = Math.max(0, Math.floor(parseFloat(restockQty) || 0));
    const grams = Math.max(0, parseFloat(restockGrams) || 0);
    if (addQty <= 0 && grams <= 0) return;
    const now = Date.now();
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== restockItemId) return item;
        const nextStock = item.stock + addQty;
        const nextGrams = grams > 0 ? grams : item.grams;
        return {
          ...item,
          stock: nextStock,
          grams: nextGrams,
          lastStocked: new Date(now).toISOString(),
          activities: [
            {
              id: crypto.randomUUID(),
              type: 'restock' as const,
              action: `Restocked +${addQty}${grams > 0 ? ` · ${grams}g` : ''} (now ${nextStock})`,
              time: 'Just now',
              timestamp: now,
              profileName: activeProfileName,
            },
            ...item.activities,
          ],
        };
      })
    );
    const restocked = items.find((i) => i.id === restockItemId);
    onAccountNotify?.({
      kind: 'item_restocked',
      title: `Restocked ${restocked?.name ?? 'item'}`,
      body: `+${addQty}${grams > 0 ? ` · ${grams}g` : ''}`,
    });
    closeAssetAction();
  };

  const getLogIcon = (type: DashboardLogEntry['type']) => {
    switch (type) {
      case 'restock': return <div className={`p-1.5 rounded-lg bg-blue-500/20 text-blue-500 ${iconLiftLight}`}><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg></div>;
      case 'sale': return <div className={`p-1.5 rounded-lg bg-green-500/20 text-green-500 ${iconLiftLight}`}><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="m17 5-5-3-5 3"/><path d="m17 19-5 3-5-3"/><path d="M2 12h20"/></svg></div>;
      case 'image-update': return <div className={`p-1.5 rounded-lg bg-purple-500/20 text-purple-500 ${iconLiftLight}`}><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>;
      case 'invoice-unidentified': return <div className={`p-1.5 rounded-lg bg-red-500/20 text-red-500 ${iconLiftLight}`}><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>;
      case 'invoice-add': return <div className={`p-1.5 rounded-lg bg-amber-500/20 text-amber-500 ${iconLiftLight}`}><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>;
      case 'price-update':
      case 'stock-update':
        return <div className={`p-1.5 rounded-lg bg-blue-500/20 text-blue-500 ${iconLiftLight}`}><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg></div>;
      default: return <div className={`p-1.5 rounded-lg ${iconLiftLight} ${isLight ? 'bg-black/10 text-black' : 'bg-white/10 text-white'}`}><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></div>;
    }
  };

  const openUnidentifiedPage = useCallback((log: DashboardLogEntry) => {
    const isUnidentifiedRow =
      !!log.isUnidentified || log.type === 'invoice-unidentified';
    if (!isUnidentifiedRow || log.price === undefined) return;
    setSelectedItem(null);
    setInventoryExpanded(false);
    setActionLogsExpanded(false);
    setNamingUnidentified({ price: log.price, quantity: log.quantity ?? 1 });
    setNewItemName('');
    setNewItemPrice(String(log.price));
    setNewItemTag('');
  }, []);

  const handleSaveUnidentifiedItem = useCallback(() => {
    if (!namingUnidentified || !newItemName.trim()) return;
    const now = Date.now();
    const price = namingUnidentified.price;
    const itemName = newItemName.trim();
    const newItem: InventoryItem = {
      id: crypto.randomUUID(),
      name: itemName,
      stock: 50,
      price,
      threshold: 20,
      category: newItemTag.trim(),
      dateAdded: new Date(now).toLocaleDateString(),
      supplier: 'Generic Systems',
      lastStocked: new Date(now).toISOString(),
      image: DEFAULT_INVENTORY_IMAGE,
      grams: 0,
      wholesaleId: activeWholesaleId || fallbackWholesaleId,
      activities: [{
        id: crypto.randomUUID(),
        type: 'restock',
        action: `Identified as "${itemName}" from invoice`,
        time: 'Just now',
        timestamp: now,
        profileName: activeProfileName,
      }],
    };
    setItems((prev) => [newItem, ...prev]);
    onResolveUnidentifiedPrice?.(price, itemName);
    setNamingUnidentified(null);
    setNewItemName('');
    setNewItemPrice('0');
    setNewItemTag('');
  }, [
    namingUnidentified,
    newItemName,
    newItemTag,
    setItems,
    onResolveUnidentifiedPrice,
    activeProfileName,
    activeWholesaleId,
    fallbackWholesaleId,
  ]);

  const levitateClass = isLight
    ? 'bg-white/90 shadow-[0_16px_36px_rgba(0,0,0,0.12)] hover:shadow-[0_24px_48px_rgba(0,0,0,0.16)] pos-dashboard-card-motion'
    : 'pos-dashboard-card-glass border border-white/10 hover:-translate-y-0.5 active:scale-[0.99] pos-dashboard-card-motion';

  const textColorClass = isLight ? 'text-black' : 'text-white';
  const cardSubtextClass = isLight ? 'text-black' : 'text-white';
  const cardSubtextMutedClass = isLight ? 'text-black/60' : 'text-white/60';
  const hubChipActiveClass = isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black';
  const hubChipInactiveClass = isLight ? 'bg-white text-black shadow-sm' : 'bg-black/50 text-white';
  const invertedBarSubtextClass = isLight ? 'text-white/70' : 'text-black/70';
  const heroSubtextClass = 'text-white';
  const panelSubtextClass = isLight ? 'text-black/60' : 'text-white/60';
  const iconLiftLight = 'pos-dashboard-icon-lift pos-dashboard-icon-lift--on-light';
  const iconLiftDark = 'pos-dashboard-icon-lift pos-dashboard-icon-lift--on-dark';
  const statDetailCardClass = isLight
    ? 'bg-zinc-900 text-white shadow-[0_16px_36px_rgba(0,0,0,0.28)]'
    : 'pos-dashboard-card-glass border border-white/10 text-white';
  const statDetailTextClass = 'text-white';
  const statDetailBorderClass = isLight ? 'border-white/15' : 'border-white/20';

  const commitStockUpdate = useCallback(
    (item: InventoryItem, rawValue: string) => {
      const parsed = Number.parseInt(rawValue, 10);
      if (Number.isNaN(parsed) || parsed < 0 || parsed === item.stock) {
        setStockEditValue(String(item.stock));
        return;
      }
      const now = Date.now();
      const action = `${item.name} updated from ${item.stock} to ${parsed}`;
      setItems((prev) =>
        prev.map((row) => {
          if (row.id !== item.id) return row;
          return {
            ...row,
            stock: parsed,
            activities: [
              {
                id: crypto.randomUUID(),
                type: 'stock-update' as const,
                action,
                time: 'Just now',
                timestamp: now,
                profileName: activeProfileName,
              },
              ...row.activities,
            ],
          };
        })
      );
      setStockEditValue(String(parsed));
      onAccountNotify?.({
        kind: 'stock_updated',
        title: `${item.name} stock changed`,
        body: `${item.stock} → ${parsed}`,
      });
    },
    [activeProfileName, onAccountNotify, setItems]
  );

  const commitNameUpdate = useCallback(
    (item: InventoryItem, rawValue: string) => {
      const next = rawValue.trim();
      if (!next) {
        setNameEditValue(item.name);
        return;
      }
      if (next === item.name) {
        setNameEditValue(item.name);
        return;
      }
      const duplicate = items.some(
        (row) =>
          row.id !== item.id &&
          (row.wholesaleId || fallbackWholesaleId) === (item.wholesaleId || fallbackWholesaleId) &&
          row.name.trim().toLowerCase() === next.toLowerCase()
      );
      if (duplicate) {
        setNameEditValue(item.name);
        alert('Another item already uses that name in this wholesale list.');
        return;
      }
      const now = Date.now();
      const action = `${item.name} renamed to ${next}`;
      setItems((prev) =>
        prev.map((row) => {
          if (row.id !== item.id) return row;
          return {
            ...row,
            name: next,
            activities: [
              {
                id: crypto.randomUUID(),
                type: 'stock-update' as const,
                action,
                time: formatActionLogStamp(now),
                timestamp: now,
                profileName: activeProfileName,
              },
              ...row.activities,
            ],
          };
        })
      );
      setNameEditValue(next);
      setSelectedItem((prev) => (prev?.id === item.id ? { ...prev, name: next } : prev));
      onAccountNotify?.({
        kind: 'stock_updated',
        title: `${item.name} renamed`,
        body: `${item.name} → ${next}`,
      });
    },
    [activeProfileName, fallbackWholesaleId, items, onAccountNotify, setItems]
  );

  const commitPriceUpdate = useCallback(
    (item: InventoryItem, rawValue: string) => {
      const parsed = Number.parseFloat(rawValue);
      if (Number.isNaN(parsed) || parsed < 0 || parsed === item.price) {
        setPriceEditValue(String(item.price));
        return;
      }
      const now = Date.now();
      const oldLabel = formatCurrency(String(item.price));
      const newLabel = formatCurrency(String(parsed));
      const action = `${item.name} changed from ${oldLabel} to ${newLabel}`;
      setItems((prev) =>
        prev.map((row) => {
          if (row.id !== item.id) return row;
          return {
            ...row,
            price: parsed,
            activities: [
              {
                id: crypto.randomUUID(),
                type: 'price-update' as const,
                action,
                time: 'Just now',
                timestamp: now,
                profileName: activeProfileName,
              },
              ...row.activities,
            ],
          };
        })
      );
      setPriceEditValue(String(parsed));
      onAccountNotify?.({
        kind: 'price_updated',
        title: `${item.name} price changed`,
        body: `${oldLabel} → ${newLabel}`,
      });
    },
    [activeProfileName, formatCurrency, onAccountNotify, setItems]
  );

  const commitImageUpdate = useCallback(
    (item: InventoryItem, imageDataUrl: string) => {
      if (!imageDataUrl || imageDataUrl === item.image) return;
      const now = Date.now();
      const action = `${item.name} photo updated`;
      // Optimistic local preview; replace with tgfile: after Telegram upload when linked.
      setItems((prev) =>
        prev.map((row) => {
          if (row.id !== item.id) return row;
          return {
            ...row,
            image: imageDataUrl,
            activities: [
              {
                id: crypto.randomUUID(),
                type: 'image-update' as const,
                action,
                time: 'Just now',
                timestamp: now,
                profileName: activeProfileName,
              },
              ...row.activities,
            ],
          };
        })
      );
      onAccountNotify?.({
        kind: 'image_updated',
        title: `${item.name} photo changed`,
        body: `${activeProfileName} updated the photo`,
      });

      if (accountId && isTelegramDbConnected(accountId)) {
        void telegramUploadItemImage({
          accountId,
          itemId: item.id,
          image: imageDataUrl,
          itemName: item.name,
        }).then((uploaded) => {
          if (uploaded.ok === false) {
            console.warn('[iCalc] item image Telegram upload failed', uploaded.error);
            return;
          }
          setItems((prev) =>
            prev.map((row) =>
              row.id === item.id ? { ...row, image: uploaded.imageRef } : row
            )
          );
        });
      }
    },
    [accountId, activeProfileName, onAccountNotify, setItems]
  );

  const editImageItemIdRef = useRef<string | null>(null);

  const handleEditItemImageFile = useCallback(
    async (file: File | null) => {
      const itemId = editImageItemIdRef.current;
      editImageItemIdRef.current = null;
      if (!file || !itemId) return;
      const item = items.find((i) => i.id === itemId);
      if (!item) return;
      const dataUrl = await readImageFileAsDataUrl(file);
      if (dataUrl) commitImageUpdate(item, dataUrl);
    },
    [items, readImageFileAsDataUrl, commitImageUpdate]
  );

  const handleChooseExistingItemPhoto = useCallback(
    async (item: InventoryItem) => {
      if (Capacitor.isNativePlatform()) {
        const result = await pickPhotoFromGallery();
        if (result.success && result.imageData) {
          commitImageUpdate(item, result.imageData);
          return;
        }
        if (result.error) {
          console.warn('[iCalc] photo pick failed', result.error);
          alert(result.error);
        }
        return;
      }
      editImageItemIdRef.current = item.id;
      editItemImageInputRef.current?.click();
    },
    [commitImageUpdate]
  );

  const getItemActivityLogs = (item: InventoryItem) => {
    const dayAgo = Date.now() - 86400000;
    return [...item.activities]
      .filter((log) => log.timestamp >= dayAgo)
      .sort((a, b) => b.timestamp - a.timestamp);
  };

  const handleLogRowClick = useCallback((log: DashboardLogEntry) => {
    // Unidentified (red) price — open name sheet with that price prefilled (e.g. 70).
    if (log.isUnidentified || log.type === 'invoice-unidentified') {
      openUnidentifiedPage(log);
      return;
    }
    if (log.action.startsWith('Added item')) {
      setInventoryExpanded(true);
      setSelectedItem(null);
      setActionLogsExpanded(false);
      openAssetAction('add');
      return;
    }
    setActionLogsExpanded(true);
  }, [openAssetAction, openUnidentifiedPage]);

  const renderActivityLogRows = (logs: DashboardLogEntry[], limit?: number, clickable = false) => {
    const slice = limit ? logs.slice(0, limit) : logs;
    if (slice.length === 0) {
      return (
        <p className={`app-subtext leading-relaxed ${cardSubtextMutedClass}`}>No recent activity</p>
      );
    }
    return (
      <div className="flex flex-col gap-3" role="list">
        {slice.map((log) => {
          const actorName = log.profileName ?? activeProfileName;
          const isUpdateLog = log.type === 'price-update' || log.type === 'stock-update';
          const lineText = log.itemName && !isUpdateLog ? `${log.action} · ${log.itemName}` : log.action;
          const rowClass = `action-log-row w-full min-w-0 text-left px-1 py-1.5 transition-all ${
            clickable ? 'cursor-pointer active:opacity-80' : ''
          }`;
          const rowContent = (
            <div className="flex items-start gap-2.5 min-w-0">
              {getLogIcon(log.type)}
              <div className="flex flex-col min-w-0 flex-1">
                <span
                  className={`app-subtext leading-relaxed truncate whitespace-nowrap ${
                    log.isUnidentified || log.type === 'invoice-unidentified'
                      ? 'text-red-500'
                      : log.type === 'invoice-add' &&
                          typeof log.action === 'string' &&
                          log.action.includes('has been added')
                        ? 'text-emerald-500'
                        : isUpdateLog
                          ? 'text-blue-500'
                          : textColorClass
                  }`}
                >
                  {lineText}
                </span>
                <span
                  className={`app-subtext leading-relaxed text-[10px] tabular-nums opacity-45 ${cardSubtextMutedClass}`}
                  style={{ letterSpacing: 0 }}
                >
                  {actorName} · {formatActionLogStamp(log.timestamp)} ·{' '}
                  {formatRequestElapsed(log.timestamp, currentTime)} ago
                </span>
              </div>
            </div>
          );
          if (!clickable) {
            return (
              <div key={log.id} role="listitem" className={rowClass}>
                {rowContent}
              </div>
            );
          }
          return (
            <button
              key={log.id}
              type="button"
              role="listitem"
              onClick={() => handleLogRowClick(log)}
              className={rowClass}
              aria-label={`${log.action}${log.itemName ? `, ${log.itemName}` : ''}`}
            >
              {rowContent}
            </button>
          );
        })}
      </div>
    );
  };

  const renderActionLogsPage = () => (
    <div className="morph-panel-content morph-panel-content--in space-y-8" role="tabpanel" aria-label="Action logs">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => {
            setActionLogsExpanded(false);
            setShowActionLogSearch(false);
            setActionLogSearchQuery('');
          }}
          aria-label="Back to Vision Hub"
          className={`${HUB_BACK_BTN} ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'}`}
        >
          <HubBackChevron /> Hub
        </button>
        <button
          type="button"
          onClick={() => setShowActionLogSearch((v) => !v)}
          className={`w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-all ${iconLiftLight} ${showActionLogSearch ? (isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black') : (isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/10 text-white')}`}
          aria-label="Search action logs"
        >
          <Icons.Search size={18} />
        </button>
      </div>
      <div className="flex items-center justify-between gap-3 px-1">
        <h3 className={`pos-dashboard-section-title text-4xl min-w-0 ${textColorClass}`}>Action Logs</h3>
        <label className="relative shrink-0 inline-flex items-center">
          <span className="sr-only">Action log date</span>
          <select
            value={actionLogDayKey}
            onChange={(e) => {
              const next = e.target.value;
              actionLogFollowTodayRef.current = next === currentBusinessDayKey;
              setActionLogDayKey(next);
            }}
            className={`appearance-none text-[10px] font-bold pl-2.5 pr-6 py-1 rounded-full outline-none cursor-pointer max-w-[11rem] ${
              isLight ? 'bg-black/5 text-zinc-800' : 'bg-white/10 text-white/90'
            }`}
            style={{ letterSpacing: 0 }}
            aria-label="Preferred action log date"
          >
            {actionLogDayOptions.map((key) => (
              <option key={key} value={key}>
                {formatBusinessDayOptionLabel(key, currentBusinessDayKey)}
              </option>
            ))}
          </select>
          <span className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] opacity-45 ${textColorClass}`} aria-hidden>
            ▾
          </span>
        </label>
      </div>
      <p className={`app-subtext leading-relaxed opacity-45 px-1 -mt-4 ${cardSubtextMutedClass}`} style={{ letterSpacing: 0 }}>
        {formatBusinessDayOptionLabel(actionLogDayKey, currentBusinessDayKey)} · day starts 5:00 AM
      </p>

      {showActionLogSearch && (
        <input
          type="search"
          value={actionLogSearchQuery}
          onChange={(e) => setActionLogSearchQuery(e.target.value)}
          placeholder="Search logs..."
          className={`w-full px-4 py-3 rounded-xl outline-none text-sm font-medium ${isLight ? 'bg-white text-black border border-black/8' : 'bg-white/10 text-white border border-white/10'}`}
          autoFocus
        />
      )}

      <div className="overflow-x-auto no-scrollbar pb-1">
        <FluidSegmentControl
          isLight={isLight}
          size="sm"
          variant="slide"
          ariaLabel="Filter action logs"
          value={actionLogFilter}
          onChange={(id) => setActionLogFilter(id as DashboardLogFilter)}
          options={(
            [
              { id: 'all', label: 'all' },
              { id: 'restock', label: 'restock' },
              { id: 'sale', label: 'sale' },
              { id: 'invoice', label: 'invoice' },
              { id: 'unidentified', label: 'Unidentified' },
              { id: 'updates', label: 'Updates' },
              { id: '24h', label: '24h' },
              { id: '48h', label: '48h' },
              { id: '7d', label: '7d' },
            ] as const
          ).map((opt) => ({ id: opt.id, label: opt.label }))}
        />
      </div>

      {filteredActionLogs.length > 0 ? (
        renderActivityLogRows(filteredActionLogs, undefined, true)
      ) : (
        <div className="p-12 text-center">
          <p className={`action-log-meta text-[10px] font-medium ${cardSubtextMutedClass}`}>No matching logs</p>
        </div>
      )}
    </div>
  );

  const renderNamingUnidentifiedPage = () => (
    <div className="morph-panel-content morph-panel-content--in space-y-8" role="tabpanel" aria-label="Name unidentified item">
      <button
        onClick={() => setNamingUnidentified(null)}
        aria-label="Back to action logs"
        className={`${HUB_BACK_BTN} ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'}`}
      >
        <HubBackChevron /> Back
      </button>
      <h3 className={`pos-dashboard-section-title text-4xl px-1 ${textColorClass}`}>New Item</h3>
      <p className={`text-sm px-1 -mt-4 text-red-500 font-bold`}>
        Unidentified price {formatPriceLabel(namingUnidentified!.price, currency)}
        {namingUnidentified!.quantity > 1 ? ` × ${namingUnidentified!.quantity}` : ''}
      </p>
      <div className={`rounded-2xl p-8 space-y-6 ${levitateClass} ${textColorClass}`}>
        <input
          type="text"
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          placeholder="Item name"
          className={formInputClass(isLight, { size: 'lg' })}
          autoFocus
        />
        <div className="grid grid-cols-2 gap-4">
          <input
            type="number"
            value={newItemPrice}
            readOnly
            className={formInputClass(isLight, { size: 'lg', className: 'opacity-70' })}
            aria-label="Price from invoice"
          />
          <input
            type="text"
            value={newItemTag}
            onChange={(e) => setNewItemTag(e.target.value)}
            placeholder="Tag (optional)"
            aria-label="Item tag for identification"
            className={formInputClass(isLight, { size: 'lg' })}
          />
        </div>
        <button
          type="button"
          onClick={handleSaveUnidentifiedItem}
          disabled={!newItemName.trim()}
          className="w-full py-6 rounded-2xl text-black font-black uppercase text-[11px] active:scale-95 shadow-2xl transition-all disabled:opacity-40"
          style={{ backgroundColor: accentColor }}
        >
          Add Item & Update Log
        </button>
      </div>
    </div>
  );

  const openInventoryItem = useCallback((item: InventoryItem) => {
    setSelectedItem(item);
  }, []);

  const addProductToCart = useCallback(
    (item: InventoryItem) => {
      if (!onAddProductToCart) {
        openInventoryItem(item);
        return;
      }
      onAddProductToCart(item.price);
      setCartOpen(true);
    },
    [onAddProductToCart, openInventoryItem]
  );

  const clearItemLongPress = useCallback(() => {
    if (itemLongPressTimer.current) {
      clearTimeout(itemLongPressTimer.current);
      itemLongPressTimer.current = null;
    }
  }, []);

  const startItemLongPress = useCallback(
    (item: InventoryItem) => {
      itemLongPressFired.current = false;
      clearItemLongPress();
      itemLongPressTimer.current = setTimeout(() => {
        itemLongPressFired.current = true;
        openInventoryItem(item);
      }, 480);
    },
    [clearItemLongPress, openInventoryItem]
  );

  const handleItemTap = useCallback(
    (item: InventoryItem) => {
      if (itemLongPressFired.current) {
        itemLongPressFired.current = false;
        return;
      }
      addProductToCart(item);
    },
    [addProductToCart]
  );

  const cartLineCount = cartItems.reduce((sum, line) => sum + (line.quantity || 0), 0);

  const renderInventoryListRow = (item: InventoryItem, idx: number) => (
    <button
      key={item.id}
      type="button"
      role="listitem"
      aria-label={`Add ${item.name} to cart. Long-press for details. Stock ${item.stock}, price ¢${item.price}`}
      onClick={() => handleItemTap(item)}
      onPointerDown={() => startItemLongPress(item)}
      onPointerUp={clearItemLongPress}
      onPointerCancel={clearItemLongPress}
      onPointerLeave={clearItemLongPress}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left active:scale-[0.99] transition-all pos-dashboard-glass-btn ${
        isLight ? 'pos-dashboard-glass-btn--light' : 'pos-dashboard-glass-btn--dark'
      }`}
    >
      <div className="h-12 w-12 shrink-0 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        <InventoryItemImage
          image={item.image}
          alt={item.name}
          accountId={accountId}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-[12px] font-black truncate ${textColorClass}`}>{item.name}</p>
        <p className={`app-subtext text-[10px] opacity-55 ${cardSubtextMutedClass}`} style={{ letterSpacing: 0 }}>
          Stock {item.stock}
          {(item.grams ?? 0) > 0 ? ` · ${item.grams}g` : ''}
        </p>
      </div>
      <p className={`text-[12px] font-black tabular-nums shrink-0 ${textColorClass}`}>¢{item.price}</p>
    </button>
  );

  const renderInventoryProductTile = (item: InventoryItem, idx: number) => (
    <div key={item.id} className="flex flex-col gap-1.5 min-w-0">
      <div
        role="listitem"
        tabIndex={0}
        aria-label={`Add ${item.name} to cart. Long-press for details. Stock ${item.stock}, price ¢${item.price}`}
        onClick={() => handleItemTap(item)}
        onPointerDown={() => startItemLongPress(item)}
        onPointerUp={clearItemLongPress}
        onPointerCancel={clearItemLongPress}
        onPointerLeave={clearItemLongPress}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleItemTap(item);
          }
        }}
        className={`group rounded-xl overflow-hidden cursor-pointer ${levitateClass} relative focus:outline-none focus:ring-2 focus:ring-white/40`}
      >
        <div className="relative aspect-square overflow-hidden bg-zinc-100 dark:bg-zinc-800">
          <InventoryItemImage image={item.image} alt={item.name} accountId={accountId} className="w-full h-full object-cover" />
          <div className="absolute top-2 right-2 flex flex-col items-end gap-1" aria-hidden="true">
            <div
              className={`pos-subtext px-2 py-1 rounded-lg text-[9px] font-black backdrop-blur-3xl shadow-xl ${
                item.stock < item.threshold ? 'bg-red-500 text-white' : 'bg-black/60 text-white'
              }`}
            >
              {item.stock}
            </div>
            {(item.grams ?? 0) > 0 && (
              <div className="pos-subtext px-2 py-1 rounded-lg text-[8px] font-black backdrop-blur-3xl shadow-xl bg-black/50 text-white">
                {item.grams}g
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="px-0.5 min-w-0">
        <p
          className={`text-[11px] font-black leading-tight truncate ${textColorClass}`}
          title={item.name}
        >
          {item.name}
        </p>
        <p className={`text-[10px] font-black tabular-nums ${cardSubtextMutedClass}`}>
          ¢{item.price}
        </p>
      </div>
    </div>
  );

  const renderInventoryItemPage = () => {
    const item = items.find((i) => i.id === selectedItem!.id) ?? selectedItem!;
    const logs: DashboardLogEntry[] = getItemActivityLogs(item).map((log) => ({
      id: log.id,
      timestamp: log.timestamp,
      action: log.action,
      itemName: item.name,
      type: log.type,
      profileName: log.profileName,
      source: 'inventory',
    }));

    return (
      <div className="morph-panel-content morph-panel-content--in space-y-8" role="tabpanel" aria-label={`${item.name} details`}>
        <button
          onClick={() => setSelectedItem(null)}
          aria-label="Back to Assets Hub"
          className={`${HUB_BACK_BTN} ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'}`}
        >
          <HubBackChevron /> Assets Hub
        </button>

        <div className={`rounded-2xl overflow-hidden ${levitateClass}`}>
          <div className="relative h-56 sm:h-72">
            <InventoryItemImage image={item.image} alt={item.name} accountId={accountId} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent" aria-hidden="true" />
            {(canEditStock || canEditPrice) && (
              <button
                type="button"
                onClick={() => void handleChooseExistingItemPhoto(item)}
                className="absolute top-3 right-3 z-10 w-11 h-11 rounded-full flex items-center justify-center bg-black/55 text-white backdrop-blur-sm border border-white/20 active:scale-90 transition-transform"
                aria-label={`Change image for ${item.name}`}
                title="Change image"
              >
                <Icons.Pencil size={18} />
              </button>
            )}
            <input
              ref={editItemImageInputRef}
              id="asset-item-edit-image-input"
              type="file"
              accept={PHOTO_ACCEPT}
              onChange={(e) => {
                void handleEditItemImageFile(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
              aria-hidden="true"
              tabIndex={-1}
              className="sr-only"
            />
          </div>
          <div className={`p-8 space-y-8 ${textColorClass}`}>
            <div className="flex justify-between items-start gap-4">
              {canEditName ? (
                <input
                  type="text"
                  value={nameEditValue}
                  onChange={(e) => setNameEditValue(e.target.value)}
                  onBlur={() => commitNameUpdate(item, nameEditValue)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                      setNameEditValue(item.name);
                      e.currentTarget.blur();
                    }
                  }}
                  className={`pos-dashboard-section-title text-4xl leading-tight w-full min-w-0 bg-transparent border-b-2 outline-none ${textColorClass} ${
                    isLight ? 'border-black/15' : 'border-white/20'
                  }`}
                  aria-label={`Edit name for ${item.name}`}
                />
              ) : (
                <h3 className="pos-dashboard-section-title text-4xl leading-tight">{item.name}</h3>
              )}
              {item.category ? (
                <span className={`px-5 py-2 rounded-2xl pos-subtext text-[10px] font-black shrink-0 ${cardSubtextClass} ${isLight ? 'bg-zinc-100' : 'bg-white/10'}`}>{item.category}</span>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-8">
              <div>
                <p className={`pos-subtext text-[10px] font-black mb-2 ${cardSubtextMutedClass}`}>Available in stocks</p>
                {canEditStock ? (
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={stockEditValue}
                    onChange={(e) => setStockEditValue(e.target.value)}
                    onBlur={() => commitStockUpdate(item, stockEditValue)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    className={`w-full max-w-[8rem] text-3xl font-black bg-transparent border-b-2 outline-none tabular-nums ${
                      item.stock < item.threshold ? 'text-red-500 border-red-500/40' : `${textColorClass} ${isLight ? 'border-black/15' : 'border-white/20'}`
                    }`}
                    aria-label={`Edit stock for ${item.name}`}
                  />
                ) : (
                  <p className={`text-3xl font-black ${item.stock < item.threshold ? 'text-red-500' : ''}`}>{item.stock}</p>
                )}
                {(item.grams ?? 0) > 0 && (
                  <p className={`pos-subtext text-[11px] font-black mt-2 ${cardSubtextMutedClass}`}>{item.grams} g</p>
                )}
              </div>
              <div>
                <p className={`pos-subtext text-[10px] font-black mb-2 ${cardSubtextMutedClass}`}>Price</p>
                {canEditPrice ? (
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-3xl font-black ${textColorClass}`}>¢</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={priceEditValue}
                      onChange={(e) => setPriceEditValue(e.target.value)}
                      onBlur={() => commitPriceUpdate(item, priceEditValue)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur();
                        }
                      }}
                      className={`w-full max-w-[10rem] text-3xl font-black bg-transparent border-b-2 outline-none tabular-nums ${textColorClass} ${isLight ? 'border-black/15' : 'border-white/20'}`}
                      aria-label={`Edit price for ${item.name}`}
                    />
                  </div>
                ) : (
                  <p className="text-3xl font-black">¢{item.price}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className={`rounded-2xl p-6 ${levitateClass}`}>
          <h4 className={`pos-dashboard-section-title text-xl mb-4 ${textColorClass}`}>Action Logs</h4>
          {renderActivityLogRows(logs, undefined, true)}
        </div>
      </div>
    );
  };

  return (
    <div className={`pos-dashboard-root fixed inset-0 z-200 flex flex-col ${isOpen ? 'pos-dashboard-root--open' : 'pos-dashboard-root--closed'}`}>
      <div className={`pos-dashboard pos-dashboard-shell relative w-full h-full flex flex-col ${isLight ? 'pos-dashboard-shell--light' : 'pos-dashboard-shell--dark'} ${visionHubFocus ? 'pos-dashboard-shell--hub-focus' : ''}`}>

        {hubCollapsed && (
          <VisionHubPrintPanel
            isLight={isLight}
            invertedBarSubtextClass={invertedBarSubtextClass}
            currentTimeLabel={currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            currency={currency}
            formatCurrency={formatCurrency}
            accentColor={accentColor}
            invoices={hubInvoices}
            attendantName={activeProfileName}
            onInvoicePrinted={canViewTransactions ? onInvoicePrinted : undefined}
            printDrawerEnabled={canViewTransactions}
            onInteractionChange={setVisionHubFocus}
            onThemeToggle={() => { updateSettings('themeMode', isLight ? 'dark' : 'light'); setIsThemeAnimating(true); }}
            onSettingsOpen={() => { setIsSettingsOpen(true); setIsSettingsAnimating(true); }}
            onCloseDashboard={() => { onClose(); setIsCloseAnimating(true); }}
            isThemeAnimating={isThemeAnimating}
            isSettingsAnimating={isSettingsAnimating}
            isCloseAnimating={isCloseAnimating}
            onThemeAnimationEnd={() => setIsThemeAnimating(false)}
            onSettingsAnimationEnd={() => setIsSettingsAnimating(false)}
            onCloseAnimationEnd={() => setIsCloseAnimating(false)}
            drawerMode="click"
            businessName={typeof settings.businessName === 'string' ? settings.businessName : ''}
            businessPhone={typeof settings.businessPhone === 'string' ? settings.businessPhone : ''}
            businessAddress={typeof settings.businessAddress === 'string' ? settings.businessAddress : ''}
          />
        )}

        {/* MAIN SCROLLABLE CONTENT */}
        <div className={`pos-dashboard-hub-blur-target flex-1 overflow-y-auto px-6 space-y-10 custom-scrollbar pb-16 scroll-smooth`}>
          {hubCollapsed ? (
            <div className="grid grid-cols-2 gap-6 pt-4">
              
              {/* PERFORMANCE MICRO CARDS — real values for @admin, masked for mini-profiles */}
              <div className="col-span-2 grid grid-cols-2 gap-5">
                {[
                  { label: 'This month', hint: null as string | null, val: formatCurrency(stats.monthlyRev.toFixed(2)), onClick: () => setMonthlyRevExpanded(true) },
                  { label: 'Sales', hint: formatBusinessDayLabel(actionLogDayKey), val: formatCurrency(stats.dailyRev.toFixed(2)), onClick: () => setDailySalesExpanded(true) },
                  { label: 'Avg / customer', hint: null, val: formatCurrency(stats.avgPerCustomer.toFixed(2)), onClick: () => setAvgCustomerExpanded(true) },
                  { label: 'Invoices', hint: formatBusinessDayLabel(actionLogDayKey), val: String(stats.invoicesToday), onClick: () => setInvoicesTodayExpanded(true) },
                ].map((card, idx) => (
                  <div
                    key={idx}
                    onClick={canViewTransactions ? card.onClick : undefined}
                    className={`p-7 rounded-xl ${levitateClass} pos-dashboard-glass-btn ${
                      isLight ? 'pos-dashboard-glass-btn--light' : 'pos-dashboard-glass-btn--dark'
                    } ${canViewTransactions ? 'cursor-pointer active:scale-[0.98]' : 'opacity-75'}`}
                    role={canViewTransactions ? 'button' : undefined}
                    tabIndex={canViewTransactions ? 0 : undefined}
                    onKeyDown={canViewTransactions ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.onClick!(); } } : undefined}
                    aria-label={canViewTransactions ? `${card.label}${card.hint ? `, ${card.hint}` : ''}` : `${card.label}, admin only`}
                  >
                    <p className={`pos-subtext text-[9px] font-black mb-2 ${cardSubtextMutedClass}`}>{card.label}</p>
                    <p
                      className="text-2xl font-black "
                      style={{ color: canViewTransactions ? accentColor : undefined }}
                    >
                      {canViewTransactions ? card.val : '*****'}
                    </p>
                    {canViewTransactions && card.hint ? (
                      <p className={`pos-subtext text-[8px] font-bold mt-1 ${cardSubtextMutedClass}`} style={{ letterSpacing: 0 }}>{card.hint}</p>
                    ) : !canViewTransactions ? (
                      <p className={`pos-subtext text-[8px] font-black mt-1 ${cardSubtextMutedClass}`}>@admin only</p>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* INVENTORY MASTER CARD - TEXTS FITTED MARGINALLY */}
              <div onClick={() => setInventoryExpanded(true)} className={`col-span-2 aspect-16/10 rounded-2xl ${levitateClass} relative overflow-hidden group cursor-pointer active:scale-[0.98]`}>
                <img src={WALLPAPER_IMAGE_URLS[3]} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110 opacity-70 dark:opacity-50" />
                <div className="absolute inset-x-0 bottom-0 h-[65%] bg-linear-to-t from-black/95 via-black/30 to-transparent pointer-events-none" />
                <div className="absolute inset-0 p-8 flex flex-col justify-between">
                  <div className="flex items-center gap-5 translate-y-2">
                    <div className={`p-4 rounded-[13px] bg-orange-500/20 text-orange-500 backdrop-blur-3xl border border-white/10 ${iconLiftDark}`}><Icons.Scientific size={28} /></div>
                    <span className={`pos-subtext text-[10px] font-black opacity-90 drop-shadow-md ${heroSubtextClass}`}>Stock health</span>
                  </div>
                  <div className="space-y-1 relative z-10 translate-y-2">
                    <div className="flex items-end justify-between">
                      <div className="text-7xl font-black text-white drop-shadow-[0_8px_24px_rgba(0,0,0,0.7)]">{stats.stockLevel}%</div>
                      <div className="text-right pb-3">
                        <p className={`pos-subtext text-[9px] font-black mb-1.5 ${heroSubtextClass}`}>Low stock</p>
                        <div className={`pos-subtext px-4 py-1.5 rounded-full text-[9px] font-black backdrop-blur-3xl shadow-2xl ${stats.criticalItems > 0 ? 'bg-red-500/80 text-white' : 'bg-green-500/80 text-white'}`}>
                          {stats.criticalItems === 0
                            ? 'All good'
                            : `${stats.criticalItems} low`}
                        </div>
                      </div>
                    </div>
                    <div className="pt-2">
                      <p className={`app-subtext leading-relaxed max-w-[280px] ${heroSubtextClass}`}>
                        Compared with each item’s restock level
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* ACTION LOGS */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setActionLogsExpanded(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActionLogsExpanded(true); } }}
                className={`col-span-2 p-7 rounded-2xl text-left cursor-pointer active:scale-[0.99] transition-all pos-dashboard-glass-btn ${
                  isLight ? 'pos-dashboard-glass-btn--light' : 'pos-dashboard-glass-btn--dark'
                } ${levitateClass}`}
                aria-label="Open all action logs"
              >
                <div className="flex justify-between items-center gap-2 mb-6">
                   <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className={`pos-dashboard-section-title text-2xl ${textColorClass}`}>Action Logs</h3>
                        <label
                          className="relative inline-flex items-center shrink-0"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <span className="sr-only">Action log date</span>
                          <select
                            value={actionLogDayKey}
                            onChange={(e) => {
                              const next = e.target.value;
                              actionLogFollowTodayRef.current = next === currentBusinessDayKey;
                              setActionLogDayKey(next);
                            }}
                            className={`appearance-none text-[10px] font-bold pl-2.5 pr-6 py-1 rounded-full outline-none cursor-pointer max-w-[10.5rem] ${
                              isLight ? 'bg-black/5 text-zinc-800' : 'bg-white/10 text-white/90'
                            }`}
                            style={{ letterSpacing: 0 }}
                            aria-label="Preferred action log date"
                          >
                            {actionLogDayOptions.map((key) => (
                              <option key={key} value={key}>
                                {formatBusinessDayOptionLabel(key, currentBusinessDayKey)}
                              </option>
                            ))}
                          </select>
                          <span
                            className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] opacity-45 ${textColorClass}`}
                            aria-hidden
                          >
                            ▾
                          </span>
                        </label>
                      </div>
                      <p className={`app-subtext leading-relaxed opacity-45 ${cardSubtextMutedClass}`} style={{ letterSpacing: 0 }}>
                        From 5:00 AM
                      </p>
                   </div>
                   <div className={`p-3.5 rounded-full bg-blue-500/10 text-blue-500 shrink-0 ${iconLiftLight}`}><Icons.Trends size={24} /></div>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  {systemLogs.length > 0 ? (
                    renderActivityLogRows(systemLogs, 8, true)
                  ) : (
                    <div className="py-16 text-center space-y-3">
                       <p className={`app-subtext leading-relaxed opacity-45 ${cardSubtextMutedClass}`}>
                         No activity for {formatBusinessDayLabel(actionLogDayKey)}
                       </p>
                    </div>
                  )}
                </div>
              </div>

            </div>
          ) : namingUnidentified ? (
            <div key="naming-unidentified" className="pos-dashboard-panel-enter">
              {renderNamingUnidentifiedPage()}
            </div>
          ) : actionLogsExpanded ? (
            <div key="action-logs" className="pos-dashboard-panel-enter">
              {renderActionLogsPage()}
            </div>
          ) : canViewTransactions && monthlyRevExpanded ? (
            <div key="monthly-rev" className={`pos-dashboard-panel-enter morph-panel-content morph-panel-content--in space-y-8 ${textColorClass}`} role="tabpanel" aria-label="Monthly revenue">
              <button
                onClick={() => setMonthlyRevExpanded(false)}
                aria-label="Back to Vision Hub"
                className={`${HUB_BACK_BTN} ${isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'}`}
              >
                <HubBackChevron /> Hub
              </button>
              <h3 className={`pos-dashboard-section-title text-4xl px-2 ${textColorClass}`}>Monthly Revenue</h3>
              <p className={`pos-subtext text-[10px] px-1 -mt-4 ${cardSubtextMutedClass}`}>{formatCurrency(stats.monthlyRev.toFixed(2))} this month</p>
              <div className={`rounded-2xl overflow-hidden relative ${statDetailCardClass}`}>

                <div className="relative">
                {monthlyRevList.length > 0 ? (
                  monthlyRevList.map((row, idx) => (
                    <div
                      key={row.id}
                      className={`px-8 py-7 ${idx !== monthlyRevList.length - 1 ? `border-b ${statDetailBorderClass}` : ''}`}
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <div className={`pos-subtext text-[10px] font-black mb-0.5 ${statDetailTextClass}`}>
                            {row.kind === 'invoice' ? 'Invoice' : 'Sale'}
                          </div>
                          <div className={`text-lg font-black truncate ${statDetailTextClass}`}>{row.name}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-base font-black" style={{ color: accentColor }}>{formatCurrency(row.total.toFixed(2))}</div>
                        </div>
                      </div>
                      <div className={`pos-subtext text-[10px] font-black mb-3 ${statDetailTextClass}`}>
                        {new Date(row.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="space-y-1.5">
                        {row.items.map((item, i) => (
                          <div key={i} className={`flex items-center justify-between text-sm font-semibold ${statDetailTextClass}`}>
                            <span>{formatPosLineItemDisplay(item, currency)}</span>
                            <span className="text-xs">{currency} {(item.price * item.quantity).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center">
                    <p className={`pos-subtext text-[10px] font-black ${statDetailTextClass}`}>No revenue this month</p>
                  </div>
                )}
                </div>
              </div>
            </div>
          ) : canViewTransactions && dailySalesExpanded ? (
            <div key="daily-sales" className={`pos-dashboard-panel-enter morph-panel-content morph-panel-content--in space-y-8 ${textColorClass}`} role="tabpanel" aria-label="Daily sales">
              <button
                onClick={() => setDailySalesExpanded(false)}
                aria-label="Back to Vision Hub"
                className={`${HUB_BACK_BTN} ${isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'}`}
              >
                <HubBackChevron /> Hub
              </button>
              <h3 className={`pos-dashboard-section-title text-4xl px-2 ${textColorClass}`}>Daily Sales</h3>
              <p className={`pos-subtext text-[10px] px-1 -mt-4 ${cardSubtextMutedClass}`}>{formatCurrency(stats.dailyRev.toFixed(2))} · {formatBusinessDayLabel(actionLogDayKey)}</p>
              <div className={`rounded-2xl overflow-hidden relative ${statDetailCardClass}`}>

                <div className="relative">
                {dailySalesList.length > 0 ? (
                  dailySalesList.map((row, idx) => (
                    <div
                      key={row.id}
                      className={`px-8 py-7 ${idx !== dailySalesList.length - 1 ? `border-b ${statDetailBorderClass}` : ''}`}
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <div className={`pos-subtext text-[10px] font-black mb-0.5 ${statDetailTextClass}`}>
                            {row.kind === 'invoice' ? 'Invoice' : 'Sale'}
                          </div>
                          <div className={`text-lg font-black truncate ${statDetailTextClass}`}>{row.name}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-base font-black" style={{ color: accentColor }}>{formatCurrency(row.total.toFixed(2))}</div>
                        </div>
                      </div>
                      <div className={`pos-subtext text-[10px] font-black mb-3 ${statDetailTextClass}`}>
                        {new Date(row.timestamp).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="space-y-1.5">
                        {row.items.map((item, i) => (
                          <div key={i} className={`flex items-center justify-between text-sm font-semibold ${statDetailTextClass}`}>
                            <span>{formatPosLineItemDisplay(item, currency)}</span>
                            <span className="text-xs">{currency} {(item.price * item.quantity).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center">
                    <p className={`pos-subtext text-[10px] font-black ${statDetailTextClass}`}>No sales today</p>
                  </div>
                )}
                </div>
              </div>
            </div>
          ) : canViewTransactions && avgCustomerExpanded ? (
            <div key="avg-customer" className={`pos-dashboard-panel-enter morph-panel-content morph-panel-content--in space-y-8 ${textColorClass}`} role="tabpanel" aria-label="Customer print history">
              <button
                onClick={() => setAvgCustomerExpanded(false)}
                aria-label="Back to Vision Hub"
                className={`${HUB_BACK_BTN} ${isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'}`}
              >
                <HubBackChevron /> Hub
              </button>
              <h3 className={`pos-dashboard-section-title text-4xl px-2 ${textColorClass}`}>Customers</h3>
              <p className={`pos-subtext text-[10px] px-1 -mt-4 ${cardSubtextMutedClass}`}>Invoice names • print count</p>
              <div className={`rounded-2xl overflow-hidden relative ${statDetailCardClass}`}>

                <div className="relative">
                {customerPrintCounts.length > 0 ? (
                  customerPrintCounts.map((customer, idx) => (
                    <div
                      key={customer.name}
                      className={`px-8 py-7 flex items-center justify-between gap-4 ${idx !== customerPrintCounts.length - 1 ? `border-b ${statDetailBorderClass}` : ''}`}
                    >
                      <div className={`font-black text-lg ${statDetailTextClass}`}>{customer.name}</div>
                      <div className="text-right shrink-0">
                        <div className={`pos-subtext text-[10px] font-black ${statDetailTextClass}`}>Printed</div>
                        <div className="text-2xl font-black" style={{ color: accentColor }}>{customer.printCount}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center">
                    <p className={`pos-subtext text-[10px] font-black ${statDetailTextClass}`}>No customers yet</p>
                  </div>
                )}
                </div>
              </div>
            </div>
          ) : canViewTransactions && invoicesTodayExpanded ? (
            <div key="invoices-today" className={`pos-dashboard-panel-enter morph-panel-content morph-panel-content--in space-y-8 ${textColorClass}`} role="tabpanel" aria-label="Invoices today">
              <button
                onClick={() => setInvoicesTodayExpanded(false)}
                aria-label="Back to Vision Hub"
                className={`${HUB_BACK_BTN} ${isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'}`}
              >
                <HubBackChevron /> Hub
              </button>
              <h3 className={`pos-dashboard-section-title text-4xl px-2 ${textColorClass}`}>Invoices</h3>
              <p className={`pos-subtext text-[10px] px-1 -mt-4 ${cardSubtextMutedClass}`}>{formatBusinessDayLabel(actionLogDayKey)}</p>
              <div className={`rounded-2xl overflow-hidden relative ${statDetailCardClass}`}>

                <div className="relative">
                {invoicesTodayList.length > 0 ? (
                  invoicesTodayList.map((card, idx) => (
                    <div
                      key={card.id}
                      className={`px-8 py-7 ${idx !== invoicesTodayList.length - 1 ? `border-b ${statDetailBorderClass}` : ''}`}
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <div className={`pos-subtext text-[10px] font-black mb-0.5 ${statDetailTextClass}`}>
                            {card.isCurrent ? 'Current' : 'Saved'}
                          </div>
                          <div className={`text-lg font-black truncate ${statDetailTextClass}`}>{card.name}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`pos-subtext text-[10px] font-black ${statDetailTextClass}`}>Total</div>
                          <div className="text-base font-black" style={{ color: accentColor }}>{currency} {card.total}</div>
                        </div>
                      </div>
                      <div className={`pos-subtext text-[10px] font-black mb-3 ${statDetailTextClass}`}>
                        {new Date(card.latestTimestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {' • '}
                        {card.items.length} item{card.items.length !== 1 ? 's' : ''}
                      </div>
                      <div className="space-y-1.5">
                        {card.items.map((item, i) => (
                          <div key={i} className={`flex items-center justify-between text-sm font-semibold ${statDetailTextClass}`}>
                            <span>{formatPosLineItemDisplay(item, currency)}</span>
                            <span className="text-xs">{currency} {(item.price * item.quantity).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center">
                    <p className={`pos-subtext text-[10px] font-black ${statDetailTextClass}`}>No invoices today</p>
                  </div>
                )}
                </div>
              </div>
            </div>
          ) : inventoryExpanded ? (
            selectedItem ? (
              <div key={`item-${selectedItem.id}`} className="pos-dashboard-panel-enter">
                {renderInventoryItemPage()}
              </div>
            ) : (
            <div key="assets-hub" className="relative pos-dashboard-panel-enter morph-panel-content morph-panel-content--in space-y-6" role="tabpanel" aria-label="Assets Hub inventory">
              {!isLight && assetHubFlashKey > 0 && (
                <div
                  key={assetHubFlashKey}
                  className="asset-hub-flash"
                  aria-hidden="true"
                />
              )}
              <div className={`sticky top-0 z-50 -mx-4 px-4 pt-2 pb-4 mb-2 backdrop-blur-3xl ${isLight ? 'bg-[#f2f2f7]/92' : 'bg-black/70'}`}>
                {/* Top row: Hub + search + add — title sits below */}
                <div className="flex items-center gap-2 mb-2 min-h-11">
                  <button
                    onClick={() => {
                      setSelectedItem(null);
                      setInventoryExpanded(false);
                      setSearchQuery('');
                      setCartOpen(false);
                    }}
                    aria-label="Back to Vision Hub"
                    className={`relative z-10 shrink-0 ${HUB_BACK_BTN} ${isLight ? 'bg-white shadow-md text-zinc-900' : 'bg-white/10 text-zinc-100'}`}
                  >
                    <HubBackChevron /> Hub
                  </button>
                  <label className="relative flex-1 min-w-0">
                    <span className="sr-only">Search assets</span>
                    <span
                      className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${
                        isLight ? 'text-black/35' : 'text-white/40'
                      }`}
                      aria-hidden
                    >
                      <Icons.Search size={14} />
                    </span>
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search items…"
                      className={`w-full h-10 rounded-full pl-9 pr-3 text-sm font-semibold outline-none border ${
                        isLight
                          ? 'bg-white text-black border-black/8 placeholder:text-black/35 shadow-sm'
                          : 'bg-white/10 text-white border-white/12 placeholder:text-white/35'
                      }`}
                      style={{ letterSpacing: 0 }}
                      aria-label="Search inventory items"
                    />
                  </label>
                  {cartLineCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setCartOpen(true)}
                      className={`relative z-10 shrink-0 inline-flex items-center justify-center h-10 w-10 rounded-full active:scale-90 transition-all ${
                        isLight ? 'bg-white shadow-md text-zinc-900' : 'bg-white/10 text-zinc-100'
                      }`}
                      aria-label={`Open cart, ${cartLineCount} items`}
                      aria-expanded={cartOpen}
                    >
                      <Icons.Cart size={16} />
                      <span
                        className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[9px] font-black text-white flex items-center justify-center"
                        style={{ backgroundColor: accentColor }}
                      >
                        {cartLineCount > 99 ? '99+' : cartLineCount}
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={toggleAssetMenu}
                    className="relative z-10 shrink-0 inline-flex items-center justify-center h-10 w-10 rounded-full shadow-2xl text-white active:scale-90 transition-all"
                    style={{ backgroundColor: accentColor }}
                    aria-label="Add asset actions"
                    aria-expanded={showAssetMenu}
                    aria-haspopup="dialog"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  </button>
                </div>

                <h3
                  className={`text-center pos-dashboard-section-title text-[1.35rem] sm:text-[1.6rem] leading-none mb-3 ${textColorClass}`}
                >
                  Assets Hub
                </h3>

                {renderWholesaleToggleBar()}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  {/* Distinct icon pill toggle — not the same control as Sort */}
                  <div
                    role="radiogroup"
                    aria-label="Inventory layout"
                    className={`inline-flex items-center gap-1 p-1 rounded-2xl border ${
                      isLight ? 'bg-white border-black/8 shadow-sm' : 'bg-white/8 border-white/12'
                    }`}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={inventoryLayout === 'grid'}
                      onClick={() => setInventoryLayout('grid')}
                      className={`h-9 w-11 rounded-xl inline-flex items-center justify-center transition-all active:scale-95 ${
                        inventoryLayout === 'grid'
                          ? isLight
                            ? 'bg-zinc-900 text-white shadow'
                            : 'bg-white text-black shadow'
                          : isLight
                            ? 'text-black/45 hover:bg-black/5'
                            : 'text-white/45 hover:bg-white/8'
                      }`}
                      aria-label="Grid view"
                    >
                      <Icons.Grid size={16} />
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={inventoryLayout === 'list'}
                      onClick={() => setInventoryLayout('list')}
                      className={`h-9 w-11 rounded-xl inline-flex items-center justify-center transition-all active:scale-95 ${
                        inventoryLayout === 'list'
                          ? isLight
                            ? 'bg-zinc-900 text-white shadow'
                            : 'bg-white text-black shadow'
                          : isLight
                            ? 'text-black/45 hover:bg-black/5'
                            : 'text-white/45 hover:bg-white/8'
                      }`}
                      aria-label="List view"
                    >
                      <Icons.List size={16} />
                    </button>
                  </div>
                  <FluidSegmentControl
                    isLight={isLight}
                    size="sm"
                    variant="slide"
                    ariaLabel="Sort inventory"
                    value={sortOption}
                    onChange={(id) => setSortOption(id as SortOption)}
                    options={INVENTORY_SORT_OPTIONS.map((opt) => ({
                      id: opt.id,
                      label: opt.label,
                    }))}
                  />
                </div>
              </div>

              {filteredInventory.length > 0 ? (
                inventoryLayout === 'list' ? (
                  <div className="flex flex-col gap-2.5 pb-20" role="list" aria-label={`Inventory list — ${activeWholesaleName}`}>
                    {filteredInventory.map((item, idx) => renderInventoryListRow(item, idx))}
                  </div>
                ) : (
                  <div
                    className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 pb-20"
                    role="list"
                    aria-label={`Inventory items — ${activeWholesaleName}`}
                  >
                    {filteredInventory.map((item, idx) => renderInventoryProductTile(item, idx))}
                  </div>
                )
              ) : (
                <div className={`p-12 text-center rounded-2xl ${isLight ? 'bg-white/70' : 'bg-white/5'}`}>
                  <p className={`pos-subtext text-[10px] font-black ${isLight ? 'text-black/60' : 'text-white/60'}`}>
                    {searchQuery.trim()
                      ? `No items match “${searchQuery.trim()}”.`
                      : `Nothing in ${activeWholesaleName} yet. Tap + to add something.`}
                  </p>
                </div>
              )}
            </div>
            )
          ) : canViewTransactions && purchasesExpanded ? (
            <div className="morph-panel-content morph-panel-content--in space-y-8" role="tabpanel" aria-label="Transaction Archive">
              <button 
                onClick={() => setPurchasesExpanded(false)} 
                aria-label="Back to Vision Hub"
                className={`${HUB_BACK_BTN} ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'}`}
              >
                <HubBackChevron /> Back
              </button>
              <h3 className={`pos-dashboard-section-title text-4xl px-2 ${textColorClass}`}>Transaction Archive</h3>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 pb-20" role="list" aria-label="Inventory items">
                {filteredInventory.map((item, idx) => (
                  <div 
                    key={item.id} 
                    role="listitem"
                    tabIndex={0}
                    aria-label={`Inventory item ${idx + 1}: ${item.name}, stock ${item.stock} units, price ¢${item.price}`}
                    onClick={() => { setPurchasesExpanded(false); setInventoryExpanded(true); setSelectedItem(item); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPurchasesExpanded(false); setInventoryExpanded(true); setSelectedItem(item); } }}
                    className={`group rounded-xl overflow-hidden cursor-pointer ${levitateClass} relative focus:outline-none focus:ring-2 focus:ring-white/40`}
                  >
                    <div className="relative aspect-square overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                      <InventoryItemImage image={item.image} alt={item.name} accountId={accountId} className="w-full h-full object-cover" />
                      <div className="absolute inset-x-0 bottom-0 h-[42%] bg-linear-to-t from-black/95 via-black/40 to-transparent pointer-events-none" aria-hidden="true" />
                      <div className="absolute bottom-3 left-3 right-3 flex flex-col pointer-events-none" aria-hidden="true">
                         <div className="flex flex-col items-start gap-0.5">
                           <div className="flex-1 min-w-0">
                             <h4 className="text-[11px] font-black leading-tight truncate text-white">{item.name}</h4>
                             {item.category ? (
                    <p className={`pos-subtext text-[8px] font-black truncate ${heroSubtextClass}`}>{item.category}</p>
                  ) : null}
                           </div>
                           <span className="text-[10px] font-black text-white whitespace-nowrap">¢{item.price}</span>
                         </div>
                      </div>
                      <div className="absolute top-2 right-2" aria-hidden="true">
                        <div className={`pos-subtext px-2 py-1 rounded-lg text-[9px] font-black backdrop-blur-3xl shadow-xl ${item.stock < item.threshold ? 'bg-red-500 text-white' : 'bg-black/60 text-white'}`}>
                          {item.stock}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : canViewTransactions ? (
            /* PURCHASES / TRANSACTION ARCHIVE (original) */
            <div className="morph-panel-content morph-panel-content--in space-y-8" role="tabpanel" aria-label="Transaction Archive">
              <button 
                onClick={() => setPurchasesExpanded(false)} 
                aria-label="Back to Vision Hub"
                className={`${HUB_BACK_BTN} ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'}`}
              >
                <HubBackChevron /> Back
              </button>
              <h3 className={`pos-dashboard-section-title text-4xl px-2 ${textColorClass}`}>Transaction Archive</h3>
              <div className={`rounded-2xl overflow-hidden ${levitateClass}`} role="list" aria-label="Transaction records">
                {[...paidInvoiceCards]
                  .sort((a, b) => b.latestTimestamp - a.latestTimestamp)
                  .map((card, idx, list) => {
                    const qty = card.items.reduce((sum, item) => sum + item.quantity, 0);
                    const dateLabel = new Date(card.latestTimestamp).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    return (
                      <div
                        key={card.id}
                        role="listitem"
                        tabIndex={0}
                        aria-label={`Transaction ${idx + 1}: ${card.name}, total ${formatCurrency(card.total)} on ${dateLabel}`}
                        className={`p-10 flex flex-col gap-2 ${idx !== list.length - 1 ? 'border-b border-zinc-100 dark:border-white/5' : ''}`}
                      >
                        <div className="flex justify-between items-start">
                          <span className={`text-xl font-black ${textColorClass}`}>{card.name}</span>
                          <span className="text-xl font-black" style={{ color: accentColor }}>{formatCurrency(card.total)}</span>
                        </div>
                        <div className={`flex justify-between items-center pos-subtext text-[10px] font-black ${cardSubtextMutedClass}`}>
                          <span>{dateLabel}</span>
                          <span>Qty: {qty || 1}</span>
                        </div>
                      </div>
                    );
                  })}
                {paidInvoiceCards.length === 0 && (
                  <div className="p-10 text-center">
                    <p className={`pos-subtext text-[10px] font-black ${cardSubtextMutedClass}`}>No transactions yet</p>
                    <p className={`app-subtext text-[10px] opacity-45 mt-2 ${textColorClass}`}>Shows up after you print</p>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Assets Hub cart — right-side popup synced with calculator invoice */}
      <MorphPresence show={cartOpen && inventoryExpanded && !selectedItem}>
        {(visible) => (
          <div
            className={`fixed inset-0 z-[240] flex justify-end ${
              visible ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            role="presentation"
          >
            <button
              type="button"
              className={`absolute inset-0 morph-scrim ${visible ? 'morph-scrim--in' : 'morph-scrim--out'}`}
              aria-label="Close cart"
              onClick={() => setCartOpen(false)}
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-label={`Cart for ${invoiceName || 'current invoice'}`}
              className={`relative z-[241] h-full w-[min(20rem,88vw)] flex flex-col border-l shadow-[-24px_0_80px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                visible ? 'translate-x-0' : 'translate-x-full'
              } ${isLight ? 'bg-[#f7f7f8] border-black/8 text-zinc-900' : 'bg-zinc-950 border-white/10 text-white'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 border-b ${isLight ? 'border-black/8' : 'border-white/10'}`}>
                <button
                  type="button"
                  onClick={() => {
                    onStartNewInvoice?.();
                    setCartOpen(true);
                  }}
                  className="inline-flex items-center justify-center h-9 w-9 rounded-full text-white active:scale-90 transition-all shadow-lg"
                  style={{ backgroundColor: accentColor }}
                  aria-label="Start new invoice"
                  title="New invoice"
                >
                  <Icons.Plus size={16} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-[10px] font-black uppercase opacity-45 ${textColorClass}`} style={{ letterSpacing: 0 }}>
                    Current invoice
                  </p>
                  <p className={`text-[13px] font-black truncate ${textColorClass}`} title={invoiceName}>
                    {invoiceName || 'Untitled'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  className={`inline-flex items-center justify-center h-9 w-9 rounded-full active:scale-90 transition-all ${
                    isLight ? 'bg-black/5 text-zinc-800' : 'bg-white/10 text-white'
                  }`}
                  aria-label="Close cart"
                >
                  <Icons.X size={16} />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-3 space-y-2">
                {cartItems.length === 0 ? (
                  <div className={`rounded-2xl p-6 text-center ${isLight ? 'bg-white' : 'bg-white/5'}`}>
                    <p className={`text-[12px] font-black ${textColorClass}`}>Cart is empty</p>
                    <p className={`app-subtext text-[10px] mt-1 opacity-55 ${cardSubtextMutedClass}`} style={{ letterSpacing: 0 }}>
                      Tap a product to add it. It syncs with the calculator.
                    </p>
                  </div>
                ) : (
                  cartItems.map((line, idx) => {
                    const name = line.name || `Item ${idx + 1}`;
                    const lineTotal = (line.price || 0) * (line.quantity || 0);
                    return (
                      <div
                        key={`${name}-${line.price}-${idx}`}
                        className={`rounded-2xl px-3 py-2.5 flex items-center gap-3 ${
                          isLight ? 'bg-white shadow-sm' : 'bg-white/6'
                        }`}
                      >
                        <span
                          className={`shrink-0 inline-flex items-center justify-center min-w-[1.75rem] h-7 px-1.5 rounded-lg text-[11px] font-black tabular-nums ${
                            isLight ? 'bg-black/6 text-zinc-900' : 'bg-white/10 text-white'
                          }`}
                        >
                          {line.quantity}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`text-[12px] font-black truncate ${textColorClass}`}>{name}</p>
                          <p className={`app-subtext text-[10px] opacity-50 tabular-nums ${cardSubtextMutedClass}`} style={{ letterSpacing: 0 }}>
                            {formatCurrency(String(line.price))}
                          </p>
                        </div>
                        <p className={`text-[12px] font-black tabular-nums shrink-0 ${textColorClass}`}>
                          {formatCurrency(String(lineTotal))}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>

              <div className={`px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t ${isLight ? 'border-black/8 bg-white/80' : 'border-white/10 bg-black/40'}`}>
                <div className="flex items-end justify-between gap-3 mb-1">
                  <span className={`text-[10px] font-black uppercase opacity-45 ${textColorClass}`} style={{ letterSpacing: 0 }}>
                    Total
                  </span>
                  <span className={`text-xl font-black tabular-nums ${textColorClass}`}>
                    {formatCurrency(runningTotal || '0')}
                  </span>
                </div>
                <p className={`app-subtext text-[10px] opacity-45 ${cardSubtextMutedClass}`} style={{ letterSpacing: 0 }}>
                  Synced with calculator · {cartLineCount} item{cartLineCount === 1 ? '' : 's'}
                </p>
              </div>
            </aside>
          </div>
        )}
      </MorphPresence>

      {/* Asset sheet — iOS-like centered spring sheet (same form for + and action-log add) */}
      <MorphPresence show={showAssetMenu}>
        {(visible) => {
          const fieldLabelClass = `pos-subtext text-[9px] font-black uppercase ${
            isLight ? 'text-black/50' : 'text-white/50'
          }`;
          return (
          <div
            className={`fixed inset-0 z-[250] flex items-end sm:items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${
              visible ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            role="presentation"
          >
            <button
              type="button"
              className={`absolute inset-0 asset-sheet-scrim morph-scrim ${visible ? 'morph-scrim--in' : 'morph-scrim--out'}`}
              aria-label="Close asset sheet"
              onClick={closeAssetAction}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={assetActionMode === 'restock' ? 'Restock item' : 'Add item'}
              className={`asset-sheet-panel morph-panel relative z-[251] w-full max-w-md rounded-[32px] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.45)] border max-h-[min(85vh,36rem)] overflow-y-auto custom-scrollbar ${
                visible ? 'morph-panel--in' : 'morph-panel--out'
              } ${isLight ? 'bg-white/95 border-white/60 text-zinc-900' : 'bg-zinc-900/95 border-white/12 text-white'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full opacity-25 bg-current sm:hidden" aria-hidden />
              <div className="flex items-center justify-between gap-2 mb-4">
                <FluidSegmentControl
                  isLight={isLight}
                  size="sm"
                  variant="slide"
                  ariaLabel="Asset action"
                  value={assetActionMode}
                  onChange={(id) => {
                    resetAssetFormFields();
                    setAssetActionMode(id);
                  }}
                  options={[
                    { id: 'add', label: 'Add item' },
                    { id: 'restock', label: 'Restock' },
                  ]}
                />
                <button
                  type="button"
                  onClick={closeAssetAction}
                  aria-label="Close asset sheet"
                  className={`p-2 rounded-full shrink-0 active:scale-90 ${
                    isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/10 text-white'
                  }`}
                >
                  <Icons.X size={16} />
                </button>
              </div>

              {assetActionMode === 'add' ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <span className={fieldLabelClass}>Item image</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleChooseItemPhoto()}
                        className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-200 dark:bg-zinc-800 shrink-0 active:scale-95"
                        aria-label="Choose item photo"
                      >
                        <img src={resolveInventoryImage(newItemImage)} alt="" className="w-full h-full object-cover" />
                      </button>
                      <input
                        ref={newItemImageInputRef}
                        id="asset-item-image-input"
                        type="file"
                        accept={PHOTO_ACCEPT}
                        onChange={(e) => {
                          void handlePickItemImage(e.target.files?.[0] ?? null);
                          e.target.value = '';
                        }}
                        aria-hidden="true"
                        tabIndex={-1}
                        className="sr-only"
                      />
                      <button
                        type="button"
                        onClick={() => void handleChooseItemPhoto()}
                        className={`flex-1 min-w-0 py-2.5 px-3 rounded-xl text-[10px] font-black uppercase active:scale-[0.98] ${
                          isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'
                        }`}
                      >
                        Choose photo
                      </button>
                    </div>
                  </div>
                  <label className="block space-y-1.5">
                    <span className={fieldLabelClass}>Item name</span>
                    <input type="text" value={newItemName} onChange={(e) => setNewItemName(e.target.value)} placeholder="e.g. Rice 5kg" aria-label="Item name" className={formInputClass(isLight, { size: 'md' })} />
                  </label>
                  <label className="block space-y-1.5">
                    <span className={fieldLabelClass}>Stock quantity</span>
                    <input type="number" min={0} step={1} value={newItemStock} onChange={(e) => setNewItemStock(e.target.value)} placeholder="0" aria-label="Stock quantity" className={formInputClass(isLight, { size: 'md' })} />
                  </label>
                  <label className="block space-y-1.5">
                    <span className={fieldLabelClass}>Price</span>
                    <input type="number" min={0} step="0.01" value={newItemPrice} onChange={(e) => setNewItemPrice(e.target.value)} placeholder="0.00" aria-label="Price" className={formInputClass(isLight, { size: 'md' })} />
                  </label>
                  <label className="block space-y-1.5">
                    <span className={fieldLabelClass}>Grams</span>
                    <input type="number" min={0} step="0.01" value={newItemGrams} onChange={(e) => setNewItemGrams(e.target.value)} placeholder="0" aria-label="Grams" className={formInputClass(isLight, { size: 'md' })} />
                  </label>
                  <button type="button" onClick={handleAddItem} disabled={!newItemName.trim()} className="w-full py-3 rounded-xl text-black font-black uppercase text-[10px] active:scale-95 transition-all disabled:opacity-40" style={{ backgroundColor: accentColor }}>
                    Save item
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="block space-y-1.5">
                    <span className={fieldLabelClass}>Search item</span>
                    <input
                      type="search"
                      value={restockSearch}
                      onChange={(e) => {
                        setRestockSearch(e.target.value);
                        setRestockItemId(null);
                      }}
                      placeholder="Type to find an item"
                      aria-label="Search item name"
                      className={formInputClass(isLight, { size: 'md' })}
                    />
                  </label>
                  <div className="space-y-1.5">
                    <span className={fieldLabelClass}>Select item</span>
                    <div className={`rounded-xl border max-h-36 overflow-y-auto custom-scrollbar ${isLight ? 'border-zinc-200' : 'border-white/10'}`}>
                      {restockSearchResults.length === 0 ? (
                        <p className={`p-2.5 text-[10px] font-bold ${isLight ? 'text-black/45' : 'text-white/45'}`}>No items in this wholesale list.</p>
                      ) : (
                        restockSearchResults.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setRestockItemId(item.id);
                              setRestockSearch(item.name);
                              setRestockGrams(String(item.grams ?? 0));
                            }}
                            className={`w-full text-left px-2.5 py-2 border-b last:border-0 flex items-center justify-between gap-2 ${
                              restockItemId === item.id
                                ? isLight
                                  ? 'bg-zinc-900 text-white'
                                  : 'bg-white text-black'
                                : isLight
                                  ? 'border-zinc-100 hover:bg-zinc-50'
                                  : 'border-white/5 hover:bg-white/5'
                            }`}
                          >
                            <span className="text-xs font-black truncate">{item.name}</span>
                            <span className="text-[9px] font-bold opacity-70 shrink-0">
                              {item.stock}{item.grams ? ` · ${item.grams}g` : ''} · ¢{item.price}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                  <label className="block space-y-1.5">
                    <span className={fieldLabelClass}>Stock quantity</span>
                    <input type="number" min={0} step={1} value={restockQty} onChange={(e) => setRestockQty(e.target.value)} placeholder="0" aria-label="Stock quantity to add" className={formInputClass(isLight, { size: 'md' })} />
                  </label>
                  <label className="block space-y-1.5">
                    <span className={fieldLabelClass}>Grams</span>
                    <input type="number" min={0} step="0.01" value={restockGrams} onChange={(e) => setRestockGrams(e.target.value)} placeholder="0" aria-label="Grams" className={formInputClass(isLight, { size: 'md' })} />
                  </label>
                  <button
                    type="button"
                    onClick={handleRestockExisting}
                    disabled={!restockItemId || ((parseFloat(restockQty) || 0) <= 0 && (parseFloat(restockGrams) || 0) <= 0)}
                    className="w-full py-3 rounded-xl text-black font-black uppercase text-[10px] active:scale-95 transition-all disabled:opacity-40"
                    style={{ backgroundColor: accentColor }}
                  >
                    Apply restock
                  </button>
                </div>
              )}
            </div>
          </div>
          );
        }}
      </MorphPresence>

      {/* Wholesale hold: Edit / Remove — morph trio animation */}
      <MorphPresence show={!!wholesaleHoldMenuId}>
        {(visible) => (
        <>
          <button
            type="button"
            className={`fixed inset-0 z-[240] cursor-default bg-transparent morph-scrim ${
              visible ? 'morph-scrim--in' : 'morph-scrim--out'
            }`}
            aria-label="Close wholesale menu"
            onClick={closeWholesaleHoldMenu}
          />
          <div
            role="menu"
            className={`wholesale-hold-menu morph-panel fixed z-[250] min-w-[9rem] rounded-xl p-1 shadow-2xl border ${
              visible ? 'morph-panel--in' : 'morph-panel--out'
            } ${isLight ? 'bg-white border-zinc-200' : 'bg-zinc-900 border-white/12'}`}
            style={{
              top: wholesaleHoldMenuPos?.top ?? 120,
              left: wholesaleHoldMenuPos?.left ?? 80,
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => wholesaleHoldMenuId && beginRenameWholesale(wholesaleHoldMenuId)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-[11px] font-black uppercase ${
                isLight ? 'hover:bg-zinc-100 text-zinc-900' : 'hover:bg-white/10 text-white'
              }`}
            >
              Edit
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                if (wholesaleHoldMenuId) setWholesaleDeleteConfirmId(wholesaleHoldMenuId);
                closeWholesaleHoldMenu();
                setWholesaleActionError(null);
              }}
              className="w-full text-left px-3 py-2.5 rounded-lg text-[11px] font-black uppercase text-red-500 hover:bg-red-500/10"
            >
              Remove
            </button>
          </div>
        </>
        )}
      </MorphPresence>

      <MorphPresence show={!!wholesaleDeleteConfirmId}>
        {(visible) => (
        <div className={`fixed inset-0 z-[260] flex items-center justify-center p-6 ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`} role="presentation">
          <button
            type="button"
            className={`absolute inset-0 morph-scrim ${visible ? 'morph-scrim--in' : 'morph-scrim--out'} ${
              isLight ? 'bg-black/25' : 'bg-black/55'
            }`}
            aria-label="Dismiss delete prompt"
            onClick={() => setWholesaleDeleteConfirmId(null)}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="wholesale-delete-title"
            className={`relative w-full max-w-xs rounded-2xl p-5 shadow-2xl border morph-panel ${
              visible ? 'morph-panel--in' : 'morph-panel--out'
            } ${isLight ? 'bg-white border-zinc-200 text-zinc-900' : 'bg-zinc-900 border-white/10 text-white'}`}
          >
            <h4 id="wholesale-delete-title" className="text-sm font-black mb-2">
              Do you want to delete?
            </h4>
            <p className={`text-[11px] font-bold mb-4 ${isLight ? 'text-black/55' : 'text-white/55'}`}>
              “{wholesales.find((w) => w.id === wholesaleDeleteConfirmId)?.name ?? 'Wholesale'}” moves to Archive.
              Items stay with that list until you restore it.
            </p>
            {wholesaleActionError && (
              <p className="text-[10px] font-bold text-red-500 mb-3">{wholesaleActionError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setWholesaleDeleteConfirmId(null);
                  setWholesaleActionError(null);
                }}
                className={`flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase ${
                  isLight ? 'bg-zinc-100 text-zinc-800' : 'bg-white/10 text-white'
                }`}
              >
                No
              </button>
              <button
                type="button"
                onClick={confirmArchiveWholesale}
                className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase bg-red-500 text-white"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
        )}
      </MorphPresence>

      {/* Wholesale archive (deleted lists) */}
      <MorphPresence show={showWholesaleArchive}>
        {(visible) => (
          <div
            className={`fixed inset-0 z-350 flex items-end sm:items-center justify-center p-4 ${
              visible ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            role="presentation"
            aria-hidden={!visible}
          >
            <div
              className={`absolute inset-0 cursor-pointer morph-scrim ${visible ? 'morph-scrim--in' : 'morph-scrim--out'} ${
                isLight ? 'bg-[#f2f2f7]' : 'bg-[#0a0a0c]'
              }`}
              onClick={() => setShowWholesaleArchive(false)}
              aria-hidden="true"
            />
            <div
              className={`relative w-full max-w-md rounded-[28px] p-6 morph-panel ${
                visible ? 'morph-panel--in' : 'morph-panel--out'
              } ${levitateClass} shadow-[0_40px_120px_rgba(0,0,0,0.55)] max-h-[80vh] overflow-y-auto custom-scrollbar`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="wholesale-archive-title"
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 id="wholesale-archive-title" className={`pos-dashboard-section-title text-2xl ${textColorClass}`}>
                    Archive
                  </h3>
                  <p className={`pos-subtext text-[10px] font-bold mt-1 ${isLight ? 'text-black/50' : 'text-white/50'}`}>
                    Deleted wholesale lists — restore to use again
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWholesaleArchive(false)}
                  aria-label="Close archive"
                  className="p-2 rounded-full opacity-60 hover:opacity-100"
                >
                  <Icons.X size={18} />
                </button>
              </div>

              {archivedWholesales.length === 0 ? (
                <div className={`p-8 text-center rounded-2xl ${isLight ? 'bg-zinc-50' : 'bg-white/5'}`}>
                  <p className={`pos-subtext text-[10px] font-black ${isLight ? 'text-black/50' : 'text-white/50'}`}>
                    No archived wholesales yet.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {archivedWholesales.map((entry) => {
                    const itemCount = items.filter((i) => i.wholesaleId === entry.id).length;
                    return (
                      <div
                        key={entry.id}
                        className={`flex items-center justify-between gap-3 p-3.5 rounded-2xl border ${
                          isLight ? 'bg-white border-zinc-200' : 'bg-white/5 border-white/10'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className={`text-sm font-black truncate ${textColorClass}`}>{entry.name}</div>
                          <div className={`pos-subtext text-[9px] font-bold ${isLight ? 'text-black/45' : 'text-white/45'}`}>
                            {itemCount} item{itemCount !== 1 ? 's' : ''} ·{' '}
                            {new Date(entry.archivedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const result = restoreWholesale(entry.id);
                            if (result.ok === false) {
                              setWholesaleActionError(result.error);
                              return;
                            }
                            setWholesaleActionError(null);
                            setSelectedItem(null);
                          }}
                          className="shrink-0 px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-emerald-500 text-white active:scale-95"
                        >
                          Restore
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </MorphPresence>

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        updateSettings={updateSettings}
        cartItems={cartItems.length > 0 ? cartItems : latestPurchaseItems}
        runningTotal={cartItems.length > 0 ? (parseFloat(runningTotal) || 0) : latestPurchaseTotal}
        invoiceName={cartItems.length > 0 ? invoiceName : latestPurchaseName}
        currency={currency}
        accountUsername={accountUsername}
        onChangePassword={onChangePassword}
        onLogout={onLogout}
        onVerifyAdminPassword={onVerifyAdminPassword}
      />

    </div>
  );
};

export default POSDashboard;