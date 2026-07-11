import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  HistoryItem,
  InvoiceActionLog,
  InvoicePrintLog,
  CartLineItem,
  POSRequest,
  RestockLineItem,
  RestockNote,
  SupplierRecord,
} from '../types';
import { formatPosLineItemDisplay, formatPriceLabel } from '../utils/posExpression';
import { Icons } from '../constants';
import { InventoryItem, ActivityLogEntry, PurchaseRecord } from '../hooks/usePOS';
import { isAdminProfile } from '../utils/auth';

import SettingsPanel from './SettingsPanel';
import VisionHubPrintPanel, { HubInvoice, HubNotepadJob } from './VisionHubPrintPanel';
import InventoryNotepad from './InventoryNotepad';
import {
  buildNotepadPrintBody,
  buildNotepadPrintBodyFromNotes,
  parseNotepadSnapshot,
} from '../utils/notepadSnapshot';
import { WALLPAPER_IMAGE_URLS } from '../utils/wallpapers';

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

  };
  updateSettings: (keyOrPatch: string | Record<string, unknown>, value?: unknown) => void;
  onInvoicePrinted?: (invoiceName: string, total: string, items: CartLineItem[]) => void;
  onResolveUnidentifiedPrice?: (price: number, itemName: string) => void;
  canViewTransactions?: boolean;
  accountUsername?: string;
  onChangePassword?: (current: string, newPassword: string) => Promise<{ error?: string; ok?: boolean }>;
  onLogout?: () => void;
  onVerifyAdminPassword?: (password: string) => Promise<{ error?: string; ok?: boolean }>;
  canInstallApp?: boolean;
  isAppInstalled?: boolean;
  onInstallApp?: () => void;
}

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
type FilterOption = 'all' | '24h' | '48h' | '3d' | '7d' | '14d' | 'custom';

const INVENTORY_SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: 'a-z', label: 'A-Z' },
  { id: 'high-stock', label: 'Stock ↓' },
  { id: 'low-stock', label: 'Stock ↑' },
];

const INVENTORY_FILTER_OPTIONS: { id: FilterOption; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: '24h', label: '24h' },
  { id: '48h', label: '48h' },
  { id: '3d', label: '3d' },
  { id: '7d', label: '7d' },
  { id: '14d', label: '14d' },
];



type RequestStatus = POSRequest['status'];
const RESTOCK_DRAG_FACTOR = 1.25;
const RESTOCK_VERTICAL_STRIP_HEIGHT = 52;
const RESTOCK_SWIPE_THRESHOLD = 22;

type RestockViewMode = 'list' | 'horizontal' | 'vertical' | 'grid';

