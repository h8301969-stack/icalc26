import React, { useMemo, useState, useEffect } from 'react';
import { HistoryItem, InvoiceActionLog, InvoicePrintLog, CartLineItem } from '../types';
import { formatPosLineItemDisplay } from '../utils/posExpression';
import { Icons } from '../constants';
import { InventoryItem, ActivityLogEntry, PurchaseRecord } from '../hooks/usePOS';
import SettingsPanel from './SettingsPanel';
import { WALLPAPER_IMAGE_URLS } from '../utils/wallpapers';

interface POSDashboardProps {
  history: HistoryItem[];
  items: InventoryItem[];
  setItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  purchases: PurchaseRecord[];
  setPurchases: React.Dispatch<React.SetStateAction<PurchaseRecord[]>>;
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
    themeMode: 'light' | 'dark';
    disableCalculatorCard?: boolean;
    layoutMode?: 'portrait' | 'landscape';
    profiles?: import('../types').UserProfile[];
    activeProfileId?: string;
    currency?: string;
  };
  updateSettings: (keyOrPatch: string | Record<string, unknown>, value?: unknown) => void;
  onInvoicePrinted?: (invoiceName: string, total: string, items: CartLineItem[]) => void;
}

type SortOption = 'a-z' | 'high-stock' | 'low-stock';
type FilterOption = 'all' | '24h' | '48h' | '3d' | '7d' | '14d' | 'custom';

interface InvoiceCard {
  id: string;
  name: string;
  items: CartLineItem[];
  logs: InvoiceActionLog[];
  total: string;
  isCurrent: boolean;
  latestTimestamp: number;
}

type RequestStatus = 'pending' | 'delivered' | 'outofstock';

