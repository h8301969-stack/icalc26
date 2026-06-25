import React, { useMemo, useState, useEffect, useRef } from 'react';
import { HistoryItem, InvoiceActionLog } from '../types';
import { Icons } from '../constants';
import { InventoryItem, ActivityLogEntry, PurchaseRecord } from '../hooks/usePOS';
import SettingsPanel from './SettingsPanel';

interface POSDashboardProps {
  history: HistoryItem[];
  items: InventoryItem[];
  setItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  purchases: PurchaseRecord[];
  setPurchases: React.Dispatch<React.SetStateAction<PurchaseRecord[]>>;
  invoiceActionLogs: InvoiceActionLog[];
  isOpen: boolean;
  onClose: () => void;
  isLight: boolean;
  accentColor: string;
  formatCurrency: (val: string) => string;
  updateSettings: (key: string, value: any) => void;
}

const POSDashboard: React.FC<POSDashboardProps> = ({
  history,
  items,
  setItems,
  purchases,
  invoiceActionLogs,
  isOpen,
  onClose,
  isLight,
  accentColor,
  formatCurrency,
  updateSettings,
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [inventoryExpanded, setInventoryExpanded] = useState(false);
  const [purchasesExpanded, setPurchasesExpanded] = useState(false);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [isRestocking, setIsRestocking] = useState(false);
  const [isEditingImage, setIsEditingImage] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isThemeAnimating, setIsThemeAnimating] = useState(false);
  const [isSettingsAnimating, setIsSettingsAnimating] = useState(false);
  const [isCloseAnimating, setIsCloseAnimating] = useState(false);
  
  const [sortOption, setSortOption] = useState<'a-z' | 'high-stock' | 'low-stock'>('a-z');
  const [filterOption, setFilterOption] = useState<'all' | '24h' | '48h' | '3d' | '7d' | '14d' | 'custom'>('all');
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

  // Keyboard accessibility: close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const stats = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(new Date().setHours(0,0,0,0)).getTime();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const totalRev = purchases.reduce((acc, p) => acc + p.total, 0);
    const dailyRev = purchases.filter(p => p.timestamp >= todayStart).reduce((acc, p) => acc + p.total, 0);
    const monthlyRev = purchases.filter(p => p.timestamp >= monthStart).reduce((acc, p) => acc + p.total, 0);
    const invoicesToday = purchases.filter(p => p.timestamp >= todayStart).length;
    const avgPerCustomer = purchases.length > 0 ? totalRev / purchases.length : 0;
    const stockLevel = items.length > 0 ? Math.round(items.reduce((acc, item) => acc + (item.stock / item.threshold) * 100, 0) / items.length) : 0;
    const criticalItems = items.filter(i => i.stock < i.threshold).length;

    return { totalRev, monthlyRev, dailyRev, avgPerCustomer, invoicesToday, stockLevel, criticalItems };
  }, [purchases, items]);

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
    const inventoryLogs = items
      .flatMap(item => item.activities.map(log => ({ ...log, itemName: item.name })))
      .filter(log => log.timestamp >= dayAgo);

    const liveInvoiceLogs = invoiceActionLogs.map((log) => ({
      id: log.id,
      type: 'cart-add' as ActivityLogEntry['type'],
      action: log.message,
      itemName: log.itemName ?? `${log.price} ghs`,
      time: 'Live',
      timestamp: log.timestamp,
    }));

    return [...liveInvoiceLogs, ...inventoryLogs]
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [items, invoiceActionLogs]);

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
      image: newItemImageUrl || 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=400&q=80',
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
    : 'bg-[#151518] shadow-[0_0_20px_rgba(255,255,255,0.18)] hover:shadow-[0_0_35px_rgba(255,255,255,0.35)] transition-all duration-500 cubic-bezier(0.16, 1, 0.3, 1)';

  const textColorClass = isLight ? 'text-zinc-900' : 'text-zinc-100';

  return (
    <div className={`fixed inset-0 z-200 flex flex-col ${isOpen ? 'opacity-100 pointer-events-auto animate-insight-pop' : 'opacity-0 pointer-events-none transition-opacity duration-300'}`}>
      <div className={`relative w-full h-full flex flex-col transition-all duration-200 backdrop-blur-[44px] ${isLight ? 'bg-white/95' : 'bg-[#050505]/95'} ${isAddingItem || isRestocking || isEditingImage ? 'blur-2xl scale-[0.98]' : ''}`}>
        
        {/* DASHBOARD HEADER PORTION WITH THEME-INVERTED FIXED BAR */}
        {!inventoryExpanded && !purchasesExpanded && (
          <div className="relative pt-8 px-6 pb-6 overflow-hidden shrink-0 z-60">
             <div className="w-12 h-1 bg-zinc-500/20 rounded-full mx-auto mb-6 cursor-pointer" onClick={onClose} />
             
             {/* THE THEME-INVERTED HEADER BAR */}
             <div className={`
               w-full rounded-xl p-8 shadow-[0_32px_80px_rgba(0,0,0,0.25)] transition-all duration-500
               ${isLight ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-900'}
             `}>
               <div className="flex justify-between items-start">
                 <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase tracking-[0.4em] mb-1 opacity-40">Neural Terminal</span>
                    <h2 className="text-4xl font-black tracking-tighter">Vision Hub</h2>
                    
                    <div className="mt-4 flex items-center gap-3">
                      <div className="text-xl font-black tracking-tight leading-none">{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      <div className={`w-px h-4 ${isLight ? 'bg-white/20' : 'bg-zinc-900/20'}`} />
                      <div className="text-[9px] font-bold opacity-30 uppercase tracking-[0.2em]">Live Session</div>
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
          {!inventoryExpanded && !purchasesExpanded ? (
            <div className="grid grid-cols-2 gap-6 pt-4">
              
              {/* PERFORMANCE MICRO CARDS */}
              <div className="col-span-2 grid grid-cols-2 gap-5">
                {[
                  { label: 'Monthly Rev', val: formatCurrency(stats.monthlyRev.toFixed(2)) },
                  { label: 'Daily Sales', val: formatCurrency(stats.dailyRev.toFixed(2)) },
                  { label: 'Avg Customer', val: formatCurrency(stats.avgPerCustomer.toFixed(2)) },
                  { label: 'Invoices Today', val: stats.invoicesToday }
                ].map((card, idx) => (
                  <div key={idx} className={`p-7 rounded-xl ${levitateClass}`}>
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] opacity-30 mb-2">{card.label}</p>
                    <p className="text-2xl font-black tracking-tight" style={{ color: accentColor }}>{card.val}</p>
                  </div>
                ))}
              </div>

              {/* INVENTORY MASTER CARD - TEXTS FITTED MARGINALLY */}
              <div onClick={() => setInventoryExpanded(true)} className={`col-span-2 aspect-16/10 rounded-2xl ${levitateClass} relative overflow-hidden group cursor-pointer active:scale-[0.98]`}>
                <img src="https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&q=80" alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110 opacity-70 dark:opacity-50" />
                <div className="absolute inset-x-0 bottom-0 h-[65%] bg-linear-to-t from-black/95 via-black/30 to-transparent pointer-events-none" />
                <div className="absolute inset-0 p-8 flex flex-col justify-between">
                  <div className="flex items-center gap-5 translate-y-2">
                    <div className="p-4 rounded-[13px] bg-orange-500/20 text-orange-500 backdrop-blur-3xl shadow-2xl border border-white/10"><Icons.Scientific size={28} /></div>
                    <span className="text-[11px] font-black uppercase tracking-[0.4em] opacity-90 text-white drop-shadow-md">Live Matrix</span>
                  </div>
                  <div className="space-y-1 relative z-10 translate-y-2">
                    <div className="flex items-end justify-between">
                      <div className="text-7xl font-black tracking-tighter text-white drop-shadow-[0_8px_24px_rgba(0,0,0,0.7)]">{stats.stockLevel}%</div>
                      <div className="text-right pb-3">
                        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/50 mb-1.5">Network Load</p>
                        <div className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest backdrop-blur-3xl shadow-2xl ${stats.criticalItems > 0 ? 'bg-red-500/80 text-white' : 'bg-green-500/80 text-white'}`}>
                          {stats.criticalItems} Alerts
                        </div>
                      </div>
                    </div>
                    <div className="pt-2">
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.15em] leading-relaxed max-w-[280px]">Inventory flow optimized within margins. Real-time neural processing active.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* ACTION LOGS */}
              <div className={`col-span-2 p-10 rounded-2xl ${levitateClass}`}>
                <div className="flex justify-between items-center mb-8">
                   <div className="space-y-1">
                      <h3 className={`text-2xl font-black tracking-tighter ${textColorClass}`}>Action Logs</h3>
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30">Neural Ledger • 24h</p>
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
                            <span className={`text-[9px] font-bold uppercase tracking-[0.2em] opacity-30 truncate ${textColorClass}`}>{log.itemName}</span>
                          </div>
                        </div>
                        <span className={`text-[9px] font-black uppercase opacity-20 whitespace-nowrap ${textColorClass}`}>{log.time}</span>
                      </div>
                    ))
                  ) : (
                    <div className="py-16 text-center space-y-3">
                       <p className={`text-[11px] font-black uppercase tracking-[0.4em] opacity-10 ${textColorClass}`}>No Log Data</p>
                    </div>
                  )}
                </div>
              </div>

            </div>
          ) : inventoryExpanded ? (
            <div className="animate-fade-in space-y-8" role="tabpanel" aria-label="Asset Hub inventory">
              {/* HUB CONTROLS BAR */}
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

                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                      <select 
                        value={sortOption} 
                        onChange={(e) => setSortOption(e.target.value as any)} 
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
                            onClick={() => setFilterOption(opt as any)} 
                            aria-pressed={filterOption === opt}
                            className={`px-3 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${filterOption === opt ? (isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black') : (isLight ? 'bg-white shadow-sm' : 'bg-white/5 text-white/40')}`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>

                    {filterOption === 'custom' && (
                      <div className={`p-4 rounded-2xl flex items-center gap-3 animate-fade-in ${isLight ? 'bg-white shadow-sm' : 'bg-white/10'}`}>
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-[8px] font-black uppercase opacity-40 ml-1" htmlFor="custom-start">Start</label>
                          <input id="custom-start" type="date" value={customDateStart} onChange={(e) => setCustomDateStart(e.target.value)} aria-label="Custom filter start date" className={`w-full p-2 rounded-lg font-black text-[10px] outline-none ${isLight ? 'bg-zinc-100' : 'bg-black/40 text-white'}`} />
                        </div>
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-[8px] font-black uppercase opacity-40 ml-1" htmlFor="custom-end">End</label>
                          <input id="custom-end" type="date" value={customDateEnd} onChange={(e) => setCustomDateEnd(e.target.value)} aria-label="Custom filter end date" className={`w-full p-2 rounded-lg font-black text-[10px] outline-none ${isLight ? 'bg-zinc-100' : 'bg-black/40 text-white'}`} />
                        </div>
                      </div>
                    )}

                    <div className="relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
                      <input 
                        type="text" 
                        placeholder="Search assets..." 
                        value={searchQuery} 
                        onChange={(e) => setSearchQuery(e.target.value)} 
                        aria-label="Search inventory assets"
                        className={`w-full pl-10 pr-4 py-3 rounded-xl font-black text-[10px] uppercase outline-none transition-all ${isLight ? 'bg-white shadow-sm' : 'bg-white/10 text-white'}`} 
                      />
                    </div>
                  </div>
                </div>
              </div>

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
                             <p className="text-[8px] font-black uppercase text-white/50 tracking-widest truncate">{item.category}</p>
                           </div>
                           <span className="text-[10px] font-black text-white whitespace-nowrap">¢{item.price}</span>
                         </div>
                      </div>
                      <div className="absolute top-2 right-2" aria-hidden="true">
                        <div className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest backdrop-blur-3xl shadow-xl ${item.stock < item.threshold ? 'bg-red-500 text-white' : 'bg-black/60 text-white/90'}`}>
                          {item.stock}u
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
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
                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-[0.2em] opacity-40">
                      <span>{p.date}</span>
                      <span>Qty: {p.quantity}</span>
                    </div>
                  </div>
                ))}
                {purchases.length === 0 && (
                  <div className="p-10 text-center">
                    <p className={`text-[11px] font-black uppercase tracking-[0.4em] opacity-30 ${textColorClass}`}>No transactions yet</p>
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
                   <div className="flex flex-col"><span className="text-xl font-black truncate">{selectedItem.name}</span><span className="text-[12px] font-black opacity-40 uppercase tracking-widest">{selectedItem.stock} U Current Flow</span></div>
                 </div>
                 <div className="space-y-4">
                   <label className="text-[11px] font-black uppercase tracking-[0.5em] opacity-30 ml-3" htmlFor="restock-qty">Injection Count</label>
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
                   <label className="text-[11px] font-black uppercase tracking-[0.5em] opacity-30 ml-3" htmlFor="restock-supplier">Supplier (optional)</label>
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
      {selectedItem && !isRestocking && !isAddingItem && !isEditingImage && (
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
                <span className={`px-5 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${isLight ? 'bg-zinc-100' : 'bg-white/10'}`}>{selectedItem.category}</span>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div><p className="text-[10px] font-black opacity-30 uppercase tracking-[0.3em] mb-2">Inventory</p><p className={`text-3xl font-black ${selectedItem.stock < selectedItem.threshold ? 'text-red-500' : ''}`}>{selectedItem.stock} U</p></div>
                <div><p className="text-[10px] font-black opacity-30 uppercase tracking-[0.3em] mb-2">Credit Rate</p><p className="text-3xl font-black">¢{selectedItem.price}</p></div>
              </div>
              <button onClick={() => setIsRestocking(true)} aria-label="Replenish this asset" className="w-full py-7 rounded-[20.8px] text-black font-black uppercase tracking-[0.4em] text-[11px] active:scale-95 shadow-2xl flex items-center justify-center gap-4 transition-all" style={{ backgroundColor: accentColor }}><Icons.Scientific size={18} /> Replenish Asset</button>
            </div>
          </div>
        </div>
      )}
      <SettingsPanel 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        settings={{ themeMode: isLight ? 'light' : 'dark' }} 
        updateSettings={updateSettings} 
        cartItems={latestPurchaseItems}
        runningTotal={latestPurchaseTotal}
        invoiceName={latestPurchaseName}
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