function formatCreatedStamp(d = new Date()) {
  return d.toLocaleString([], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildRestockNotesSnapshot(lines: RestockLineItem[], freeNotes = '') {
  const total = lines.reduce((sum, line) => sum + line.qty, 0);
  const body = lines.map((l) => `${l.name}\t× ${l.qty}`).join('\n');
  const summary = `= ${total}`;
  if (!body && !freeNotes.trim()) return summary;
  if (!body) return `${freeNotes.trim()}\n\n${summary}`;
  if (!freeNotes.trim()) return `${body}\n\n${summary}`;
  return `${body}\n\n${freeNotes.trim()}\n\n${summary}`;
}

function formatRequestElapsed(timestamp: number, now: Date): string {
  const ms = Math.max(0, now.getTime() - timestamp);
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (secs < 60) return `${secs}s`;
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  if (hrs < 24) return `${hrs}h ${mins % 60}m ${secs % 60}s`;
  return `${days}d ${hrs % 24}h ${mins % 60}m`;
}

interface RequestLineItem {
  label: string;
  qty: number;
}

function parseNotepadLines(notes: string): RequestLineItem[] {
  const lines: RequestLineItem[] = [];
  const raw = notes.trim();
  if (!raw) return [];

  for (const part of raw.split('\n')) {
    const line = part.trim();
    if (!line || /^=\s*\d/.test(line)) continue;
    const match = line.match(/^(.+?)[\t ]*[×x][\t ]*(\d+(?:\.\d+)?)\s*$/i);
    if (match) {
      lines.push({
        label: match[1].trim(),
        qty: Math.max(1, Math.round(parseFloat(match[2]))),
      });
    }
  }
  return lines;
}

function parseRequestLines(notes: string): RequestLineItem[] {
  const fromNotepad = parseNotepadLines(notes);
  if (fromNotepad.length > 0) return fromNotepad;

  return notes
    .replace(/^=\s*\d+.*$/gm, '')
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((label) => ({ label, qty: 1 }));
}

function parseRequestTotals(notes: string): { itemCount: number; total: number } {
  const lines = parseRequestLines(notes);
  const itemCount = lines.reduce((sum, line) => sum + line.qty, 0);
  return { itemCount, total: 0 };
}

const POSDashboard: React.FC<POSDashboardProps> = ({
  history: _history,
  items,
  setItems,
  purchases,
  suppliers,
  setSuppliers,
  requests,
  setRequests,
  restocks,
  setRestocks,
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
  onChangePassword,
  onLogout,
  onVerifyAdminPassword,
  canInstallApp = false,
  isAppInstalled = false,
  onInstallApp,
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  const activeProfile = useMemo(() => {
    const profiles = settings.profiles ?? [];
    return profiles.find((p) => p.id === settings.activeProfileId) ?? profiles[0] ?? null;
  }, [settings.profiles, settings.activeProfileId]);

  const activeProfileName = activeProfile?.name ?? 'Staff';

  const canEditStock = isAdminProfile(activeProfile) || activeProfile?.sellerType === 'wholesaler';
  const canEditPrice = isAdminProfile(activeProfile) || activeProfile?.sellerType === 'retailer';

  const [stockEditValue, setStockEditValue] = useState('');
  const [priceEditValue, setPriceEditValue] = useState('');
  const [inventoryExpanded, setInventoryExpanded] = useState(false);
  const [purchasesExpanded, setPurchasesExpanded] = useState(false);
  const [avgCustomerExpanded, setAvgCustomerExpanded] = useState(false);
  const [invoicesTodayExpanded, setInvoicesTodayExpanded] = useState(false);
  const [monthlyRevExpanded, setMonthlyRevExpanded] = useState(false);
  const [dailySalesExpanded, setDailySalesExpanded] = useState(false);
  const [actionLogsExpanded, setActionLogsExpanded] = useState(false);
  const [actionLogSearchQuery, setActionLogSearchQuery] = useState('');
  const [showActionLogSearch, setShowActionLogSearch] = useState(false);
  const [actionLogFilter, setActionLogFilter] = useState<DashboardLogFilter>('all');
  const [namingUnidentified, setNamingUnidentified] = useState<{ price: number; quantity: number } | null>(null);
  const [requestsExpanded, setRequestsExpanded] = useState(false);
  const [restockExpanded, setRestockExpanded] = useState(false);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isThemeAnimating, setIsThemeAnimating] = useState(false);
  const [isSettingsAnimating, setIsSettingsAnimating] = useState(false);
  const [isCloseAnimating, setIsCloseAnimating] = useState(false);
  const [visionHubFocus, setVisionHubFocus] = useState(false);
  
  const [sortOption, setSortOption] = useState<SortOption>('a-z');
  const [filterOption, setFilterOption] = useState<FilterOption>('all');
  const [customDateStart] = useState('');
  const [customDateEnd] = useState('');

  const [searchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  useEffect(() => {
    if (!selectedItem) return;
    const item = items.find((i) => i.id === selectedItem.id) ?? selectedItem;
    setStockEditValue(String(item.stock));
    setPriceEditValue(String(item.price));
  }, [selectedItem?.id, items]);
  
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('0');
  const [newItemCategory, setNewItemCategory] = useState('Hardware');
  const [newItemImageUrl, setNewItemImageUrl] = useState('');
  // Requests feature states
  const [requestTab, setRequestTab] = useState<'pending' | 'delivered' | 'outofstock'>('pending');
  const [showAddRequestPopup, setShowAddRequestPopup] = useState(false);
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [requestCreatedStamp, setRequestCreatedStamp] = useState('');
  const [newRequesterName, setNewRequesterName] = useState('');
  const [requestLineItems, setRequestLineItems] = useState<RestockLineItem[]>([]);
  const [requestComposeQuery, setRequestComposeQuery] = useState('');
  const [requestFreeNotes, setRequestFreeNotes] = useState('');
  const [queuedNotepadPrint, setQueuedNotepadPrint] = useState<HubNotepadJob | null>(null);

  // Restock notepad states
  const [showAddRestockPopup, setShowAddRestockPopup] = useState(false);
  const [editingRestockId, setEditingRestockId] = useState<string | null>(null);
  const [newRestockTitle, setNewRestockTitle] = useState('');
  const [restockCreatedStamp, setRestockCreatedStamp] = useState('');
  const [restockLineItems, setRestockLineItems] = useState<RestockLineItem[]>([]);
  const [restockComposeQuery, setRestockComposeQuery] = useState('');
  const [restockFreeNotes, setRestockFreeNotes] = useState('');

  const [restockViewMode, setRestockViewMode] = useState<RestockViewMode>('list');
  const [restockActiveIdx, setRestockActiveIdx] = useState(0);
  const [restockGridZoomed, setRestockGridZoomed] = useState(false);
  const [restockDragDelta, setRestockDragDelta] = useState(0);
  const [restockIsDragging, setRestockIsDragging] = useState(false);
  const restockDragStartX = useRef(0);
  const restockDragStartY = useRef(0);
  const restockDragAxis = useRef<'none' | 'x' | 'y'>('none');
  const restockStageRef = useRef<HTMLDivElement>(null);
  const [showSuppliersPanel, setShowSuppliersPanel] = useState(false);

  // Keyboard accessibility: close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showAddRequestPopup) {
          closeRequestPopup();
        } else if (showSuppliersPanel) {
          setShowSuppliersPanel(false);
        } else if (showAddRestockPopup) {
          closeRestockPopup();
        } else if (namingUnidentified) {
          setNamingUnidentified(null);
        } else if (actionLogsExpanded) {
          setActionLogsExpanded(false);
          setShowActionLogSearch(false);
          setActionLogSearchQuery('');
        } else if (requestsExpanded) {
          setRequestsExpanded(false);
        } else if (restockExpanded) {
          if (restockGridZoomed) {
            setRestockGridZoomed(false);
          } else {
            setRestockExpanded(false);
          }
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
    // closeRestockPopup is stable (useCallback below); omit to avoid TDZ — handler calls it by reference at runtime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, onClose, showAddRequestPopup, showAddRestockPopup, showSuppliersPanel, namingUnidentified, actionLogsExpanded, selectedItem, requestsExpanded, restockExpanded, restockGridZoomed, inventoryExpanded, purchasesExpanded, avgCustomerExpanded, invoicesTodayExpanded, monthlyRevExpanded, dailySalesExpanded]);

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
    if (restockExpanded) {
      setRestockActiveIdx(0);
      setRestockGridZoomed(false);
      setRestockDragDelta(0);
    }
  }, [restockExpanded]);

  useEffect(() => {
    if (restockActiveIdx >= restocks.length && restocks.length > 0) {
      setRestockActiveIdx(restocks.length - 1);
    }
  }, [restocks.length, restockActiveIdx]);

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

  const todayStart = useMemo(
    () =>
      new Date(
        currentTime.getFullYear(),
        currentTime.getMonth(),
        currentTime.getDate()
      ).getTime(),
    [currentTime]
  );

  const monthStart = useMemo(
    () => new Date(currentTime.getFullYear(), currentTime.getMonth(), 1).getTime(),
    [currentTime]
  );

  const stats = useMemo(() => {
    const monthlyRev = paidInvoiceCards
      .filter((c) => c.latestTimestamp >= monthStart)
      .reduce((acc, c) => acc + (parseFloat(c.total) || 0), 0);
    const dailyRev = paidInvoiceCards
      .filter((c) => c.latestTimestamp >= todayStart)
      .reduce((acc, c) => acc + (parseFloat(c.total) || 0), 0);
    const totalRev = paidInvoiceCards.reduce((acc, c) => acc + (parseFloat(c.total) || 0), 0);
    const invoicesToday = paidInvoiceCards.filter(
      (c) => c.latestTimestamp >= todayStart
    ).length;
    const customerCount = paidInvoiceCards.length;
    const avgPerCustomer = customerCount > 0 ? totalRev / customerCount : 0;
    const stockLevel = items.length > 0
      ? Math.round(items.reduce((acc, item) => acc + (item.stock / item.threshold) * 100, 0) / items.length)
      : 0;
    const criticalItems = items.filter((i) => i.stock < i.threshold).length;

    return { totalRev, monthlyRev, dailyRev, avgPerCustomer, invoicesToday, stockLevel, criticalItems };
  }, [paidInvoiceCards, items, monthStart, todayStart]);

  const invoicesTodayList = useMemo(() => {
    return paidInvoiceCards
      .filter((card) => card.latestTimestamp >= todayStart)
      .sort((a, b) => b.latestTimestamp - a.latestTimestamp);
  }, [paidInvoiceCards, todayStart]);

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

    paidInvoiceCards
      .filter((c) => c.latestTimestamp >= todayStart)
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
  }, [paidInvoiceCards, todayStart]);

  const hubCollapsed = !inventoryExpanded && !purchasesExpanded && !requestsExpanded
    && !restockExpanded && !avgCustomerExpanded && !invoicesTodayExpanded
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

  const systemLogs = useMemo((): DashboardLogEntry[] => {
    const dayAgo = Date.now() - 86400000;
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
    return [...inventoryLogs, ...invoiceLogs]
      .filter((log) => log.timestamp >= dayAgo)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [items, invoiceActionLogs, currency]);

  const filteredActionLogs = useMemo(() => {
    const now = Date.now();
    const oneDay = 86400000;
    let result = [...systemLogs];

    if (actionLogFilter === 'restock') {
      result = result.filter((log) => log.type === 'restock');
    } else if (actionLogFilter === 'sale') {
      result = result.filter((log) => log.type === 'sale');
    } else if (actionLogFilter === 'invoice') {
      result = result.filter((log) => log.type === 'invoice-add' || log.type === 'invoice-unidentified');
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
  }, [systemLogs, actionLogFilter, actionLogSearchQuery]);

  const filteredInventory = useMemo(() => {
    let result = [...items];
    if (searchQuery) result = result.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
    
    if (filterOption !== 'all') {
      const now = Date.now();
      const oneDay = 86400000;
      result = result.filter(item => {
        const lastTs = new Date(item.lastStocked).getTime();
        const diff = now - lastTs;
        if (filterOption === '24h') return diff <= oneDay;
        if (filterOption === '48h') return diff <= oneDay * 2;
        if (filterOption === '3d') return diff <= oneDay * 3;
        if (filterOption === '7d') return diff <= oneDay * 7;
        if (filterOption === '14d') return diff <= oneDay * 14;
        if (filterOption === 'custom' && customDateStart && customDateEnd) {
          const start = new Date(customDateStart).getTime();
          const end = new Date(customDateEnd).getTime() + (86400000 - 1);
          return lastTs >= start && lastTs <= end;
        }
        return true;
      });
    }

    result.sort((a, b) => {
      if (sortOption === 'a-z') return a.name.localeCompare(b.name);
      if (sortOption === 'high-stock') return b.stock - a.stock;
      if (sortOption === 'low-stock') return a.stock - b.stock;
      return 0;
    });
    return result;
  }, [items, searchQuery, sortOption, filterOption, customDateStart, customDateEnd]);

  const filteredRequests = useMemo(() => {
    return requests
      .filter(r => r.status === requestTab)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [requests, requestTab]);

  const queueNotepadPrint = useCallback(
    (title: string, body: string) => {
      if (!canViewTransactions) return;
      setQueuedNotepadPrint({ id: `notepad-${Date.now()}`, title, body });
      setRequestsExpanded(false);
      setRestockExpanded(false);
      setInventoryExpanded(false);
      setPurchasesExpanded(false);
    },
    [canViewTransactions]
  );

  const saveRequest = () => {
    const requester = newRequesterName.trim();
    if (!requester || requestLineItems.length === 0) return;
    const notes = buildRestockNotesSnapshot(requestLineItems, requestFreeNotes);
    const { itemCount } = parseRequestTotals(notes);
    if (editingRequestId) {
      setRequests((prev) =>
        prev.map((r) =>
          r.id === editingRequestId
            ? { ...r, requester, notes, itemCount, timestamp: Date.now() }
            : r
        )
      );
    } else {
      const newReq: POSRequest = {
        id: 'req-' + Date.now(),
        requester,
        notes,
        status: 'pending',
        timestamp: Date.now(),
        itemCount,
        total: 0,
      };
      setRequests((prev) => [newReq, ...prev]);
    }
    closeRequestPopup();
  };

  const closeRequestPopup = () => {
    setShowAddRequestPopup(false);
    setEditingRequestId(null);
    setRequestCreatedStamp('');
    setNewRequesterName('');
    setRequestLineItems([]);
    setRequestComposeQuery('');
    setRequestFreeNotes('');
  };

  const openRequestPopup = () => {
    setEditingRequestId(null);
    setRequestCreatedStamp(formatCreatedStamp());
    setNewRequesterName('');
    setRequestLineItems([]);
    setRequestComposeQuery('');
    setRequestFreeNotes('');
    setShowAddRequestPopup(true);
  };

  const openRequestPopupForEdit = (req: POSRequest) => {
    const { lineItems, freeNotes } = parseNotepadSnapshot(req.notes, items);
    setEditingRequestId(req.id);
    setRequestCreatedStamp(formatCreatedStamp(new Date(req.timestamp)));
    setNewRequesterName(req.requester);
    setRequestLineItems(lineItems);
    setRequestFreeNotes(freeNotes);
    setRequestComposeQuery('');
    setShowAddRequestPopup(true);
  };

  const printRequestNotepad = useCallback(
    (req?: POSRequest) => {
      const title = (req?.requester ?? newRequesterName.trim()) || 'Request';
      const stamp = req
        ? formatCreatedStamp(new Date(req.timestamp))
        : requestCreatedStamp || formatCreatedStamp();
      const body = req
        ? buildNotepadPrintBodyFromNotes(title, req.notes, stamp)
        : buildNotepadPrintBody(title, requestLineItems, requestFreeNotes, stamp);
      queueNotepadPrint(title, body);
    },
    [
      newRequesterName,
      queueNotepadPrint,
      requestCreatedStamp,
      requestFreeNotes,
      requestLineItems,
    ]
  );

  const requestStatusClass = (status: RequestStatus) =>
    status === 'pending'
      ? 'bg-yellow-500/20 text-yellow-500'
      : status === 'delivered'
        ? 'bg-emerald-500/20 text-emerald-500'
        : 'bg-red-500/20 text-red-500';

  const renderNotepadListRow = (
    key: string,
    title: string,
    subtitle: string,
    totalQty: number,
    onOpen: () => void,
    onPrint: () => void,
    showPrint: boolean,
    idx: number,
    listLen: number,
    accentQtyClass: string
  ) => (
    <div
      key={key}
      className={`flex items-center gap-3 px-8 py-6 ${idx !== listLen - 1 ? 'border-b border-white/10' : ''}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 text-left active:opacity-80 transition-opacity"
        aria-label={`Open ${title}`}
      >
        <div className={`font-black tracking-tight text-lg truncate ${textColorClass}`}>{title}</div>
        <p className={`pos-subtext text-[10px] font-black mt-1.5 ${cardSubtextMutedClass}`}>{subtitle}</p>
        <div className={`mt-2 text-base font-black tabular-nums ${accentQtyClass}`}>= {totalQty}</div>
      </button>
      {showPrint && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrint();
          }}
          className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center active:scale-90 transition-all ${
            isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'
          }`}
          aria-label={`Print ${title}`}
        >
          <Icons.Printer size={18} />
        </button>
      )}
    </div>
  );

  const renderRequestRow = (req: POSRequest, idx: number, total: number) => {
    const qtyTotal = req.itemCount;
    const subtitle = formatCreatedStamp(new Date(req.timestamp));
    return renderNotepadListRow(
      req.id,
      req.requester,
      subtitle,
      qtyTotal,
      () => openRequestPopupForEdit(req),
      () => printRequestNotepad(req),
      canViewTransactions,
      idx,
      total,
      isLight ? 'text-emerald-600' : 'text-emerald-400'
    );
  };

  const closeRestockPopup = useCallback(() => {
    setShowAddRestockPopup(false);
    setEditingRestockId(null);
    setNewRestockTitle('');
    setRestockCreatedStamp('');
    setRestockLineItems([]);
    setRestockComposeQuery('');
    setRestockFreeNotes('');
  }, []);

  const openRestockPopup = useCallback(() => {
    const stamp = formatCreatedStamp();
    setEditingRestockId(null);
    setRestockCreatedStamp(stamp);
    setRestockLineItems([]);
    setRestockFreeNotes('');
    setNewRestockTitle('');
    setRestockComposeQuery('');
    setShowAddRestockPopup(true);
  }, []);

  const openRestockPopupForEdit = useCallback(
    (note: RestockNote) => {
      const { freeNotes } = parseNotepadSnapshot(note.notes, items);
      setEditingRestockId(note.id);
      setRestockCreatedStamp(formatCreatedStamp(new Date(note.timestamp)));
      setRestockLineItems(note.lineItems);
      setRestockFreeNotes(freeNotes);
      setNewRestockTitle(note.title);
      setRestockComposeQuery('');
      setShowAddRestockPopup(true);
    },
    [items]
  );

  const printRestockNotepad = useCallback(
    (note?: RestockNote) => {
      const title = (note?.title ?? newRestockTitle.trim()) || 'Restock';
      const stamp = note
        ? formatCreatedStamp(new Date(note.timestamp))
        : restockCreatedStamp || formatCreatedStamp();
      const body = note
        ? buildNotepadPrintBodyFromNotes(title, note.notes, stamp)
        : buildNotepadPrintBody(title, restockLineItems, restockFreeNotes, stamp);
      queueNotepadPrint(title, body);
    },
    [
      newRestockTitle,
      queueNotepadPrint,
      restockCreatedStamp,
      restockFreeNotes,
      restockLineItems,
    ]
  );

  const saveRestockNote = useCallback(() => {
    if (restockLineItems.length === 0) return;
    const title = newRestockTitle.trim() || 'Restock batch';
    const now = Date.now();

    const snapshot = buildRestockNotesSnapshot(restockLineItems, restockFreeNotes);
    if (editingRestockId) {
      setRestocks((prev) =>
        prev.map((n) =>
          n.id === editingRestockId
            ? { ...n, title, notes: snapshot, lineItems: restockLineItems, timestamp: now }
            : n
        )
      );
    } else {
      setRestocks((prev) => [
        {
          id: `restock-${now}`,
          title,
          notes: snapshot,
          timestamp: now,
          lineItems: restockLineItems,
        },
        ...prev,
      ]);
    }

    closeRestockPopup();
  }, [
    restockLineItems,
    newRestockTitle,
    restockFreeNotes,
    editingRestockId,
    closeRestockPopup,
    setRestocks,
  ]);

  const restockGridCols = 3;
  const lowStockItems = useMemo(() => items.filter((i) => i.stock < i.threshold), [items]);

  const getRestockTotalQty = useCallback(
    (note: RestockNote) => note.lineItems.reduce((sum, line) => sum + line.qty, 0),
    []
  );

  const selectRestockCard = useCallback((idx: number) => {
    if (idx >= 0 && idx < restocks.length) setRestockActiveIdx(idx);
  }, [restocks.length]);

  const onRestockPointerDown = useCallback((e: React.PointerEvent) => {
    if (restockViewMode === 'list' || restockViewMode === 'grid') return;
    if ((e.target as HTMLElement).closest('button')) return;
    restockDragStartX.current = e.clientX;
    restockDragStartY.current = e.clientY;
    restockDragAxis.current = 'none';
    setRestockIsDragging(true);
    setRestockDragDelta(0);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [restockViewMode]);

  const onRestockPointerMove = useCallback((e: React.PointerEvent) => {
    if (!restockIsDragging || restockViewMode === 'list' || restockViewMode === 'grid') return;
    const dx = e.clientX - restockDragStartX.current;
    const dy = e.clientY - restockDragStartY.current;
    const primaryAxis = restockViewMode === 'vertical' ? 'y' : 'x';
    if (restockDragAxis.current === 'none' && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      restockDragAxis.current = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    }
    if (restockDragAxis.current !== primaryAxis) return;
    setRestockDragDelta((primaryAxis === 'x' ? dx : dy) * RESTOCK_DRAG_FACTOR);
  }, [restockIsDragging, restockViewMode]);

  const onRestockPointerUp = useCallback(() => {
    if (!restockIsDragging || restockViewMode === 'list' || restockViewMode === 'grid') return;
    setRestockIsDragging(false);
    const primaryAxis = restockViewMode === 'vertical' ? 'y' : 'x';
    if (restockDragAxis.current === primaryAxis) {
      let nextIdx = restockActiveIdx;
      if (restockDragDelta < -RESTOCK_SWIPE_THRESHOLD) {
        nextIdx = Math.min(restockActiveIdx + 1, restocks.length - 1);
      } else if (restockDragDelta > RESTOCK_SWIPE_THRESHOLD) {
        nextIdx = Math.max(restockActiveIdx - 1, 0);
      }
      if (nextIdx !== restockActiveIdx) selectRestockCard(nextIdx);
    }
    restockDragAxis.current = 'none';
    setRestockDragDelta(0);
  }, [restockIsDragging, restockDragDelta, restockViewMode, restockActiveIdx, restocks.length, selectRestockCard]);

  const getRestockHorizontalStyle = (idx: number) => {
    const relativePos = idx - restockActiveIdx;
    let translateX = restockDragDelta;
    let translateY = 0;
    let scale = 1;
    let opacity = 0;
    let blurPx = 0;
    let zIndex = 100;
    let transformOrigin = 'center center';

    if (relativePos === 0) {
      translateX = restockDragDelta;
      opacity = 1;
      zIndex = 120;
    } else if (relativePos === -1) {
      translateX = restockDragDelta;
      translateY = 6;
      scale = 0.98;
      opacity = 0.9;
      blurPx = 2.5;
      zIndex = 119;
      transformOrigin = 'right center';
    }

    return {
      translateX: relativePos === -1 ? `calc(-65% + ${restockDragDelta}px)` : `${translateX}px`,
      translateY,
      scale,
      opacity,
      blurPx,
      zIndex,
      transformOrigin,
      isActive: relativePos === 0,
    };
  };

  const getRestockVerticalStyle = (idx: number) => {
    const relativePos = idx - restockActiveIdx;
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
      translateY = restockDragDelta;
      zIndex = 120;
    } else if (relativePos === -1) {
      translateY = 10 + restockDragDelta * 0.35;
      scale = 0.98;
      opacity = 0.88;
      blurPx = 1;
      zIndex = 119;
    } else {
      translateY = -10 + restockDragDelta * 0.35;
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

  const renderRestockCardBody = (note: RestockNote, isActive: boolean) => {
    const totalQty = getRestockTotalQty(note);
    return (
      <>
        <div className="px-5 pt-5 pb-4 flex items-center justify-between gap-3 shrink-0 text-black bg-white border-b border-black/6">
          <div className="flex-1 min-w-0">
            <div className={`pos-subtext text-[10px] font-black mb-1 ${noteCardSubtextClass}`}>Restock batch</div>
            <div className="text-2xl font-black tracking-tighter truncate">{note.title}</div>
          </div>
        </div>
        <div className="flex-1 flex flex-col min-h-0 bg-white text-black">
          <div className="px-5 pt-4 pb-2 shrink-0">
            <p className="text-sm font-bold text-zinc-600">{formatCreatedStamp(new Date(note.timestamp))}</p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-2 custom-scrollbar">
            {note.lineItems.length > 0 ? (
              <div className="space-y-1">
                {note.lineItems.map((line) => (
                  <div key={line.itemId} className="flex items-center justify-between gap-4 text-sm font-medium">
                    <span className="min-w-0 truncate text-zinc-800">{line.name}</span>
                    <span className="shrink-0 tabular-nums font-black text-amber-600">× {line.qty}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">No line items</p>
            )}
          </div>
          <div className="shrink-0 px-5 py-4 border-t border-black/6 flex items-center justify-between">
            <span className="text-xl font-black tabular-nums text-amber-600">= {totalQty}</span>
          </div>
          {isActive && restockViewMode === 'horizontal' && restocks.length > 1 && (
            <div className="flex justify-center gap-1.5 pb-3.5 pt-1">
              {restocks.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Go to restock card ${i + 1}`}
                  onClick={() => selectRestockCard(i)}
                  className="p-0 border-none cursor-pointer transition-all duration-200"
                  style={{
                    width: i === restockActiveIdx ? 20 : 6,
                    height: 6,
                    borderRadius: 3,
                    background: i === restockActiveIdx ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.15)',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </>
    );
  };

  const renderRestockGridTile = (note: RestockNote, idx: number) => {
    const isSelected = idx === restockActiveIdx;
    const isBlurredPeer = restockGridZoomed && !isSelected;
    const isHiddenSelected = restockGridZoomed && isSelected;
    const totalQty = getRestockTotalQty(note);

    return (
      <button
        key={note.id}
        type="button"
        onClick={() => {
          if (restockGridZoomed && idx === restockActiveIdx) return;
          selectRestockCard(idx);
          setRestockGridZoomed(true);
        }}
        className={`text-left rounded-2xl p-3 sm:p-4 w-full aspect-[6/13] flex flex-col gap-1.5 transition-all duration-300 active:scale-[0.97] border ${
          isSelected && !restockGridZoomed
            ? 'bg-amber-500 text-white border-amber-500 shadow-lg'
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
          <span className={`pos-subtext text-[8px] font-black ${isSelected && !restockGridZoomed ? 'opacity-80' : 'opacity-45'}`}>
            Batch
          </span>
          <span className={`pos-subtext text-[9px] font-black shrink-0 ${isSelected && !restockGridZoomed ? 'opacity-90' : 'opacity-55'}`}>
            {note.lineItems.length}
          </span>
        </div>
        <div className="text-[11px] font-black tracking-tight leading-tight line-clamp-2 min-h-[2.4em]">
          {note.title}
        </div>
        <div className={`pos-subtext text-[10px] font-black mt-auto ${isSelected && !restockGridZoomed ? 'opacity-90' : 'opacity-60'}`}>
          = {totalQty}
        </div>
        {note.lineItems[0] && (
          <div className={`pos-subtext text-[8px] font-semibold leading-snug line-clamp-2 ${isSelected && !restockGridZoomed ? 'opacity-70' : 'opacity-45'}`}>
            {note.lineItems[0].name} × {note.lineItems[0].qty}
            {note.lineItems.length > 1 ? ` +${note.lineItems.length - 1}` : ''}
          </div>
        )}
      </button>
    );
  };

  const renderRestockVerticalStrip = (note: RestockNote) => (
    <div className="h-full px-4 flex items-center justify-between gap-3 border-b border-black/8 bg-white text-black">
      <div className="min-w-0 flex items-center gap-2">
        <span className={`pos-subtext text-[9px] font-black opacity-45 shrink-0 ${noteCardSubtextClass}`}>Batch</span>
        <span className="text-sm font-black tracking-tight truncate">{note.title}</span>
      </div>
      <span className="text-xs font-black shrink-0 opacity-70">= {getRestockTotalQty(note)}</span>
    </div>
  );

  const renderRestockViewToggle = () => (
    <div className="flex flex-wrap gap-2">
      {([
        { id: 'list' as const, label: 'List', icon: Icons.List },
        { id: 'horizontal' as const, label: 'Horizontal', icon: Icons.Carousel },
        { id: 'vertical' as const, label: 'Vertical', icon: Icons.Stack },
        { id: 'grid' as const, label: 'Grid', icon: Icons.Grid },
      ]).map(({ id, label, icon: Icon }) => {
        const active = restockViewMode === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              setRestockViewMode(id);
              setRestockGridZoomed(false);
              setRestockActiveIdx(0);
              setRestockDragDelta(0);
            }}
            className={`px-3 py-2 rounded-xl pos-subtext text-[10px] font-black border transition-all active:scale-95 flex items-center gap-1.5 ${
              active
                ? 'bg-amber-500 text-white border-amber-500'
                : isLight
                  ? 'bg-zinc-100 border-zinc-200 text-black'
                  : 'bg-white/5 border-white/10 text-white'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        );
      })}
    </div>
  );

  const renderRestockNotesSwitcher = () => {
    if (restocks.length === 0) {
      return (
        <div className={`rounded-2xl p-12 text-center ${levitateClass}`}>
          <p className={`pos-subtext text-[10px] font-black ${cardSubtextMutedClass}`}>No restock notes yet</p>
        </div>
      );
    }

    if (restockViewMode === 'list') {
      return (
        <div className={`rounded-2xl overflow-hidden ${levitateClass}`}>
          {restocks.map((note, idx) => {
            const totalQty = getRestockTotalQty(note);
            return (
              <button
                key={note.id}
                type="button"
                onClick={() => {
                  selectRestockCard(idx);
                  setRestockViewMode('horizontal');
                }}
                className={`w-full text-left px-8 py-6 flex flex-col ${idx !== restocks.length - 1 ? 'border-b border-white/10' : ''} active:opacity-80 transition-opacity`}
              >
                <div className={`font-black tracking-tight ${textColorClass}`}>{note.title}</div>
                <p className={`pos-subtext text-[10px] font-black mt-2 ${cardSubtextMutedClass}`}>
                  {formatCreatedStamp(new Date(note.timestamp))}
                </p>
                <div className={`mt-4 text-base font-black tabular-nums ${isLight ? 'text-amber-600' : 'text-amber-400'}`}>
                  = {totalQty}
                </div>
              </button>
            );
          })}
        </div>
      );
    }

    if (restockViewMode === 'grid') {
      return (
        <div className={`relative rounded-2xl overflow-hidden ${levitateClass} min-h-[min(70vh,520px)]`}>
          <div className="absolute inset-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 sm:p-4">
              <div className={`grid gap-2 sm:gap-3 content-start ${restockGridCols === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {restocks.map((note, idx) => renderRestockGridTile(note, idx))}
              </div>
            </div>
          </div>
          {restockGridZoomed && restocks[restockActiveIdx] && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-4 pointer-events-none">
              <div className="relative modal-portrait-6-13 pointer-events-auto select-none">
                <div className="absolute inset-0 flex flex-col rounded-[32px] overflow-hidden bg-white text-black shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
                  <div className="px-4 pt-4 pb-2 flex justify-end shrink-0 border-b border-black/6">
                    <button
                      type="button"
                      onClick={() => setRestockGridZoomed(false)}
                      className="p-2 rounded-full hover:bg-black/5 active:scale-90 transition-all text-black"
                      aria-label="Back to grid"
                    >
                      <Icons.X size={18} />
                    </button>
                  </div>
                  {renderRestockCardBody(restocks[restockActiveIdx], true)}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        className={`relative rounded-2xl overflow-visible ${levitateClass} flex items-center justify-center`}
        style={{ minHeight: 'min(70vh, 560px)' }}
      >
        <div
          ref={restockStageRef}
          className="relative modal-portrait-6-13 select-none overflow-visible w-full"
          style={{ touchAction: restockViewMode === 'horizontal' ? 'pan-x' : 'pan-y' }}
          onPointerDown={onRestockPointerDown}
          onPointerMove={onRestockPointerMove}
          onPointerUp={onRestockPointerUp}
          onPointerCancel={onRestockPointerUp}
          role="region"
          aria-label="Restock card switcher"
        >
          {restockViewMode === 'vertical'
            ? restocks.map((note, idx) => {
                const style = getRestockVerticalStyle(idx);
                if (style.hidden) return null;
                return (
                  <div
                    key={note.id}
                    className={`absolute left-0 right-0 flex flex-col rounded-[32px] overflow-hidden bg-white text-black shadow-[0_24px_80px_rgba(0,0,0,0.55)] ${style.isStrip ? 'mx-3' : 'inset-0'}`}
                    style={{
                      top: style.isStrip ? (idx < restockActiveIdx ? 0 : 'auto') : 0,
                      bottom: style.isStrip && idx > restockActiveIdx ? 0 : 'auto',
                      height: style.isStrip ? RESTOCK_VERTICAL_STRIP_HEIGHT : '100%',
                      transform: `translateX(${style.translateX}) translateY(${style.translateY}) scale(${style.scale})`,
                      transformOrigin: style.transformOrigin,
                      opacity: style.opacity,
                      zIndex: style.zIndex,
                      filter: style.blurPx > 0 ? `blur(${style.blurPx}px)` : 'none',
                      transition: restockIsDragging ? 'none' : 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease, filter 0.22s ease',
                      pointerEvents: style.isActive ? 'auto' : 'none',
                      cursor: style.isActive ? (restockIsDragging ? 'grabbing' : 'grab') : 'default',
                    }}
                  >
                    {style.isStrip ? renderRestockVerticalStrip(note) : renderRestockCardBody(note, style.isActive)}
                  </div>
                );
              })
            : restocks.map((note, idx) => {
                const style = getRestockHorizontalStyle(idx);
                return (
                  <div
                    key={note.id}
                    className="absolute inset-0 flex flex-col rounded-[32px] overflow-hidden bg-white text-black shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
                    style={{
                      transform: `translateX(${style.translateX}) translateY(${style.translateY}px) scale(${style.scale})`,
                      transformOrigin: style.transformOrigin,
                      opacity: style.opacity,
                      zIndex: style.zIndex,
                      filter: style.blurPx > 0 ? `blur(${style.blurPx}px)` : 'none',
                      transition: restockIsDragging ? 'none' : 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease, filter 0.22s ease',
                      pointerEvents: style.isActive ? 'auto' : 'none',
                      cursor: style.isActive ? (restockIsDragging ? 'grabbing' : 'grab') : 'default',
                    }}
                  >
                    {renderRestockCardBody(note, style.isActive)}
                  </div>
                );
              })}
        </div>
      </div>
    );
  };

  const renderRestockingView = () => (
    <div className="animate-fade-in space-y-8" role="tabpanel" aria-label="Restocking">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setRestockExpanded(false)}
          aria-label="Back to Vision Hub"
          className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
        </button>
        <button
          onClick={() => openRestockPopup()}
          className={`px-6 py-2.5 rounded-full font-black text-sm tracking-[0.5px] flex items-center gap-2 active:scale-95 transition-all shrink-0 ${isLight ? 'bg-amber-500 text-white shadow-lg' : 'bg-amber-500 text-white shadow-[0_0_16px_rgb(245,158,11)]'}`}
          aria-label="Add restock note"
        >
          + Add more
        </button>
      </div>
      <h3 className={`text-4xl font-black tracking-tighter px-2 ${textColorClass}`}>Restocking</h3>

      <div className={`rounded-2xl overflow-hidden ${levitateClass}`}>
        {restocks.length > 0 ? (
          restocks.map((note, idx) =>
            renderNotepadListRow(
              note.id,
              note.title,
              formatCreatedStamp(new Date(note.timestamp)),
              getRestockTotalQty(note),
              () => openRestockPopupForEdit(note),
              () => printRestockNotepad(note),
              canViewTransactions,
              idx,
              restocks.length,
              isLight ? 'text-amber-600' : 'text-amber-400'
            )
          )
        ) : (
          <div className="p-12 text-center">
            <p className={`pos-subtext text-[10px] font-black ${cardSubtextMutedClass}`}>No restock notes yet</p>
          </div>
        )}
      </div>
    </div>
  );

  const handleAddItem = () => {
    if (!newItemName.trim()) return;
    const now = new Date();
    const newItem: InventoryItem = {
      id: Date.now().toString(),
      name: newItemName,
      stock: 50,
      price: parseFloat(newItemPrice) || 0,
      threshold: 20,
      category: newItemCategory,
      dateAdded: now.toLocaleDateString(),
      supplier: 'Generic Systems',
      lastStocked: now.toISOString(),
      image: newItemImageUrl || '/assets/autoswipe/pos3.png',
      activities: [{
        id: Math.random().toString(),
        type: 'restock',
        action: 'Initial entry created',
        time: 'Just now',
        timestamp: Date.now(),
        profileName: activeProfileName,
      }]
    };
    setItems(prev => [newItem, ...prev]);
    setNewItemName('');
    setNewItemPrice('0');
    setNewItemImageUrl('');
    setIsAddingItem(false);
  };

  const getLogIcon = (type: DashboardLogEntry['type']) => {
    switch (type) {
      case 'restock': return <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-500"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg></div>;
      case 'sale': return <div className="p-1.5 rounded-lg bg-green-500/20 text-green-500"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="m17 5-5-3-5 3"/><path d="m17 19-5 3-5-3"/><path d="M2 12h20"/></svg></div>;
      case 'image-update': return <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-500"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>;
      case 'invoice-unidentified': return <div className="p-1.5 rounded-lg bg-red-500/20 text-red-500"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>;
      case 'invoice-add': return <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-500"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>;
      case 'price-update':
      case 'stock-update':
        return <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-500"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg></div>;
      default: return <div className={`p-1.5 rounded-lg ${isLight ? 'bg-black/10 text-black' : 'bg-white/10 text-white'}`}><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></div>;
    }
  };

  const openUnidentifiedPage = useCallback((log: DashboardLogEntry) => {
    if (!log.isUnidentified || log.price === undefined) return;
    setNamingUnidentified({ price: log.price, quantity: log.quantity ?? 1 });
    setNewItemName('');
    setNewItemPrice(String(log.price));
    setNewItemCategory('Hardware');
    setNewItemImageUrl('');
  }, []);

  const handleSaveUnidentifiedItem = useCallback(() => {
    if (!namingUnidentified || !newItemName.trim()) return;
    const now = Date.now();
    const price = namingUnidentified.price;
    const itemName = newItemName.trim();
    const newItem: InventoryItem = {
      id: now.toString(),
      name: itemName,
      stock: 50,
      price,
      threshold: 20,
      category: newItemCategory,
      dateAdded: new Date(now).toLocaleDateString(),
      supplier: 'Generic Systems',
      lastStocked: new Date(now).toISOString(),
      image: newItemImageUrl || '/assets/autoswipe/pos3.png',
      activities: [{
        id: `${now}-identified`,
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
    setNewItemImageUrl('');
  }, [namingUnidentified, newItemName, newItemCategory, newItemImageUrl, setItems, onResolveUnidentifiedPrice, activeProfileName]);

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
  const noteCardSubtextClass = 'text-black/60';
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
                id: `stock-update-${now}`,
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
    },
    [activeProfileName, setItems]
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
                id: `price-update-${now}`,
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
    },
    [activeProfileName, formatCurrency, setItems]
  );

  const getItemActivityLogs = (item: InventoryItem) => {
    const dayAgo = Date.now() - 86400000;
    return [...item.activities]
      .filter((log) => log.timestamp >= dayAgo)
      .sort((a, b) => b.timestamp - a.timestamp);
  };

  const handleLogRowClick = useCallback((log: DashboardLogEntry) => {
    if (log.isUnidentified && log.price !== undefined) {
      openUnidentifiedPage(log);
      return;
    }
    setActionLogsExpanded(true);
  }, [openUnidentifiedPage]);

  const renderActivityLogRows = (logs: DashboardLogEntry[], limit?: number, clickable = false) => {
    const slice = limit ? logs.slice(0, limit) : logs;
    if (slice.length === 0) {
      return (
        <p className={`pos-subtext text-[9px] font-black ${cardSubtextMutedClass}`}>No recent activity</p>
      );
    }
    return slice.map((log) => {
      const actorName = log.profileName ?? activeProfileName;
      const isUpdateLog = log.type === 'price-update' || log.type === 'stock-update';
      const rowClass = `w-full flex items-center justify-between gap-2 min-w-0 text-left ${clickable ? 'cursor-pointer hover:opacity-80 active:scale-[0.99] transition-all' : ''}`;
      const rowContent = (
        <>
          <div className="flex items-center gap-2 min-w-0">
            {getLogIcon(log.type)}
            <div className="flex flex-col min-w-0">
              <span className={`text-[10px] font-black tracking-tight truncate ${log.isUnidentified ? 'text-red-500' : isUpdateLog ? 'text-blue-500' : textColorClass}`}>
                {log.action}
              </span>
              {log.itemName && !isUpdateLog && (
                <span className={`pos-subtext text-[8px] font-bold truncate ${log.isUnidentified ? 'text-red-400' : cardSubtextMutedClass}`}>
                  {log.itemName}
                </span>
              )}
            </div>
          </div>
          <span className={`pos-subtext font-num-medium text-[9px] tabular-nums shrink-0 text-right italic ${cardSubtextMutedClass}`}>
            by:{actorName}{' '}
            {formatRequestElapsed(log.timestamp, currentTime)} ago
          </span>
        </>
      );
      if (!clickable) {
        return <div key={log.id} className={rowClass}>{rowContent}</div>;
      }
      return (
        <button key={log.id} type="button" onClick={() => handleLogRowClick(log)} className={rowClass}>
          {rowContent}
        </button>
      );
    });
  };

  const renderActionLogsPage = () => (
    <div className="animate-fade-in space-y-8" role="tabpanel" aria-label="Action logs">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => {
            setActionLogsExpanded(false);
            setShowActionLogSearch(false);
            setActionLogSearchQuery('');
          }}
          aria-label="Back to Vision Hub"
          className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
        </button>
        <button
          type="button"
          onClick={() => setShowActionLogSearch((v) => !v)}
          className={`w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-all ${showActionLogSearch ? (isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black') : (isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/10 text-white')}`}
          aria-label="Search action logs"
        >
          <Icons.Search size={18} />
        </button>
      </div>
      <h3 className={`text-4xl font-black tracking-tighter px-1 ${textColorClass}`}>Action Logs</h3>
      <p className={`app-subtext px-1 -mt-4 ${cardSubtextMutedClass}`}>Neural Ledger • 24h</p>

      {showActionLogSearch && (
        <input
          type="search"
          value={actionLogSearchQuery}
          onChange={(e) => setActionLogSearchQuery(e.target.value)}
          placeholder="Search logs..."
          className={`w-full px-4 py-3 rounded-xl outline-none text-sm font-bold ${isLight ? 'bg-white text-black border border-black/8' : 'bg-white/10 text-white border border-white/10'}`}
          autoFocus
        />
      )}

      <div className="flex gap-2 flex-wrap pb-1">
        {(['all', 'restock', 'sale', 'invoice', 'unidentified', 'updates', '24h', '48h', '7d'] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => setActionLogFilter(opt)}
            className={`px-3 py-2 rounded-full pos-subtext text-[9px] font-black transition-all ${actionLogFilter === opt ? (isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black') : (isLight ? 'bg-zinc-100 text-black' : 'bg-white/5 text-white')}`}
          >
            {opt === 'unidentified' ? 'Unidentified' : opt === 'updates' ? 'Updates' : opt}
          </button>
        ))}
      </div>

      <div className={`rounded-2xl overflow-hidden ${levitateClass}`}>
        {filteredActionLogs.length > 0 ? (
          filteredActionLogs.map((log, idx) => (
            <div key={log.id} className={`px-8 py-5 ${idx !== filteredActionLogs.length - 1 ? 'border-b border-white/10' : ''}`}>
              {renderActivityLogRows([log], undefined, true)}
            </div>
          ))
        ) : (
          <div className="p-12 text-center">
            <p className={`pos-subtext text-[10px] font-black ${cardSubtextMutedClass}`}>No matching logs</p>
          </div>
        )}
      </div>
    </div>
  );

  const renderNamingUnidentifiedPage = () => (
    <div className="animate-fade-in space-y-8" role="tabpanel" aria-label="Name unidentified item">
      <button
        onClick={() => setNamingUnidentified(null)}
        aria-label="Back to action logs"
        className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Back
      </button>
      <h3 className={`text-4xl font-black tracking-tighter px-1 ${textColorClass}`}>New Item</h3>
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
          className={`w-full p-6 rounded-2xl outline-none font-black text-lg ${isLight ? 'bg-zinc-50 text-zinc-900' : 'bg-black/40 text-white'}`}
          autoFocus
        />
        <div className="grid grid-cols-2 gap-4">
          <input
            type="number"
            value={newItemPrice}
            readOnly
            className={`p-6 rounded-2xl outline-none font-black opacity-70 ${isLight ? 'bg-zinc-50 text-zinc-900' : 'bg-black/40 text-white'}`}
            aria-label="Price from invoice"
          />
          <select
            value={newItemCategory}
            onChange={(e) => setNewItemCategory(e.target.value)}
            className={`p-6 rounded-2xl outline-none font-black appearance-none ${isLight ? 'bg-zinc-50 text-zinc-900' : 'bg-black/40 text-white'}`}
          >
            <option value="Hardware">Hardware</option>
            <option value="Optics">Optics</option>
          </select>
        </div>
        <input
          type="text"
          value={newItemImageUrl}
          onChange={(e) => setNewItemImageUrl(e.target.value)}
          placeholder="Image URL (optional)"
          className={`w-full p-6 rounded-2xl outline-none font-black ${isLight ? 'bg-zinc-50 text-zinc-900' : 'bg-black/40 text-white'}`}
        />
        <button
          type="button"
          onClick={handleSaveUnidentifiedItem}
          disabled={!newItemName.trim()}
          className="w-full py-6 rounded-2xl text-black font-black uppercase tracking-[0.4em] text-[11px] active:scale-95 shadow-2xl transition-all disabled:opacity-40"
          style={{ backgroundColor: accentColor }}
        >
          Add Item & Update Log
        </button>
      </div>
    </div>
  );

  const renderInventoryProductTile = (item: InventoryItem, idx: number, showAllLogs = false) => {
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
      <div key={item.id} className="flex flex-col gap-2 min-w-0">
        <div
          role="listitem"
          tabIndex={0}
          aria-label={`Inventory item ${idx + 1}: ${item.name}, stock ${item.stock} units, price ¢${item.price}`}
          onClick={() => setSelectedItem(item)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedItem(item); } }}
          className={`group rounded-xl overflow-hidden cursor-pointer ${levitateClass} relative focus:outline-none focus:ring-2 focus:ring-white/40`}
        >
          <div className="relative aspect-square overflow-hidden bg-zinc-100 dark:bg-zinc-800">
            <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 h-[42%] bg-linear-to-t from-black/95 via-black/40 to-transparent pointer-events-none" aria-hidden="true" />
            <div className="absolute bottom-3 left-3 right-3 flex flex-col pointer-events-none" aria-hidden="true">
              <div className="flex flex-col items-start gap-0.5">
                <div className="flex-1 min-w-0">
                  <h4 className="text-[11px] font-black tracking-tight leading-tight truncate text-white">{item.name}</h4>
                  <p className={`pos-subtext text-[8px] font-black truncate ${heroSubtextClass}`}>{item.category}</p>
                </div>
                <span className="text-[10px] font-black text-white whitespace-nowrap">¢{item.price}</span>
              </div>
            </div>
            <div className="absolute top-2 right-2" aria-hidden="true">
              <div className={`pos-subtext px-2 py-1 rounded-lg text-[9px] font-black backdrop-blur-3xl shadow-xl ${item.stock < item.threshold ? 'bg-red-500 text-white' : 'bg-black/60 text-white'}`}>
                {item.stock}u
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-1.5 px-0.5">
          {renderActivityLogRows(logs, showAllLogs ? undefined : 3)}
        </div>
      </div>
    );
  };

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
      <div className="animate-fade-in space-y-8" role="tabpanel" aria-label={`${item.name} details`}>
        <button
          onClick={() => setSelectedItem(null)}
          aria-label="Back to Asset Hub"
          className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Asset Hub
        </button>

        <div className={`rounded-2xl overflow-hidden ${levitateClass}`}>
          <div className="relative h-56 sm:h-72">
            <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent" aria-hidden="true" />
          </div>
          <div className={`p-8 space-y-8 ${textColorClass}`}>
            <div className="flex justify-between items-start gap-4">
              <h3 className="text-4xl font-black tracking-tighter leading-tight">{item.name}</h3>
              <span className={`px-5 py-2 rounded-2xl pos-subtext text-[10px] font-black shrink-0 ${cardSubtextClass} ${isLight ? 'bg-zinc-100' : 'bg-white/10'}`}>{item.category}</span>
            </div>
            <div className="grid grid-cols-2 gap-8">
              <div>
                <p className={`pos-subtext text-[10px] font-black mb-2 ${cardSubtextMutedClass}`}>Inventory</p>
                {canEditStock ? (
                  <div className="flex items-baseline gap-2">
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
                    <span className={`text-xl font-black ${cardSubtextMutedClass}`}>U</span>
                  </div>
                ) : (
                  <p className={`text-3xl font-black ${item.stock < item.threshold ? 'text-red-500' : ''}`}>{item.stock} U</p>
                )}
              </div>
              <div>
                <p className={`pos-subtext text-[10px] font-black mb-2 ${cardSubtextMutedClass}`}>Credit Rate</p>
                {canEditPrice ? (
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
                ) : (
                  <p className="text-3xl font-black">¢{item.price}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className={`rounded-2xl p-8 ${levitateClass}`}>
          <h4 className={`text-xl font-black tracking-tighter mb-5 ${textColorClass}`}>Action Logs</h4>
          <div className="space-y-4">
            {renderActivityLogRows(logs, undefined, true)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`pos-dashboard-root fixed inset-0 z-200 flex flex-col ${isOpen ? 'pos-dashboard-root--open' : 'pos-dashboard-root--closed'}`}>
      <div className={`pos-dashboard pos-dashboard-shell relative w-full h-full flex flex-col ${isLight ? 'pos-dashboard-shell--light' : 'pos-dashboard-shell--dark'} ${visionHubFocus ? 'pos-dashboard-shell--hub-focus' : ''} ${(isAddingItem || showAddRequestPopup || showAddRestockPopup || showSuppliersPanel) ? 'pos-dashboard-shell--dimmed' : ''}`}>

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
            queuedNotepad={queuedNotepadPrint}
            onQueuedNotepadConsumed={() => setQueuedNotepadPrint(null)}
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
            drawerMode={settings.visionHubDrawerMode ?? 'drag'}
          />
        )}

        {/* MAIN SCROLLABLE CONTENT */}
        <div className={`pos-dashboard-hub-blur-target flex-1 overflow-y-auto px-6 space-y-10 custom-scrollbar pb-16 scroll-smooth`}>
          {hubCollapsed ? (
            <div className="grid grid-cols-2 gap-6 pt-4">
              
              {/* PERFORMANCE MICRO CARDS — real values for @admin, masked for mini-profiles */}
              <div className="col-span-2 grid grid-cols-2 gap-5">
                {[
                  { label: 'Monthly Rev', val: formatCurrency(stats.monthlyRev.toFixed(2)), onClick: () => setMonthlyRevExpanded(true) },
                  { label: 'Daily Sales', val: formatCurrency(stats.dailyRev.toFixed(2)), onClick: () => setDailySalesExpanded(true) },
                  { label: 'Avg Customer', val: formatCurrency(stats.avgPerCustomer.toFixed(2)), onClick: () => setAvgCustomerExpanded(true) },
                  { label: 'Invoices Today', val: String(stats.invoicesToday), onClick: () => setInvoicesTodayExpanded(true) },
                ].map((card, idx) => (
                  <div
                    key={idx}
                    onClick={canViewTransactions ? card.onClick : undefined}
                    className={`p-7 rounded-xl ${levitateClass} ${canViewTransactions ? 'cursor-pointer active:scale-[0.98]' : 'opacity-75'}`}
                    role={canViewTransactions ? 'button' : undefined}
                    tabIndex={canViewTransactions ? 0 : undefined}
                    onKeyDown={canViewTransactions ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.onClick!(); } } : undefined}
                    aria-label={canViewTransactions ? card.label : `${card.label}, admin only`}
                  >
                    <p className={`pos-subtext text-[9px] font-black mb-2 ${cardSubtextMutedClass}`}>{card.label}</p>
                    <p
                      className="text-2xl font-black tracking-tight"
                      style={{ color: canViewTransactions ? accentColor : undefined }}
                    >
                      {canViewTransactions ? card.val : '*****'}
                    </p>
                    {!canViewTransactions && (
                      <p className={`pos-subtext text-[8px] font-black mt-1 ${cardSubtextMutedClass}`}>@admin only</p>
                    )}
                  </div>
                ))}
              </div>

              {/* INVENTORY MASTER CARD - TEXTS FITTED MARGINALLY */}
              <div onClick={() => setInventoryExpanded(true)} className={`col-span-2 aspect-16/10 rounded-2xl ${levitateClass} relative overflow-hidden group cursor-pointer active:scale-[0.98]`}>
                <img src={WALLPAPER_IMAGE_URLS[3]} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110 opacity-70 dark:opacity-50" />
                <div className="absolute inset-x-0 bottom-0 h-[65%] bg-linear-to-t from-black/95 via-black/30 to-transparent pointer-events-none" />
                <div className="absolute inset-0 p-8 flex flex-col justify-between">
                  <div className="flex items-center gap-5 translate-y-2">
                    <div className="p-4 rounded-[13px] bg-orange-500/20 text-orange-500 backdrop-blur-3xl shadow-2xl border border-white/10"><Icons.Scientific size={28} /></div>
                    <span className={`pos-subtext text-[10px] font-black opacity-90 drop-shadow-md ${heroSubtextClass}`}>Live Matrix</span>
                  </div>
                  <div className="space-y-1 relative z-10 translate-y-2">
                    <div className="flex items-end justify-between">
                      <div className="text-7xl font-black tracking-tighter text-white drop-shadow-[0_8px_24px_rgba(0,0,0,0.7)]">{stats.stockLevel}%</div>
                      <div className="text-right pb-3">
                        <p className={`pos-subtext text-[9px] font-black mb-1.5 ${heroSubtextClass}`}>Network Load</p>
                        <div className={`pos-subtext px-4 py-1.5 rounded-full text-[9px] font-black backdrop-blur-3xl shadow-2xl ${stats.criticalItems > 0 ? 'bg-red-500/80 text-white' : 'bg-green-500/80 text-white'}`}>
                          {stats.criticalItems} Alerts
                        </div>
                      </div>
                    </div>
                    <div className="pt-2">
                      <p className={`app-subtext leading-relaxed max-w-[280px] ${heroSubtextClass}`}>Inventory flow optimized within margins. Real-time neural processing active.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* TWO CARDS BELOW INVENTORY: Requests + Restocking */}
              <div 
                onClick={() => setRequestsExpanded(true)} 
                className={`col-span-1 aspect-[16/10] rounded-2xl ${levitateClass} relative overflow-hidden group cursor-pointer active:scale-[0.985] p-6 flex flex-col justify-between`}
              >
                <div className="flex items-start justify-between">
                  <div className="p-3.5 rounded-2xl bg-emerald-500/20 text-emerald-500 shadow-inner">
                    <Icons.Requests size={26} />
                  </div>
                  <div className={`pos-subtext text-[10px] font-black px-3 py-1 rounded-full bg-emerald-500/10 ${cardSubtextClass}`}>Requests</div>
                </div>
                <div>
                  <div className={`text-3xl font-black tracking-tighter ${textColorClass}`}>Requests</div>
                  <p className={`app-subtext mt-0.5 ${cardSubtextMutedClass}`}>Pending • Delivered • Out of Stock</p>
                  <div className={`mt-2 text-xs font-black ${cardSubtextClass}`}>
                    {requests.filter(r => r.status === 'pending').length} active
                  </div>
                </div>
              </div>

              <div 
                onClick={() => setRestockExpanded(true)} 
                className={`col-span-1 aspect-[16/10] rounded-2xl ${levitateClass} relative overflow-hidden group cursor-pointer active:scale-[0.985] p-6 flex flex-col justify-between`}
              >
                <div className="flex items-start justify-between">
                  <div className="p-3.5 rounded-2xl bg-amber-500/20 text-amber-500 shadow-inner">
                    <Icons.Restock size={26} />
                  </div>
                  <div className={`pos-subtext text-[10px] font-black px-3 py-1 rounded-full bg-amber-500/10 ${cardSubtextClass}`}>Restocking</div>
                </div>
                <div>
                  <div className={`text-3xl font-black tracking-tighter ${textColorClass}`}>Restocking</div>
                  <p className={`app-subtext mt-0.5 ${cardSubtextMutedClass}`}>Low stock replenishment</p>
                  <div className={`mt-2 text-xs font-black ${cardSubtextClass}`}>
                    {items.filter(i => i.stock < i.threshold).length} items need attention
                  </div>
                </div>
              </div>

              {/* ACTION LOGS */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setActionLogsExpanded(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActionLogsExpanded(true); } }}
                className={`col-span-2 p-10 rounded-2xl ${levitateClass} text-left cursor-pointer active:scale-[0.99] transition-all`}
                aria-label="Open all action logs"
              >
                <div className="flex justify-between items-center mb-8">
                   <div className="space-y-1">
                      <h3 className={`text-2xl font-black tracking-tighter ${textColorClass}`}>Action Logs</h3>
                      <p className={`app-subtext ${cardSubtextMutedClass}`}>Neural Ledger • 24h</p>
                   </div>
                   <div className="p-3.5 rounded-full bg-blue-500/10 text-blue-500 shadow-xl"><Icons.Trends size={24} /></div>
                </div>
                <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
                  {systemLogs.length > 0 ? (
                    renderActivityLogRows(systemLogs, 8, true)
                  ) : (
                    <div className="py-16 text-center space-y-3">
                       <p className={`pos-subtext text-[10px] font-black ${cardSubtextMutedClass}`}>No Log Data</p>
                    </div>
                  )}
                </div>
              </div>

            </div>
          ) : namingUnidentified ? (
            renderNamingUnidentifiedPage()
          ) : actionLogsExpanded ? (
            renderActionLogsPage()
          ) : canViewTransactions && monthlyRevExpanded ? (
            <div className={`animate-fade-in space-y-8 ${textColorClass}`} role="tabpanel" aria-label="Monthly revenue">
              <button
                onClick={() => setMonthlyRevExpanded(false)}
                aria-label="Back to Vision Hub"
                className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
              </button>
              <h3 className={`text-4xl font-black tracking-tighter px-2 ${textColorClass}`}>Monthly Revenue</h3>
              <p className={`pos-subtext text-[10px] px-1 -mt-4 ${cardSubtextMutedClass}`}>{formatCurrency(stats.monthlyRev.toFixed(2))} this month • sorted by date</p>
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
                          <div className={`text-lg font-black tracking-tight truncate ${statDetailTextClass}`}>{row.name}</div>
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
            <div className={`animate-fade-in space-y-8 ${textColorClass}`} role="tabpanel" aria-label="Daily sales">
              <button
                onClick={() => setDailySalesExpanded(false)}
                aria-label="Back to Vision Hub"
                className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
              </button>
              <h3 className={`text-4xl font-black tracking-tighter px-2 ${textColorClass}`}>Daily Sales</h3>
              <p className={`pos-subtext text-[10px] px-1 -mt-4 ${cardSubtextMutedClass}`}>{formatCurrency(stats.dailyRev.toFixed(2))} today • sorted by time</p>
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
                          <div className={`text-lg font-black tracking-tight truncate ${statDetailTextClass}`}>{row.name}</div>
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
            <div className={`animate-fade-in space-y-8 ${textColorClass}`} role="tabpanel" aria-label="Customer print history">
              <button
                onClick={() => setAvgCustomerExpanded(false)}
                aria-label="Back to Vision Hub"
                className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
              </button>
              <h3 className={`text-4xl font-black tracking-tighter px-2 ${textColorClass}`}>Customers</h3>
              <p className={`pos-subtext text-[10px] px-1 -mt-4 ${cardSubtextMutedClass}`}>Invoice names • print count</p>
              <div className={`rounded-2xl overflow-hidden relative ${statDetailCardClass}`}>

                <div className="relative">
                {customerPrintCounts.length > 0 ? (
                  customerPrintCounts.map((customer, idx) => (
                    <div
                      key={customer.name}
                      className={`px-8 py-7 flex items-center justify-between gap-4 ${idx !== customerPrintCounts.length - 1 ? `border-b ${statDetailBorderClass}` : ''}`}
                    >
                      <div className={`font-black tracking-tight text-lg ${statDetailTextClass}`}>{customer.name}</div>
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
            <div className={`animate-fade-in space-y-8 ${textColorClass}`} role="tabpanel" aria-label="Invoices today">
              <button
                onClick={() => setInvoicesTodayExpanded(false)}
                aria-label="Back to Vision Hub"
                className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
              </button>
              <h3 className={`text-4xl font-black tracking-tighter px-2 ${textColorClass}`}>Invoices Today</h3>
              <p className={`pos-subtext text-[10px] px-1 -mt-4 ${cardSubtextMutedClass}`}>Sorted by most recent activity</p>
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
                          <div className={`text-lg font-black tracking-tight truncate ${statDetailTextClass}`}>{card.name}</div>
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
            selectedItem ? renderInventoryItemPage() : (
            <div className="animate-fade-in space-y-8" role="tabpanel" aria-label="Asset Hub inventory">
              {/* Original inventory expanded view is preserved here */}
              <div className="sticky top-0 z-50 py-4 backdrop-blur-3xl bg-current/5 rounded-3xl -mx-4 px-6 mb-6">
                <div className="flex flex-col gap-5">
                  <div className="flex items-center justify-between">
                    <button 
                      onClick={() => { setSelectedItem(null); setInventoryExpanded(false); }} 
                      aria-label="Back to Vision Hub"
                      className={`flex items-center gap-3 p-3 pr-5 rounded-2xl ${isLight ? 'bg-white shadow-md text-zinc-900' : 'bg-white/10 text-zinc-100'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
                    </button>
                    <div className={`flex items-center gap-3 ${textColorClass}`}>
                      <h3 className="text-2xl font-black tracking-tighter">Asset Hub</h3>
                      <button
                        type="button"
                        onClick={() => setShowSuppliersPanel(true)}
                        className={`px-4 py-2 rounded-full font-black text-[9px] tracking-[0.2em] uppercase active:scale-95 transition-all ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/10 text-white'}`}
                        aria-label="Open suppliers list"
                      >
                        Suppliers list
                      </button>
                      <button onClick={() => setShowPlusMenu(!showPlusMenu)} className="p-4 rounded-full shadow-2xl text-white active:scale-90 transition-all" style={{ backgroundColor: accentColor }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                      <div className="flex items-center gap-1 shrink-0" role="group" aria-label="Sort inventory">
                        {INVENTORY_SORT_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setSortOption(opt.id)}
                            aria-pressed={sortOption === opt.id}
                            className={`px-3 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${sortOption === opt.id ? hubChipActiveClass : hubChipInactiveClass}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1" role="group" aria-label="Time filter options">
                        {INVENTORY_FILTER_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setFilterOption(opt.id)}
                            aria-pressed={filterOption === opt.id}
                            className={`px-3 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${filterOption === opt.id ? hubChipActiveClass : hubChipInactiveClass}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 pb-20" role="list" aria-label="Inventory items">
                {filteredInventory.map((item, idx) => renderInventoryProductTile(item, idx))}
              </div>
            </div>
            )
          ) : requestsExpanded ? (
            /* REQUESTS EXPANDED VIEW */
            <div className="animate-fade-in space-y-8" role="tabpanel" aria-label="Requests screen">
              {/* HEADER: Back + Green floating "+ Add more" (shadow light, glow dark) */}
              <div className="flex items-center justify-between">
                <button 
                  onClick={() => setRequestsExpanded(false)} 
                  aria-label="Back to Vision Hub"
                  className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
                </button>

                <button
                  onClick={openRequestPopup}
                  className={`px-6 py-2.5 rounded-full font-black text-sm tracking-[0.5px] flex items-center gap-2 active:scale-95 transition-all ${isLight ? 'bg-emerald-500 text-white shadow-lg' : 'bg-emerald-500 text-white shadow-[0_0_16px_rgb(16,185,129)]'}`}
                  aria-label="Add more request"
                >
                  + Add more
                </button>
              </div>

              <h3 className={`text-4xl font-black tracking-tighter px-1 ${textColorClass}`}>Requests</h3>

              {/* 3 TOP TABS: Pending, Delivered, Out Of Stock */}
              <div className="flex gap-2 pb-2">
                {(['pending', 'delivered', 'outofstock'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setRequestTab(tab)}
                    className={`px-5 py-2 rounded-full text-xs font-black uppercase tracking-[1.5px] transition-all ${requestTab === tab 
                      ? (isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black') 
                      : (isLight ? 'bg-zinc-100 text-black' : 'bg-white/5 text-white')}`}
                  >
                    {tab === 'outofstock' ? 'Out Of Stock' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Requests list */}
              <div className={`rounded-2xl overflow-hidden ${levitateClass}`}>
                {filteredRequests.length > 0 ? (
                  filteredRequests.map((req, idx) => renderRequestRow(req, idx, filteredRequests.length))
                ) : (
                  <div className="p-12 text-center">
                    <p className={`pos-subtext text-[10px] font-black ${cardSubtextMutedClass}`}>No {requestTab} requests</p>
                  </div>
                )}
              </div>
            </div>
          ) : restockExpanded ? (
            renderRestockingView()
          ) : canViewTransactions && purchasesExpanded ? (
            <div className="animate-fade-in space-y-8" role="tabpanel" aria-label="Transaction Archive">
              <button 
                onClick={() => setPurchasesExpanded(false)} 
                aria-label="Back to Vision Hub"
                className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Back
              </button>
              <h3 className={`text-4xl font-black tracking-tighter px-2 ${textColorClass}`}>Transaction Archive</h3>

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
                      <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-x-0 bottom-0 h-[42%] bg-linear-to-t from-black/95 via-black/40 to-transparent pointer-events-none" aria-hidden="true" />
                      <div className="absolute bottom-3 left-3 right-3 flex flex-col pointer-events-none" aria-hidden="true">
                         <div className="flex flex-col items-start gap-0.5">
                           <div className="flex-1 min-w-0">
                             <h4 className="text-[11px] font-black tracking-tight leading-tight truncate text-white">{item.name}</h4>
                             <p className={`pos-subtext text-[8px] font-black truncate ${heroSubtextClass}`}>{item.category}</p>
                           </div>
                           <span className="text-[10px] font-black text-white whitespace-nowrap">¢{item.price}</span>
                         </div>
                      </div>
                      <div className="absolute top-2 right-2" aria-hidden="true">
                        <div className={`pos-subtext px-2 py-1 rounded-lg text-[9px] font-black backdrop-blur-3xl shadow-xl ${item.stock < item.threshold ? 'bg-red-500 text-white' : 'bg-black/60 text-white'}`}>
                          {item.stock}u
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : inventoryExpanded ? (
            selectedItem ? renderInventoryItemPage() : (
            <div className="animate-fade-in space-y-8" role="tabpanel" aria-label="Asset Hub inventory">
              {/* HUB CONTROLS BAR (original inventory view) */}
              <div className="sticky top-0 z-50 py-4 backdrop-blur-3xl bg-current/5 rounded-3xl -mx-4 px-6 mb-6">
                <div className="flex flex-col gap-5">
                  <div className="flex items-center justify-between">
                    <button 
                      onClick={() => { setSelectedItem(null); setInventoryExpanded(false); }} 
                      aria-label="Back to Vision Hub"
                      className={`flex items-center gap-3 p-3 pr-5 rounded-2xl ${isLight ? 'bg-white shadow-md text-zinc-900' : 'bg-white/10 text-zinc-100'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
                    </button>
                    <div className={`flex items-center gap-3 ${textColorClass}`}>
                      <h3 className="text-2xl font-black tracking-tighter">Asset Hub</h3>
                      <button
                        type="button"
                        onClick={() => setShowSuppliersPanel(true)}
                        className={`px-4 py-2 rounded-full font-black text-[9px] tracking-[0.2em] uppercase active:scale-95 transition-all ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/10 text-white'}`}
                        aria-label="Open suppliers list"
                      >
                        Suppliers list
                      </button>
                      <button 
                        onClick={() => setShowPlusMenu(!showPlusMenu)}
                        aria-label="Open quick actions menu"
                        className="p-4 rounded-full shadow-2xl text-white active:scale-90 transition-all" 
                        style={{ backgroundColor: accentColor }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      </button>
                    </div>
                  </div>
                  {/* filters etc... */}
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                      <select 
                        value={sortOption} 
                        onChange={(e) => setSortOption(e.target.value as SortOption)} 
                        aria-label="Sort inventory"
                        className={`p-3 rounded-xl font-black text-[9px] uppercase tracking-widest border-none outline-none min-w-[120px] ${isLight ? 'bg-white shadow-sm' : 'bg-white/10 text-white'}`}
                      >
                        <option value="a-z">Sort: A-Z</option>
                        <option value="high-stock">Stock: High-Low</option>
                        <option value="low-stock">Stock: Low-High</option>
                      </select>
                      <div className="flex items-center gap-1" role="group" aria-label="Time filter options">
                        {['all', '24h', '48h', '3d', '7d', 'custom'].map((opt) => (
                          <button 
                            key={opt} 
                            onClick={() => setFilterOption(opt as FilterOption)} 
                            aria-pressed={filterOption === opt}
                            className={`px-3 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${filterOption === opt ? (isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black') : (isLight ? 'bg-white shadow-sm text-black' : 'bg-white/5 text-white')}`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* custom date etc if needed, truncated for edit safety */}
                  </div>
                </div>
              </div>
              {/* The full inventory grid content continues in original (kept short for replace) - original content stays below */}
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 pb-20" role="list" aria-label="Inventory items">
                {filteredInventory.map((item, idx) => renderInventoryProductTile(item, idx))}
              </div>
            </div>
            )
          ) : requestsExpanded ? (
            /* REQUESTS SCREEN */
            <div className="animate-fade-in space-y-8" role="tabpanel" aria-label="Requests screen">
              {/* HEADER */}
              <div className="flex items-center justify-between">
                <button 
                  onClick={() => setRequestsExpanded(false)} 
                  aria-label="Back to Vision Hub"
                  className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
                </button>

                {/* GREEN FLOATING + ADD MORE BUTTON */}
                <button
                  onClick={openRequestPopup}
                  className={`px-6 py-2.5 rounded-full font-black text-sm tracking-[0.5px] flex items-center gap-2 active:scale-95 transition-all ${isLight ? 'bg-emerald-500 text-white shadow-lg' : 'bg-emerald-500 text-white shadow-[0_0_16px_rgb(16,185,129)]'}`}
                  aria-label="Add more request"
                >
                  + Add more
                </button>
              </div>

              <h3 className={`text-4xl font-black tracking-tighter px-1 ${textColorClass}`}>Requests</h3>

              {/* 3 TABS */}
              <div className="flex gap-2 border-b pb-1 border-white/10">
                {(['pending', 'delivered', 'outofstock'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setRequestTab(tab)}
                    className={`px-5 py-2 rounded-full text-xs font-black uppercase tracking-[1.5px] transition-all ${requestTab === tab 
                      ? (isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black') 
                      : (isLight ? 'bg-zinc-100 text-black' : 'bg-white/5 text-white')}`}
                  >
                    {tab === 'outofstock' ? 'Out Of Stock' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Requests list */}
              <div className={`rounded-2xl overflow-hidden ${levitateClass}`}>
                {filteredRequests.length > 0 ? (
                  filteredRequests.map((req, idx) => renderRequestRow(req, idx, filteredRequests.length))
                ) : (
                  <div className="p-12 text-center">
                    <p className={`pos-subtext text-[10px] font-black ${cardSubtextMutedClass}`}>No {requestTab} requests</p>
                  </div>
                )}
              </div>
            </div>
          ) : restockExpanded ? (
            renderRestockingView()
          ) : canViewTransactions ? (
            /* PURCHASES / TRANSACTION ARCHIVE (original) */
            <div className="animate-fade-in space-y-8" role="tabpanel" aria-label="Transaction Archive">
              <button 
                onClick={() => setPurchasesExpanded(false)} 
                aria-label="Back to Vision Hub"
                className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Back
              </button>
              <h3 className={`text-4xl font-black tracking-tighter px-2 ${textColorClass}`}>Transaction Archive</h3>
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
                          <span className={`text-xl font-black tracking-tight ${textColorClass}`}>{card.name}</span>
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
                    <p className={`app-subtext text-[10px] opacity-45 mt-2 ${textColorClass}`}>Transactions appear after a confirmed print</p>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* PLUS / QUICK ACTIONS MENU */}
      {showPlusMenu && (
        <div className="fixed inset-0 z-300 flex items-end justify-center p-6" role="presentation" aria-hidden={!showPlusMenu}>
          <div className={`absolute inset-0 cursor-pointer ${isLight ? 'bg-[#f2f2f7]' : 'bg-[#0a0a0c]'}`} onClick={() => setShowPlusMenu(false)} aria-hidden="true" />
          <div 
            className={`relative w-full max-w-xs rounded-2xl p-6 transition-all duration-500 cubic-bezier(0.16, 1, 0.3, 1) ${levitateClass} shadow-[0_100px_200px_rgba(0,0,0,0.8)]`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="plus-menu-title"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 id="plus-menu-title" className={`text-xl font-black tracking-tighter ${textColorClass}`}>Quick Actions</h3>
              <button onClick={() => setShowPlusMenu(false)} aria-label="Close quick actions menu" className="p-2 rounded-full opacity-60 hover:opacity-100"><Icons.X size={18} /></button>
            </div>
            <div className="space-y-2">
              <button 
                onClick={() => { setShowPlusMenu(false); setIsAddingItem(true); }} 
                aria-label="Create new inventory entry"
                className={`w-full flex items-center justify-between p-6 rounded-[18.2px] transition-all duration-150 active:scale-95 ${isLight ? 'bg-zinc-50' : 'bg-white/5'}`}
              >
                <span className={`font-black ${textColorClass}`}>Add New Asset</span>
                <span aria-hidden="true">＋</span>
              </button>
              {canViewTransactions && (
              <button 
                onClick={() => { setShowPlusMenu(false); setPurchasesExpanded(true); }} 
                aria-label="View full transaction archive"
                className={`w-full flex items-center justify-between p-6 rounded-[18.2px] transition-all duration-150 active:scale-95 ${isLight ? 'bg-zinc-50' : 'bg-white/5'}`}
              >
                <span className={`font-black ${textColorClass}`}>View Transaction Archive</span>
                <span aria-hidden="true">→</span>
              </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* REQUESTS ADD MORE POPUP — matches invoice switcher motion + notepad shell */}
      {showAddRequestPopup && (
        <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center p-4 pb-6 sm:pb-4 pointer-events-auto" role="presentation">
          <div
            className={`absolute inset-0 opacity-100 transition-opacity duration-280 ${isLight ? 'bg-[#f2f2f7]' : 'bg-[#0a0a0c]'}`}
            onClick={closeRequestPopup}
            aria-hidden="true"
          />

          <div
            className="relative modal-portrait-6-13 opacity-100 scale-100 translate-y-0 transition-all duration-500"
          >
            <div
              className={`absolute inset-0 flex flex-col rounded-[32px] overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.55)] ${
                isLight ? 'bg-[#faf8f2] text-zinc-900' : 'bg-[#171614] text-zinc-100'
              }`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="request-notepad-title"
            >
              <div
                className="px-4 pt-4 pb-3 flex items-start gap-3 border-b shrink-0"
                style={{
                  borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
                }}
              >
                <div className="flex-1 min-w-0">
                  <input
                    id="request-notepad-title"
                    type="text"
                    value={newRequesterName}
                    onChange={(e) => setNewRequesterName(e.target.value)}
                    placeholder="Requester name"
                    className={`w-full bg-transparent outline-none text-lg font-black tracking-tight placeholder:opacity-30 ${
                      isLight ? 'text-black' : 'text-white'
                    }`}
                    autoFocus
                  />
                  {requestCreatedStamp && (
                    <p className={`pos-subtext text-[10px] font-bold mt-1 ${isLight ? 'text-zinc-600' : 'text-zinc-400'}`}>
                      {requestCreatedStamp}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canViewTransactions && (
                    <button
                      type="button"
                      onClick={() => printRequestNotepad()}
                      disabled={requestLineItems.length === 0 && !newRequesterName.trim()}
                      className={`w-10 h-10 rounded-full flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.22)] active:scale-90 transition-all disabled:opacity-40 ${
                        isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'
                      }`}
                      aria-label="Print request notepad"
                    >
                      <Icons.Printer size={18} />
                    </button>
                  )}
                  <button
                    onClick={closeRequestPopup}
                    className={`w-10 h-10 rounded-full flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.22)] active:scale-90 transition-all ${
                      isLight ? 'bg-white text-black' : 'bg-[#1c1c1e] text-white'
                    }`}
                    aria-label="Close add request"
                  >
                    <Icons.X size={18} />
                  </button>
                  <button
                    onClick={saveRequest}
                    disabled={!newRequesterName.trim() || requestLineItems.length === 0}
                    className={`w-10 h-10 rounded-full flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.22)] active:scale-90 transition-all disabled:opacity-40 ${
                      isLight ? 'bg-emerald-500 text-white' : 'bg-emerald-500 text-white shadow-[0_0_14px_rgb(16,185,129)]'
                    }`}
                    aria-label="Save request"
                  >
                    <Icons.Check size={18} />
                  </button>
                </div>
              </div>

              <div
                className="flex-1 min-h-0 flex flex-col"
                style={{
                  backgroundImage: isLight
                    ? 'repeating-linear-gradient(transparent, transparent 27px, rgba(0,0,0,0.035) 27px, rgba(0,0,0,0.035) 28px)'
                    : 'repeating-linear-gradient(transparent, transparent 27px, rgba(255,255,255,0.04) 27px, rgba(255,255,255,0.04) 28px)',
                }}
              >
                <InventoryNotepad
                  isLight={isLight}
                  items={items}
                  lineItems={requestLineItems}
                  onLineItemsChange={setRequestLineItems}
                  composeQuery={requestComposeQuery}
                  onComposeQueryChange={setRequestComposeQuery}
                  freeNotes={requestFreeNotes}
                  onFreeNotesChange={setRequestFreeNotes}
                  accentClass={isLight ? 'text-emerald-600' : 'text-emerald-400'}
                  emptyHint="Type to add products…"
                  showUpdateButton
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUPPLIERS LIST */}
      {showSuppliersPanel && (
        <div className="fixed inset-0 z-[410] flex items-end sm:items-center justify-center p-4 pb-6 sm:pb-4 pointer-events-auto" role="presentation">
          <div
            className={`absolute inset-0 opacity-100 transition-opacity duration-280 ${isLight ? 'bg-[#f2f2f7]' : 'bg-[#0a0a0c]'}`}
            onClick={() => setShowSuppliersPanel(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md opacity-100 scale-100 translate-y-0 transition-all duration-500">
            <div
              className={`rounded-[28px] overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.55)] ${levitateClass}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="suppliers-panel-title"
            >
              <div className={`px-6 py-5 flex items-center justify-between border-b ${isLight ? 'border-zinc-200' : 'border-white/10'}`}>
                <h3 id="suppliers-panel-title" className={`text-xl font-black tracking-tight ${textColorClass}`}>Suppliers list</h3>
                <button
                  type="button"
                  onClick={() => setShowSuppliersPanel(false)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-all ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/10 text-white'}`}
                  aria-label="Close suppliers list"
                >
                  <Icons.X size={18} />
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                {suppliers.length > 0 ? (
                  suppliers.map((supplier, idx) => (
                    <div
                      key={supplier.id}
                      className={`px-6 py-5 ${idx !== suppliers.length - 1 ? `border-b ${isLight ? 'border-zinc-100' : 'border-white/10'}` : ''}`}
                    >
                      <div className={`font-black tracking-tight ${textColorClass}`}>{supplier.name}</div>
                      <div className={`pos-subtext text-[10px] font-black mt-2 ${cardSubtextClass}`}>
                        {supplier.totalItemsReceived} items received
                      </div>
                      <div className={`pos-subtext text-[10px] font-black mt-1 ${cardSubtextMutedClass}`}>
                        Last: {formatCreatedStamp(new Date(supplier.lastReceivedAt))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center">
                    <p className={`pos-subtext text-[10px] font-black ${cardSubtextMutedClass}`}>No suppliers yet</p>
                    <p className={`app-subtext text-[10px] opacity-45 mt-2 ${textColorClass}`}>Suppliers appear when stock is received</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RESTOCK NOTEPAD — same shell as request popup */}
      {showAddRestockPopup && (
        <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center p-4 pb-6 sm:pb-4 pointer-events-auto" role="presentation">
          <div
            className={`absolute inset-0 opacity-100 transition-opacity duration-280 ${isLight ? 'bg-[#f2f2f7]' : 'bg-[#0a0a0c]'}`}
            onClick={closeRestockPopup}
            aria-hidden="true"
          />

          <div className="relative modal-portrait-6-13 opacity-100 scale-100 translate-y-0 transition-all duration-500">
            <div
              className={`absolute inset-0 flex flex-col rounded-[32px] overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.55)] ${
                isLight ? 'bg-[#faf8f2] text-zinc-900' : 'bg-[#171614] text-zinc-100'
              }`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="restock-notepad-title"
            >
              <div
                className="px-4 pt-4 pb-3 flex items-start gap-3 border-b shrink-0"
                style={{
                  borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
                }}
              >
                <div className="flex-1 min-w-0">
                  <input
                    id="restock-notepad-title"
                    type="text"
                    value={newRestockTitle}
                    onChange={(e) => setNewRestockTitle(e.target.value)}
                    placeholder="Batch name"
                    className={`w-full bg-transparent outline-none text-lg font-black tracking-tight placeholder:opacity-30 ${
                      isLight ? 'text-black' : 'text-white'
                    }`}
                    autoFocus
                  />
                  {restockCreatedStamp && (
                    <p className={`pos-subtext text-[10px] font-bold mt-1 ${isLight ? 'text-zinc-600' : 'text-zinc-400'}`}>
                      {restockCreatedStamp}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canViewTransactions && (
                    <button
                      type="button"
                      onClick={() => printRestockNotepad()}
                      disabled={restockLineItems.length === 0}
                      className={`w-10 h-10 rounded-full flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.22)] active:scale-90 transition-all disabled:opacity-40 ${
                        isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'
                      }`}
                      aria-label="Print restock notepad"
                    >
                      <Icons.Printer size={18} />
                    </button>
                  )}
                  <button
                    onClick={closeRestockPopup}
                    className={`w-10 h-10 rounded-full flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.22)] active:scale-90 transition-all ${
                      isLight ? 'bg-white text-black' : 'bg-[#1c1c1e] text-white'
                    }`}
                    aria-label="Close restock note"
                  >
                    <Icons.X size={18} />
                  </button>
                  <button
                    onClick={saveRestockNote}
                    disabled={restockLineItems.length === 0}
                    className={`w-10 h-10 rounded-full flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.22)] active:scale-90 transition-all disabled:opacity-40 ${
                      isLight ? 'bg-emerald-500 text-white' : 'bg-emerald-500 text-white shadow-[0_0_14px_rgb(16,185,129)]'
                    }`}
                    aria-label="Save restock note"
                  >
                    <Icons.Check size={18} />
                  </button>
                </div>
              </div>

              <div
                className="flex-1 min-h-0 flex flex-col"
                style={{
                  backgroundImage: isLight
                    ? 'repeating-linear-gradient(transparent, transparent 27px, rgba(0,0,0,0.035) 27px, rgba(0,0,0,0.035) 28px)'
                    : 'repeating-linear-gradient(transparent, transparent 27px, rgba(255,255,255,0.04) 27px, rgba(255,255,255,0.04) 28px)',
                }}
              >
                <InventoryNotepad
                  isLight={isLight}
                  items={items}
                  lineItems={restockLineItems}
                  onLineItemsChange={setRestockLineItems}
                  composeQuery={restockComposeQuery}
                  onComposeQueryChange={setRestockComposeQuery}
                  freeNotes={restockFreeNotes}
                  onFreeNotesChange={setRestockFreeNotes}
                  accentClass={isLight ? 'text-amber-600' : 'text-amber-400'}
                  emptyHint="Type to add products…"
                  showUpdateButton
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADD ITEM MODAL */}
      {isAddingItem && (
        <div className="fixed inset-0 z-350 flex items-center justify-center p-6" role="presentation" aria-hidden={!isAddingItem}>
          <div className={`absolute inset-0 cursor-pointer ${isLight ? 'bg-[#f2f2f7]' : 'bg-[#0a0a0c]'}`} onClick={() => setIsAddingItem(false)} aria-hidden="true" />
          <div 
            className={`relative w-full max-w-sm rounded-2xl p-12 transition-all duration-500 cubic-bezier(0.16, 1, 0.3, 1) ${levitateClass} shadow-[0_128px_256px_rgba(0,0,0,1)]`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-item-title"
          >
             {isAddingItem && (
               <div className={`space-y-10 ${textColorClass}`}>
                 <h3 id="add-item-title" className="text-5xl font-black tracking-tighter">New Asset</h3>
                 <div className="space-y-6">
                   <input type="text" value={newItemName} onChange={(e) => setNewItemName(e.target.value)} placeholder="Neural ID" aria-label="New asset name" className={`w-full p-8 rounded-[26px] outline-none font-black text-lg ${isLight ? 'bg-zinc-50 text-zinc-900' : 'bg-black/40 text-white'}`} />
                   <div className="grid grid-cols-2 gap-5">
                     <input type="number" value={newItemPrice} onChange={(e) => setNewItemPrice(e.target.value)} placeholder="Rate" aria-label="New asset price" className={`p-8 rounded-[26px] outline-none font-black ${isLight ? 'bg-zinc-50 text-zinc-900' : 'bg-black/40 text-white'}`} />
                     <select value={newItemCategory} onChange={(e) => setNewItemCategory(e.target.value)} aria-label="New asset category" className={`p-8 rounded-[26px] outline-none font-black appearance-none ${isLight ? 'bg-zinc-50 text-zinc-900' : 'bg-black/40 text-white'}`}><option value="Hardware">Hardware</option><option value="Optics">Optics</option></select>
                   </div>
                   <input type="text" value={newItemImageUrl} onChange={(e) => setNewItemImageUrl(e.target.value)} placeholder="Visual Feed URL" aria-label="New asset image URL" className={`w-full p-8 rounded-[26px] outline-none font-black ${isLight ? 'bg-zinc-50 text-zinc-900' : 'bg-black/40 text-white'}`} />
                 </div>
                 <button onClick={handleAddItem} aria-label="Manifest new asset" className="w-full py-8 rounded-[26px] text-black font-black uppercase tracking-[0.5em] text-[12px] active:scale-95 shadow-2xl transition-all" style={{ backgroundColor: accentColor }}>Create Asset</button>
               </div>
             )}
          </div>
        </div>
      )}

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
        canInstallApp={canInstallApp}
        isAppInstalled={isAppInstalled}
        onInstallApp={onInstallApp}
      />

    </div>
  );
};

export default POSDashboard;