interface RequestItem {
  id: string;
  requester: string;
  notes: string;
  status: RequestStatus;
  timestamp: number;
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

const POSDashboard: React.FC<POSDashboardProps> = ({
  history: _history,
  items,
  setItems,
  purchases,
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
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [inventoryExpanded, setInventoryExpanded] = useState(false);
  const [purchasesExpanded, setPurchasesExpanded] = useState(false);
  const [avgCustomerExpanded, setAvgCustomerExpanded] = useState(false);
  const [invoicesTodayExpanded, setInvoicesTodayExpanded] = useState(false);
  const [monthlyRevExpanded, setMonthlyRevExpanded] = useState(false);
  const [dailySalesExpanded, setDailySalesExpanded] = useState(false);
  const [requestsExpanded, setRequestsExpanded] = useState(false);
  const [restockExpanded, setRestockExpanded] = useState(false);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [isRestocking, setIsRestocking] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isThemeAnimating, setIsThemeAnimating] = useState(false);
  const [isSettingsAnimating, setIsSettingsAnimating] = useState(false);
  const [isCloseAnimating, setIsCloseAnimating] = useState(false);
  
  const [sortOption, setSortOption] = useState<SortOption>('a-z');
  const [filterOption, setFilterOption] = useState<FilterOption>('all');
  const [customDateStart, setCustomDateStart] = useState('');
  const [customDateEnd, setCustomDateEnd] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('0');
  const [newItemCategory, setNewItemCategory] = useState('Hardware');
  const [newItemImageUrl, setNewItemImageUrl] = useState('');
  const [restockQty, setRestockQty] = useState('25');
  const [restockSupplier, setRestockSupplier] = useState('');

  // Requests feature states
  const [requestTab, setRequestTab] = useState<'pending' | 'delivered' | 'outofstock'>('pending');
  const [showAddRequestPopup, setShowAddRequestPopup] = useState(false);
  const [newRequesterName, setNewRequesterName] = useState('');
  const [requestNotes, setRequestNotes] = useState('');

  // Sample requests data (in real app would come from hook/storage)
  const [requests, setRequests] = useState<RequestItem[]>([
    { id: 'req1', requester: 'Marcus Chen', notes: 'Neural Processor X1 — urgent', status: 'pending', timestamp: Date.now() - 1000 * 60 * 45 },
    { id: 'req2', requester: 'Sarah Okonkwo', notes: 'Optic Glass v26 batch', status: 'delivered', timestamp: Date.now() - 1000 * 60 * 60 * 27 },
    { id: 'req3', requester: 'James Rivera', notes: 'Sensor Array replacements', status: 'pending', timestamp: Date.now() - 1000 * 60 * 60 * 5 },
    { id: 'req4', requester: 'Amina Hassan', notes: 'Power cells — low stock', status: 'outofstock', timestamp: Date.now() - 1000 * 60 * 90 },
  ]);

  // Keyboard accessibility: close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showAddRequestPopup) {
          closeRequestPopup();
        } else if (requestsExpanded) {
          setRequestsExpanded(false);
        } else if (restockExpanded) {
          setRestockExpanded(false);
        } else if (inventoryExpanded) {
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
  }, [isOpen, onClose, showAddRequestPopup, requestsExpanded, restockExpanded, inventoryExpanded, purchasesExpanded, avgCustomerExpanded, invoicesTodayExpanded, monthlyRevExpanded, dailySalesExpanded]);

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
      .filter((card) => card.items.length > 0);
  }, [printLogs, invoiceActionLogs, invoiceName]);

  const todayStart = useMemo(
    () => new Date(new Date().setHours(0, 0, 0, 0)).getTime(),
    [currentTime]
  );

  const monthStart = useMemo(
    () => new Date(currentTime.getFullYear(), currentTime.getMonth(), 1).getTime(),
    [currentTime]
  );

  const stats = useMemo(() => {
    const invoiceMonthlyRev = paidInvoiceCards
      .filter((c) => c.latestTimestamp >= monthStart)
      .reduce((acc, c) => acc + (parseFloat(c.total) || 0), 0);
    const invoiceDailyRev = paidInvoiceCards
      .filter((c) => c.latestTimestamp >= todayStart)
      .reduce((acc, c) => acc + (parseFloat(c.total) || 0), 0);
    const purchaseMonthlyRev = purchases
      .filter((p) => p.timestamp >= monthStart)
      .reduce((acc, p) => acc + p.total, 0);
    const purchaseDailyRev = purchases
      .filter((p) => p.timestamp >= todayStart)
      .reduce((acc, p) => acc + p.total, 0);

    const monthlyRev = invoiceMonthlyRev + purchaseMonthlyRev;
    const dailyRev = invoiceDailyRev + purchaseDailyRev;
    const totalRev = paidInvoiceCards.reduce((acc, c) => acc + (parseFloat(c.total) || 0), 0)
      + purchases.reduce((acc, p) => acc + p.total, 0);
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
  }, [paidInvoiceCards, purchases, items, monthStart, todayStart]);

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

    purchases
      .filter((p) => p.timestamp >= monthStart)
      .forEach((p) => {
        rows.push({
          id: p.id,
          name: p.itemName,
          total: p.total,
          timestamp: p.timestamp,
          items: [{ price: p.price, quantity: p.quantity, name: p.itemName }],
          kind: 'purchase',
        });
      });

    return rows.sort((a, b) => b.timestamp - a.timestamp);
  }, [paidInvoiceCards, purchases, monthStart]);

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

    purchases
      .filter((p) => p.timestamp >= todayStart)
      .forEach((p) => {
        rows.push({
          id: p.id,
          name: p.itemName,
          total: p.total,
          timestamp: p.timestamp,
          items: [{ price: p.price, quantity: p.quantity, name: p.itemName }],
          kind: 'purchase',
        });
      });

    return rows.sort((a, b) => b.timestamp - a.timestamp);
  }, [paidInvoiceCards, purchases, todayStart]);

  const hubCollapsed = !inventoryExpanded && !purchasesExpanded && !requestsExpanded
    && !restockExpanded && !avgCustomerExpanded && !invoicesTodayExpanded
    && !monthlyRevExpanded && !dailySalesExpanded;

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

  const systemLogs = useMemo(() => {
    const dayAgo = Date.now() - 86400000;
    return items
      .flatMap(item => item.activities.map(log => ({ ...log, itemName: item.name })))
      .filter(log => log.timestamp >= dayAgo)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [items]);

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

  const addNewRequest = () => {
    const requester = newRequesterName.trim();
    if (!requester) return;
    const newReq: RequestItem = {
      id: 'req-' + Date.now(),
      requester,
      notes: requestNotes.trim(),
      status: 'pending',
      timestamp: Date.now(),
    };
    setRequests(prev => [newReq, ...prev]);
    setNewRequesterName('');
    setRequestNotes('');
    setShowAddRequestPopup(false);
  };

  const closeRequestPopup = () => {
    setShowAddRequestPopup(false);
    setNewRequesterName('');
    setRequestNotes('');
  };

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
      activities: [{ id: Math.random().toString(), type: 'restock', action: 'Initial entry created', time: 'Just now', timestamp: Date.now() }]
    };
    setItems(prev => [newItem, ...prev]);
    setNewItemName('');
    setNewItemPrice('0');
    setNewItemImageUrl('');
    setIsAddingItem(false);
  };

  const submitRestock = () => {
    if (!selectedItem) return;
    const qty = parseInt(restockQty) || 0;
    const now = new Date();
    setItems(prev => prev.map(item => 
      item.id === selectedItem.id ? { 
        ...item, stock: item.stock + qty, lastStocked: now.toISOString(), supplier: restockSupplier || item.supplier,
        activities: [{ id: Date.now().toString(), type: 'restock', action: `Restocked ${qty} units`, time: 'Just now', timestamp: Date.now() }, ...item.activities]
      } : item
    ));
    setIsRestocking(false);
    setSelectedItem(null);
  };

  const getLogIcon = (type: ActivityLogEntry['type']) => {
    switch (type) {
      case 'restock': return <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-500"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg></div>;
      case 'sale': return <div className="p-1.5 rounded-lg bg-green-500/20 text-green-500"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="m17 5-5-3-5 3"/><path d="m17 19-5 3-5-3"/><path d="M2 12h20"/></svg></div>;
      case 'image-update': return <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-500"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>;
      default: return <div className="p-1.5 rounded-lg bg-zinc-500/20 text-zinc-500"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></div>;
    }
  };

  const levitateClass = isLight
    ? 'bg-white shadow-[0_16px_36px_rgba(0,0,0,0.12)] hover:shadow-[0_24px_48px_rgba(0,0,0,0.16)] transition-all duration-500 cubic-bezier(0.16, 1, 0.3, 1)'
    : 'pos-dashboard-card-glass border border-white/10 hover:-translate-y-0.5 active:scale-[0.99] transition-all duration-500 cubic-bezier(0.16, 1, 0.3, 1)';

  const textColorClass = isLight ? 'text-black' : 'text-white';
  const mutedTextClass = isLight ? 'text-black' : 'text-white';
  const statDetailCardClass = isLight
    ? 'bg-zinc-900 text-white shadow-[0_16px_36px_rgba(0,0,0,0.28)]'
    : 'pos-dashboard-card-glass border border-white/10 text-white';
  const statDetailTextClass = 'text-white';
  const statDetailBorderClass = isLight ? 'border-white/15' : 'border-white/20';

  return (
    <div className={`fixed inset-0 z-200 flex flex-col ${isOpen ? 'opacity-100 pointer-events-auto animate-insight-pop' : 'opacity-0 pointer-events-none transition-opacity duration-300'}`}>
      <div className={`pos-dashboard relative w-full h-full flex flex-col transition-all duration-200 backdrop-blur-[44px] ${isLight ? 'bg-white/95' : 'bg-[#050505]/95'} ${(isAddingItem || isRestocking || showAddRequestPopup) ? 'blur-2xl scale-[0.98]' : ''}`}>
        
        {/* DASHBOARD HEADER PORTION WITH THEME-INVERTED FIXED BAR */}
        {hubCollapsed && (
          <div className="relative pt-8 px-6 pb-6 overflow-hidden shrink-0 z-60">
             {/* Drag handle removed per request */}
             
             {/* THE THEME-INVERTED HEADER BAR */}
             <div className={`
               w-full rounded-xl p-8 shadow-[0_32px_80px_rgba(0,0,0,0.25)] transition-all duration-500
               ${isLight ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-900'}
             `}>
               <div className="flex justify-between items-start">
                 <div className="flex flex-col">
                    <span className="pos-subtext text-[9px] font-black tracking-[0.4em] mb-1 opacity-40">Neural Terminal</span>
                    <h2 className="vision-hub-title text-4xl font-black tracking-tighter">Vision Hub</h2>
                    
                    <div className="mt-4 flex items-center gap-3">
                      <div className="font-num-medium text-xl tracking-tight leading-none">{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      <div className={`w-px h-4 ${isLight ? 'bg-white/20' : 'bg-zinc-900/20'}`} />
                      <div className="pos-subtext text-[9px] font-bold opacity-30 tracking-[0.2em]">Live Session</div>
                    </div>
                 </div>

                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => { updateSettings('themeMode', isLight ? 'dark' : 'light'); setIsThemeAnimating(true); }} 
                      onAnimationEnd={() => setIsThemeAnimating(false)}
                      className={`h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200 ${isThemeAnimating ? 'animate-plus-trigger' : ''} ${isLight ? 'bg-black/40 border-white/5 hover:bg-black/60 text-white shadow-[0_0_15px_rgba(255,255,255,0.65)] hover:shadow-[0_0_22px_rgba(255,255,255,0.85)] hover:scale-105' : 'bg-zinc-100 border-zinc-200 hover:bg-zinc-200 text-zinc-900 shadow-[0_8px_20px_rgba(0,0,0,0.28)] hover:shadow-[0_12px_28px_rgba(0,0,0,0.42)] hover:scale-105'}`}
                      title="Toggle Theme"
                    >
                      {isLight ? <Icons.Moon size={16} /> : <Icons.Sun size={16} />}
                    </button>
                    <button 
                      onClick={() => { setIsSettingsOpen(true); setIsSettingsAnimating(true); }} 
                      onAnimationEnd={() => setIsSettingsAnimating(false)}
                      className={`h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200 ${isSettingsAnimating ? 'animate-plus-trigger' : ''} ${isLight ? 'bg-black/40 border-white/5 hover:bg-black/60 text-white shadow-[0_0_15px_rgba(255,255,255,0.65)] hover:shadow-[0_0_22px_rgba(255,255,255,0.85)] hover:scale-105' : 'bg-zinc-100 border-zinc-200 hover:bg-zinc-200 text-zinc-900 shadow-[0_8px_20px_rgba(0,0,0,0.28)] hover:shadow-[0_12px_28px_rgba(0,0,0,0.42)] hover:scale-105'}`}
                      title="Settings"
                    >
                      <Icons.Settings size={16} />
                    </button>
                    <button 
                      onClick={() => { onClose(); setIsCloseAnimating(true); }} 
                      onAnimationEnd={() => setIsCloseAnimating(false)}
                      className={`h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200 ${isCloseAnimating ? 'animate-plus-trigger' : ''} ${isLight ? 'bg-black/40 border-white/5 hover:bg-black/60 text-white shadow-[0_0_15px_rgba(255,255,255,0.65)] hover:shadow-[0_0_22px_rgba(255,255,255,0.85)] hover:scale-105' : 'bg-zinc-100 border-zinc-200 hover:bg-zinc-200 text-zinc-900 shadow-[0_8px_20px_rgba(0,0,0,0.28)] hover:shadow-[0_12px_28px_rgba(0,0,0,0.42)] hover:scale-105'}`}
                      title="Close"
                    >
                      <Icons.X size={16} />
                    </button>
                  </div>
               </div>
             </div>
          </div>
        )}

        {/* MAIN SCROLLABLE CONTENT */}
        <div className="flex-1 overflow-y-auto px-6 space-y-10 custom-scrollbar pb-16 scroll-smooth">
          {hubCollapsed ? (
            <div className="grid grid-cols-2 gap-6 pt-4">
              
              {/* PERFORMANCE MICRO CARDS */}
              <div className="col-span-2 grid grid-cols-2 gap-5">
                {[
                  { label: 'Monthly Rev', val: formatCurrency(stats.monthlyRev.toFixed(2)), onClick: () => setMonthlyRevExpanded(true) },
                  { label: 'Daily Sales', val: formatCurrency(stats.dailyRev.toFixed(2)), onClick: () => setDailySalesExpanded(true) },
                  { label: 'Avg Customer', val: formatCurrency(stats.avgPerCustomer.toFixed(2)), onClick: () => setAvgCustomerExpanded(true) },
                  { label: 'Invoices Today', val: stats.invoicesToday, onClick: () => setInvoicesTodayExpanded(true) },
                ].map((card, idx) => (
                  <div
                    key={idx}
                    onClick={card.onClick}
                    className={`p-7 rounded-xl ${levitateClass} ${card.onClick ? 'cursor-pointer active:scale-[0.98]' : ''}`}
                    role={card.onClick ? 'button' : undefined}
                    tabIndex={card.onClick ? 0 : undefined}
                    onKeyDown={card.onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.onClick!(); } } : undefined}
                  >
                    <p className={`pos-subtext text-[9px] font-black tracking-[0.3em] mb-2 ${mutedTextClass}`}>{card.label}</p>
                    <p className="text-2xl font-black tracking-tight" style={{ color: accentColor }}>{card.val}</p>
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
                    <span className="pos-subtext text-[11px] font-black tracking-[0.4em] opacity-90 text-white drop-shadow-md">Live Matrix</span>
                  </div>
                  <div className="space-y-1 relative z-10 translate-y-2">
                    <div className="flex items-end justify-between">
                      <div className="text-7xl font-black tracking-tighter text-white drop-shadow-[0_8px_24px_rgba(0,0,0,0.7)]">{stats.stockLevel}%</div>
                      <div className="text-right pb-3">
                        <p className="pos-subtext text-[9px] font-black tracking-[0.3em] text-white/50 mb-1.5">Network Load</p>
                        <div className={`pos-subtext px-4 py-1.5 rounded-full text-[9px] font-black tracking-widest backdrop-blur-3xl shadow-2xl ${stats.criticalItems > 0 ? 'bg-red-500/80 text-white' : 'bg-green-500/80 text-white'}`}>
                          {stats.criticalItems} Alerts
                        </div>
                      </div>
                    </div>
                    <div className="pt-2">
                      <p className="app-subtext text-white/40 leading-relaxed max-w-[280px] opacity-50">Inventory flow optimized within margins. Real-time neural processing active.</p>
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
                  <div className="pos-subtext text-[10px] font-black px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-500 tracking-widest">Requests</div>
                </div>
                <div>
                  <div className={`text-3xl font-black tracking-tighter ${textColorClass}`}>Requests</div>
                  <p className={`app-subtext mt-0.5 opacity-50 ${mutedTextClass}`}>Pending • Delivered • Out of Stock</p>
                  <div className={`mt-2 text-xs font-black ${mutedTextClass}`}>
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
                  <div className="pos-subtext text-[10px] font-black px-3 py-1 rounded-full bg-amber-500/10 text-amber-500 tracking-widest">Restocking</div>
                </div>
                <div>
                  <div className={`text-3xl font-black tracking-tighter ${textColorClass}`}>Restocking</div>
                  <p className={`app-subtext mt-0.5 opacity-50 ${mutedTextClass}`}>Low stock replenishment</p>
                  <div className={`mt-2 text-xs font-black ${mutedTextClass}`}>
                    {items.filter(i => i.stock < i.threshold).length} items need attention
                  </div>
                </div>
              </div>

              {/* ACTION LOGS */}
              <div className={`col-span-2 p-10 rounded-2xl ${levitateClass}`}>
                <div className="flex justify-between items-center mb-8">
                   <div className="space-y-1">
                      <h3 className={`text-2xl font-black tracking-tighter ${textColorClass}`}>Action Logs</h3>
                      <p className={`app-subtext opacity-50 ${mutedTextClass}`}>Neural Ledger • 24h</p>
                   </div>
                   <div className="p-3.5 rounded-full bg-blue-500/10 text-blue-500 shadow-xl"><Icons.Trends size={24} /></div>
                </div>
                <div className="space-y-6">
                  {systemLogs.length > 0 ? (
                    systemLogs.slice(0, 8).map((log, idx) => (
                      <div key={log.id} className="flex items-center justify-between gap-5 animate-fade-in group" style={{ animationDelay: `${idx * 60}ms` }}>
                        <div className="flex items-center gap-4 min-w-0">
                          {getLogIcon(log.type)}
                          <div className="flex flex-col min-w-0">
                            <span className={`text-[14px] font-black tracking-tight truncate ${textColorClass}`}>{log.action}</span>
                            <span className={`pos-subtext text-[9px] font-bold tracking-[0.2em] truncate ${mutedTextClass}`}>{log.itemName}</span>
                          </div>
                        </div>
                        <span className={`pos-subtext text-[9px] font-black whitespace-nowrap ${mutedTextClass}`}>{log.time}</span>
                      </div>
                    ))
                  ) : (
                    <div className="py-16 text-center space-y-3">
                       <p className={`pos-subtext text-[11px] font-black tracking-[0.4em] ${mutedTextClass}`}>No Log Data</p>
                    </div>
                  )}
                </div>
              </div>

            </div>
          ) : monthlyRevExpanded ? (
            <div className={`animate-fade-in space-y-8 ${textColorClass}`} role="tabpanel" aria-label="Monthly revenue">
              <button
                onClick={() => setMonthlyRevExpanded(false)}
                aria-label="Back to Vision Hub"
                className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
              </button>
              <h3 className={`text-4xl font-black tracking-tighter px-2 ${textColorClass}`}>Monthly Revenue</h3>
              <p className={`pos-subtext text-sm px-1 -mt-4 ${mutedTextClass}`}>{formatCurrency(stats.monthlyRev.toFixed(2))} this month • sorted by date</p>
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
                          <div className={`pos-subtext text-[10px] font-black tracking-[0.2em] mb-0.5 ${statDetailTextClass}`}>
                            {row.kind === 'invoice' ? 'Invoice' : 'Sale'}
                          </div>
                          <div className={`text-lg font-black tracking-tight truncate ${statDetailTextClass}`}>{row.name}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-base font-black" style={{ color: accentColor }}>{formatCurrency(row.total.toFixed(2))}</div>
                        </div>
                      </div>
                      <div className={`pos-subtext text-[10px] font-black tracking-[0.2em] mb-3 ${statDetailTextClass}`}>
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
                    <p className={`pos-subtext text-[11px] font-black tracking-[2px] ${statDetailTextClass}`}>No revenue this month</p>
                  </div>
                )}
                </div>
              </div>
            </div>
          ) : dailySalesExpanded ? (
            <div className={`animate-fade-in space-y-8 ${textColorClass}`} role="tabpanel" aria-label="Daily sales">
              <button
                onClick={() => setDailySalesExpanded(false)}
                aria-label="Back to Vision Hub"
                className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
              </button>
              <h3 className={`text-4xl font-black tracking-tighter px-2 ${textColorClass}`}>Daily Sales</h3>
              <p className={`pos-subtext text-sm px-1 -mt-4 ${mutedTextClass}`}>{formatCurrency(stats.dailyRev.toFixed(2))} today • sorted by time</p>
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
                          <div className={`pos-subtext text-[10px] font-black tracking-[0.2em] mb-0.5 ${statDetailTextClass}`}>
                            {row.kind === 'invoice' ? 'Invoice' : 'Sale'}
                          </div>
                          <div className={`text-lg font-black tracking-tight truncate ${statDetailTextClass}`}>{row.name}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-base font-black" style={{ color: accentColor }}>{formatCurrency(row.total.toFixed(2))}</div>
                        </div>
                      </div>
                      <div className={`pos-subtext text-[10px] font-black tracking-[0.2em] mb-3 ${statDetailTextClass}`}>
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
                    <p className={`pos-subtext text-[11px] font-black tracking-[2px] ${statDetailTextClass}`}>No sales today</p>
                  </div>
                )}
                </div>
              </div>
            </div>
          ) : avgCustomerExpanded ? (
            <div className={`animate-fade-in space-y-8 ${textColorClass}`} role="tabpanel" aria-label="Customer print history">
              <button
                onClick={() => setAvgCustomerExpanded(false)}
                aria-label="Back to Vision Hub"
                className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
              </button>
              <h3 className={`text-4xl font-black tracking-tighter px-2 ${textColorClass}`}>Customers</h3>
              <p className={`pos-subtext text-sm px-1 -mt-4 ${mutedTextClass}`}>Invoice names • print count</p>
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
                        <div className={`pos-subtext text-[10px] font-black tracking-widest ${statDetailTextClass}`}>Printed</div>
                        <div className="text-2xl font-black" style={{ color: accentColor }}>{customer.printCount}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center">
                    <p className={`pos-subtext text-[11px] font-black tracking-[2px] ${statDetailTextClass}`}>No customers yet</p>
                  </div>
                )}
                </div>
              </div>
            </div>
          ) : invoicesTodayExpanded ? (
            <div className={`animate-fade-in space-y-8 ${textColorClass}`} role="tabpanel" aria-label="Invoices today">
              <button
                onClick={() => setInvoicesTodayExpanded(false)}
                aria-label="Back to Vision Hub"
                className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
              </button>
              <h3 className={`text-4xl font-black tracking-tighter px-2 ${textColorClass}`}>Invoices Today</h3>
              <p className={`pos-subtext text-sm px-1 -mt-4 ${mutedTextClass}`}>Sorted by most recent activity</p>
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
                          <div className={`pos-subtext text-[10px] font-black tracking-[0.2em] mb-0.5 ${statDetailTextClass}`}>
                            {card.isCurrent ? 'Current' : 'Saved'}
                          </div>
                          <div className={`text-lg font-black tracking-tight truncate ${statDetailTextClass}`}>{card.name}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`pos-subtext text-[10px] font-black tracking-widest ${statDetailTextClass}`}>Total</div>
                          <div className="text-base font-black" style={{ color: accentColor }}>{currency} {card.total}</div>
                        </div>
                      </div>
                      <div className={`pos-subtext text-[10px] font-black tracking-[0.2em] mb-3 ${statDetailTextClass}`}>
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
                    <p className={`pos-subtext text-[11px] font-black tracking-[2px] ${statDetailTextClass}`}>No invoices today</p>
                  </div>
                )}
                </div>
              </div>
            </div>
          ) : inventoryExpanded ? (
            <div className="animate-fade-in space-y-8" role="tabpanel" aria-label="Asset Hub inventory">
              {/* Original inventory expanded view is preserved here */}
              <div className="sticky top-0 z-50 py-4 backdrop-blur-3xl bg-current/5 rounded-3xl -mx-4 px-6 mb-6">
                <div className="flex flex-col gap-5">
                  <div className="flex items-center justify-between">
                    <button 
                      onClick={() => setInventoryExpanded(false)} 
                      aria-label="Back to Vision Hub"
                      className={`flex items-center gap-3 p-3 pr-5 rounded-2xl ${isLight ? 'bg-white shadow-md text-zinc-900' : 'bg-white/10 text-zinc-100'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
                    </button>
                    <div className={`flex items-center gap-4 ${textColorClass}`}>
                      <h3 className="text-2xl font-black tracking-tighter">Asset Hub</h3>
                      <button onClick={() => setShowPlusMenu(!showPlusMenu)} className="p-4 rounded-full shadow-2xl text-white active:scale-90 transition-all" style={{ backgroundColor: accentColor }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                      <select value={sortOption} onChange={(e) => setSortOption(e.target.value as SortOption)} className={`p-3 rounded-xl font-black text-[9px] uppercase tracking-widest border-none outline-none min-w-[120px] ${isLight ? 'bg-white shadow-sm' : 'bg-white/10 text-white'}`}>
                        <option value="a-z">Sort: A-Z</option>
                        <option value="high-stock">Stock: High-Low</option>
                        <option value="low-stock">Stock: Low-High</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 pb-20" role="list" aria-label="Inventory items">
                {filteredInventory.map((item, idx) => (
                  <div key={item.id} onClick={() => setSelectedItem(item)} className={`group rounded-xl overflow-hidden cursor-pointer ${levitateClass} relative`}>
                    <div className="relative aspect-square overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                      <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-x-0 bottom-0 h-[42%] bg-linear-to-t from-black/95 via-black/40 to-transparent pointer-events-none" />
                      <div className="absolute bottom-3 left-3 right-3 flex flex-col pointer-events-none">
                        <h4 className="text-[11px] font-black tracking-tight leading-tight truncate text-white">{item.name}</h4>
                      </div>
                      <div className="absolute top-2 right-2">
                        <div className={`pos-subtext px-2 py-1 rounded-lg text-[9px] font-black tracking-widest ${item.stock < item.threshold ? 'bg-red-500 text-white' : 'bg-black/60 text-white/90'}`}>{item.stock}u</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
                  onClick={() => setShowAddRequestPopup(true)}
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
                      : (isLight ? 'bg-zinc-100 text-zinc-600' : 'bg-white/5 text-white/60')}`}
                  >
                    {tab === 'outofstock' ? 'Out Of Stock' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Requests list */}
              <div className={`rounded-2xl overflow-hidden ${levitateClass}`}>
                {filteredRequests.length > 0 ? (
                  filteredRequests.map((req, idx) => (
                    <div key={req.id} className={`px-8 py-7 flex items-center justify-between gap-4 ${idx !== filteredRequests.length - 1 ? 'border-b border-white/10' : ''}`}>
                      <div className="min-w-0">
                        <div className={`font-black tracking-tight text-lg ${textColorClass}`}>{req.requester}</div>
                        <div className="flex items-center gap-1.5 mt-2">
                          <span className="pos-subtext text-[10px] font-black opacity-50 uppercase tracking-widest">Elapsed</span>
                          <span className={`font-num-medium text-xs tabular-nums tracking-tight ${req.status === 'pending' ? 'text-yellow-500' : req.status === 'delivered' ? 'text-emerald-500' : 'text-red-400'}`}>
                            {formatRequestElapsed(req.timestamp, currentTime)}
                          </span>
                        </div>
                      </div>
                      <div className={`shrink-0 text-xs px-4 py-1 rounded-full font-black tracking-widest uppercase ${req.status === 'pending' ? 'bg-yellow-500/20 text-yellow-500' : req.status === 'delivered' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-red-500/20 text-red-500'}`}>
                        {req.status}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center">
                    <p className="pos-subtext text-[11px] font-black tracking-[2px] opacity-30">No {requestTab} requests</p>
                  </div>
                )}
              </div>
            </div>
          ) : restockExpanded ? (
            /* RESTOCKING EXPANDED VIEW */
            <div className="animate-fade-in space-y-8" role="tabpanel" aria-label="Restocking">
              <button 
                onClick={() => setRestockExpanded(false)} 
                aria-label="Back to Vision Hub"
                className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
              </button>
              <h3 className={`text-4xl font-black tracking-tighter px-2 ${textColorClass}`}>Restocking</h3>
              <p className="text-sm opacity-50 px-1 -mt-4">Items below threshold • Quick replenish</p>

              <div className={`rounded-2xl overflow-hidden ${levitateClass}`}>
                {items.filter(i => i.stock < i.threshold).length > 0 ? (
                  items.filter(i => i.stock < i.threshold).map((item, idx) => (
                    <div key={item.id} className={`px-8 py-6 flex items-center justify-between gap-4 ${idx !== 0 ? 'border-t border-white/10' : ''}`}>
                      <div className="flex items-center gap-4">
                        <img src={item.image} alt="" className="w-12 h-12 rounded-xl object-cover" />
                        <div>
                          <div className={`font-black ${textColorClass}`}>{item.name}</div>
                          <div className="pos-subtext text-xs opacity-40 font-black tracking-widest">{item.stock} / {item.threshold} • {item.category}</div>
                        </div>
                      </div>
                      <button 
                        onClick={() => { setSelectedItem(item); setRestockExpanded(false); setIsRestocking(true); }}
                        className="px-6 py-3 rounded-2xl bg-current/5 font-black text-xs tracking-[1.5px] active:scale-95"
                        style={{ color: accentColor }}
                      >
                        RESTOCK
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center text-xs font-black opacity-30 tracking-[2px]">All items sufficiently stocked</div>
                )}
              </div>
            </div>
          ) : purchasesExpanded ? (
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
                             <p className="pos-subtext text-[8px] font-black text-white/50 tracking-widest truncate">{item.category}</p>
                           </div>
                           <span className="text-[10px] font-black text-white whitespace-nowrap">¢{item.price}</span>
                         </div>
                      </div>
                      <div className="absolute top-2 right-2" aria-hidden="true">
                        <div className={`pos-subtext px-2 py-1 rounded-lg text-[9px] font-black tracking-widest backdrop-blur-3xl shadow-xl ${item.stock < item.threshold ? 'bg-red-500 text-white' : 'bg-black/60 text-white/90'}`}>
                          {item.stock}u
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : inventoryExpanded ? (
            <div className="animate-fade-in space-y-8" role="tabpanel" aria-label="Asset Hub inventory">
              {/* HUB CONTROLS BAR (original inventory view) */}
              <div className="sticky top-0 z-50 py-4 backdrop-blur-3xl bg-current/5 rounded-3xl -mx-4 px-6 mb-6">
                <div className="flex flex-col gap-5">
                  <div className="flex items-center justify-between">
                    <button 
                      onClick={() => setInventoryExpanded(false)} 
                      aria-label="Back to Vision Hub"
                      className={`flex items-center gap-3 p-3 pr-5 rounded-2xl ${isLight ? 'bg-white shadow-md text-zinc-900' : 'bg-white/10 text-zinc-100'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
                    </button>
                    <div className={`flex items-center gap-4 ${textColorClass}`}>
                      <h3 className="text-2xl font-black tracking-tighter">Asset Hub</h3>
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
                            className={`px-3 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${filterOption === opt ? (isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black') : (isLight ? 'bg-white shadow-sm' : 'bg-white/5 text-white/40')}`}
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
                {filteredInventory.map((item, idx) => (
                  <div 
                    key={item.id} 
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
                             <p className="pos-subtext text-[8px] font-black text-white/50 tracking-widest truncate">{item.category}</p>
                           </div>
                           <span className="text-[10px] font-black text-white whitespace-nowrap">¢{item.price}</span>
                         </div>
                      </div>
                      <div className="absolute top-2 right-2" aria-hidden="true">
                        <div className={`pos-subtext px-2 py-1 rounded-lg text-[9px] font-black tracking-widest backdrop-blur-3xl shadow-xl ${item.stock < item.threshold ? 'bg-red-500 text-white' : 'bg-black/60 text-white/90'}`}>
                          {item.stock}u
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
                  onClick={() => setShowAddRequestPopup(true)}
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
                      : (isLight ? 'bg-zinc-100 text-zinc-600' : 'bg-white/5 text-white/60')}`}
                  >
                    {tab === 'outofstock' ? 'Out Of Stock' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Requests list */}
              <div className={`rounded-2xl overflow-hidden ${levitateClass}`}>
                {filteredRequests.length > 0 ? (
                  filteredRequests.map((req, idx) => (
                    <div key={req.id} className={`px-8 py-7 flex items-center justify-between gap-4 ${idx !== filteredRequests.length - 1 ? 'border-b border-white/10' : ''}`}>
                      <div className="min-w-0">
                        <div className={`font-black tracking-tight text-lg ${textColorClass}`}>{req.requester}</div>
                        <div className="flex items-center gap-1.5 mt-2">
                          <span className="pos-subtext text-[10px] font-black opacity-50 uppercase tracking-widest">Elapsed</span>
                          <span className={`font-num-medium text-xs tabular-nums tracking-tight ${req.status === 'pending' ? 'text-yellow-500' : req.status === 'delivered' ? 'text-emerald-500' : 'text-red-400'}`}>
                            {formatRequestElapsed(req.timestamp, currentTime)}
                          </span>
                        </div>
                      </div>
                      <div className={`shrink-0 text-xs px-4 py-1 rounded-full font-black tracking-widest uppercase ${req.status === 'pending' ? 'bg-yellow-500/20 text-yellow-500' : req.status === 'delivered' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-red-500/20 text-red-500'}`}>
                        {req.status}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center">
                    <p className="pos-subtext text-[11px] font-black tracking-[2px] opacity-30">No {requestTab} requests</p>
                  </div>
                )}
              </div>
            </div>
          ) : restockExpanded ? (
            /* RESTOCKING SCREEN */
            <div className="animate-fade-in space-y-8" role="tabpanel" aria-label="Restocking">
              <button 
                onClick={() => setRestockExpanded(false)} 
                aria-label="Back to Vision Hub"
                className={`flex items-center gap-3 p-4 pr-6 rounded-2xl ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-100'} font-black text-[10px] tracking-widest uppercase active:scale-95 transition-all duration-150`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Hub
              </button>
              <h3 className={`text-4xl font-black tracking-tighter px-2 ${textColorClass}`}>Restocking</h3>
              <p className="text-sm opacity-50 px-1 -mt-4">Items below threshold • Quick replenish</p>

              <div className={`rounded-2xl overflow-hidden ${levitateClass}`}>
                {items.filter(i => i.stock < i.threshold).length > 0 ? (
                  items.filter(i => i.stock < i.threshold).map((item, idx) => (
                    <div key={item.id} className={`px-8 py-6 flex items-center justify-between gap-4 ${idx !== 0 ? 'border-t border-white/10' : ''}`}>
                      <div className="flex items-center gap-4">
                        <img src={item.image} alt="" className="w-12 h-12 rounded-xl object-cover" />
                        <div>
                          <div className={`font-black ${textColorClass}`}>{item.name}</div>
                          <div className="pos-subtext text-xs opacity-40 font-black tracking-widest">{item.stock} / {item.threshold} • {item.category}</div>
                        </div>
                      </div>
                      <button 
                        onClick={() => { 
                          setSelectedItem(item); 
                          setRestockExpanded(false); 
                          setIsRestocking(true); 
                        }}
                        className="px-6 py-3 rounded-2xl bg-current/5 font-black text-xs tracking-[1.5px] active:scale-95"
                        style={{ color: accentColor }}
                      >
                        RESTOCK
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center text-xs font-black opacity-30 tracking-[2px]">All items sufficiently stocked</div>
                )}
              </div>
            </div>
          ) : (
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
                {purchases.map((p, idx) => (
                  <div 
                    key={p.id} 
                    role="listitem"
                    tabIndex={0}
                    aria-label={`Transaction ${idx + 1}: ${p.itemName}, total ${formatCurrency(p.total.toString())} on ${p.date}`}
                    className={`p-10 flex flex-col gap-2 ${idx !== purchases.length - 1 ? 'border-b border-zinc-100 dark:border-white/5' : ''}`}
                  >
                    <div className="flex justify-between items-start">
                      <span className={`text-xl font-black tracking-tight ${textColorClass}`}>{p.itemName}</span>
                      <span className="text-xl font-black" style={{ color: accentColor }}>{formatCurrency(p.total.toString())}</span>
                    </div>
                    <div className="flex justify-between items-center pos-subtext text-[10px] font-black tracking-[0.2em] opacity-40">
                      <span>{p.date}</span>
                      <span>Qty: {p.quantity}</span>
                    </div>
                  </div>
                ))}
                {purchases.length === 0 && (
                  <div className="p-10 text-center">
                    <p className={`pos-subtext text-[11px] font-black tracking-[0.4em] opacity-30 ${textColorClass}`}>No transactions yet</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* PLUS / QUICK ACTIONS MENU */}
      {showPlusMenu && (
        <div className="fixed inset-0 z-300 flex items-end justify-center p-6" role="presentation" aria-hidden={!showPlusMenu}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-2xl cursor-pointer" onClick={() => setShowPlusMenu(false)} aria-hidden="true" />
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
              <button 
                onClick={() => { setShowPlusMenu(false); setPurchasesExpanded(true); }} 
                aria-label="View full transaction archive"
                className={`w-full flex items-center justify-between p-6 rounded-[18.2px] transition-all duration-150 active:scale-95 ${isLight ? 'bg-zinc-50' : 'bg-white/5'}`}
              >
                <span className={`font-black ${textColorClass}`}>View Transaction Archive</span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REQUESTS ADD MORE POPUP — matches invoice switcher motion + notepad shell */}
      {showAddRequestPopup && (
        <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center p-4 pb-6 sm:pb-4 pointer-events-auto" role="presentation">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-3xl opacity-100 transition-opacity duration-280"
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
                className="px-4 pt-4 pb-3 flex items-center gap-3 border-b shrink-0"
                style={{
                  borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
                }}
              >
                <input
                  id="request-notepad-title"
                  type="text"
                  value={newRequesterName}
                  onChange={(e) => setNewRequesterName(e.target.value)}
                  placeholder="Requester name"
                  className={`flex-1 min-w-0 bg-transparent outline-none text-lg font-black tracking-tight placeholder:opacity-30 ${
                    isLight ? 'text-black' : 'text-white'
                  }`}
                  autoFocus
                />
                <div className="flex items-center gap-2 shrink-0">
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
                    onClick={addNewRequest}
                    disabled={!newRequesterName.trim()}
                    className={`w-10 h-10 rounded-full flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.22)] active:scale-90 transition-all disabled:opacity-40 ${
                      isLight ? 'bg-emerald-500 text-white' : 'bg-emerald-500 text-white shadow-[0_0_14px_rgb(16,185,129)]'
                    }`}
                    aria-label="Save new request"
                  >
                    <Icons.Check size={18} />
                  </button>
                </div>
              </div>

              <div
                className="flex-1 min-h-0 px-5 py-4"
                style={{
                  backgroundImage: isLight
                    ? 'repeating-linear-gradient(transparent, transparent 27px, rgba(0,0,0,0.035) 27px, rgba(0,0,0,0.035) 28px)'
                    : 'repeating-linear-gradient(transparent, transparent 27px, rgba(255,255,255,0.04) 27px, rgba(255,255,255,0.04) 28px)',
                }}
              >
                <textarea
                  value={requestNotes}
                  onChange={(e) => setRequestNotes(e.target.value)}
                  placeholder="Products / notes..."
                  className={`w-full h-full resize-none bg-transparent outline-none text-base leading-7 font-medium placeholder:opacity-30 ${
                    isLight ? 'text-zinc-800' : 'text-zinc-200'
                  }`}
                  style={{ lineHeight: '28px' }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RESTOCK + ADD ITEM MODAL (shared overlay) */}
      {(isRestocking || isAddingItem) && (
        <div className="fixed inset-0 z-350 flex items-center justify-center p-6" role="presentation" aria-hidden={!(isRestocking || isAddingItem)}>
          <div className="absolute inset-0 bg-black/80 backdrop-blur-3xl cursor-pointer" onClick={() => { setIsRestocking(false); setIsAddingItem(false); }} aria-hidden="true" />
          <div 
            className={`relative w-full max-w-sm rounded-2xl p-12 transition-all duration-500 cubic-bezier(0.16, 1, 0.3, 1) ${levitateClass} shadow-[0_128px_256px_rgba(0,0,0,1)]`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={isRestocking ? "restock-title" : "add-item-title"}
          >
             {isRestocking && selectedItem && (
               <div className={`space-y-10 ${textColorClass}`}>
                 <h3 id="restock-title" className="text-5xl font-black tracking-tighter">Replenish</h3>
                 <div className="p-8 rounded-[28.6px] bg-current/5 flex items-center gap-6 shadow-inner">
                   <img src={selectedItem.image} alt={selectedItem.name} className="w-24 h-24 rounded-[20.8px] object-cover" />
                   <div className="flex flex-col"><span className="text-xl font-black truncate">{selectedItem.name}</span><span className="pos-subtext text-[12px] font-black opacity-40 tracking-widest">{selectedItem.stock} U Current Flow</span></div>
                 </div>
                 <div className="space-y-4">
                   <label className="pos-subtext text-[11px] font-black tracking-[0.5em] opacity-30 ml-3" htmlFor="restock-qty">Injection Count</label>
                   <input 
                     id="restock-qty" 
                     type="number" 
                     value={restockQty} 
                     onChange={(e) => setRestockQty(e.target.value)} 
                     aria-label="Restock quantity" 
                     className={`w-full p-8 rounded-[26px] outline-none font-black text-3xl shadow-inner ${isLight ? 'bg-zinc-50 text-zinc-900' : 'bg-black/40 text-white'}`} 
                   />
                 </div>
                 <div className="space-y-4">
                   <label className="pos-subtext text-[11px] font-black tracking-[0.5em] opacity-30 ml-3" htmlFor="restock-supplier">Supplier (optional)</label>
                   <input 
                     id="restock-supplier" 
                     type="text" 
                     value={restockSupplier} 
                     onChange={(e) => setRestockSupplier(e.target.value)} 
                     aria-label="Restock supplier" 
                     placeholder="Supplier name"
                     className={`w-full p-4 rounded-[18.2px] outline-none font-black text-sm ${isLight ? 'bg-zinc-50 text-zinc-900' : 'bg-black/40 text-white'}`} 
                   />
                 </div>
                 <button onClick={submitRestock} aria-label="Confirm restock" className="w-full py-8 rounded-[26px] text-black font-black uppercase tracking-[0.5em] text-[12px] active:scale-95 shadow-2xl transition-all" style={{ backgroundColor: accentColor }}>Confirm</button>
               </div>
             )}
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

      {/* ITEM DETAIL MODAL */}
      {selectedItem && !isRestocking && !isAddingItem && (
        <div className="fixed inset-0 z-400 flex items-center justify-center p-6 animate-insight-pop" role="presentation" aria-hidden={!selectedItem}>
          <div className="absolute inset-0 bg-black/80 backdrop-blur-3xl cursor-pointer" onClick={() => setSelectedItem(null)} aria-hidden="true" />
          <div 
            className={`relative w-full max-w-sm rounded-2xl overflow-hidden transition-all duration-500 cubic-bezier(0.16, 1, 0.3, 1) ${levitateClass} shadow-[0_128px_256px_rgba(0,0,0,1)]`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="item-detail-title"
          >
            <div className="h-56 relative group">
              <img src={selectedItem.image} alt={selectedItem.name} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent" aria-hidden="true" />
              <button onClick={() => setSelectedItem(null)} aria-label="Close item detail" className="absolute top-6 right-6 p-4 rounded-full bg-black/30 backdrop-blur-3xl text-white shadow-xl active:scale-90 transition-all"><Icons.X size={20} /></button>
            </div>
            <div className={`p-10 space-y-8 ${textColorClass}`}>
              <div className="flex justify-between items-start">
                <h3 id="item-detail-title" className="text-4xl font-black tracking-tighter leading-tight">{selectedItem.name}</h3>
                <span className={`px-5 py-2 rounded-2xl pos-subtext text-[10px] font-black tracking-widest ${isLight ? 'bg-zinc-100' : 'bg-white/10'}`}>{selectedItem.category}</span>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div><p className="pos-subtext text-[10px] font-black opacity-30 tracking-[0.3em] mb-2">Inventory</p><p className={`text-3xl font-black ${selectedItem.stock < selectedItem.threshold ? 'text-red-500' : ''}`}>{selectedItem.stock} U</p></div>
                <div><p className="pos-subtext text-[10px] font-black opacity-30 tracking-[0.3em] mb-2">Credit Rate</p><p className="text-3xl font-black">¢{selectedItem.price}</p></div>
              </div>
              <button onClick={() => setIsRestocking(true)} aria-label="Replenish this asset" className="w-full py-7 rounded-[20.8px] text-black font-black uppercase tracking-[0.4em] text-[11px] active:scale-95 shadow-2xl flex items-center justify-center gap-4 transition-all" style={{ backgroundColor: accentColor }}><Icons.Scientific size={18} /> Replenish Asset</button>
            </div>
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
        onInvoicePrinted={onInvoicePrinted}
      />
      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes insight-pop { from { opacity: 0; transform: scale(0.9) translateY(60px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        .animate-fade-in { animation: fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-insight-pop { animation: insight-pop 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
};

export default POSDashboard;