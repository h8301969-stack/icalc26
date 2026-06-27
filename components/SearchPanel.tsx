import React, { useMemo, useRef, useEffect } from 'react';
import { InvoiceActionLog } from '../types';
import { InventoryItem } from '../hooks/usePOS';

type InvoiceSearchResult = {
  id: string;
  name: string;
  total: string;
  itemCount: number;
  isCurrent: boolean;
};

type InventorySearchResult = {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
};

type SearchPanelProps = {
  isOpen: boolean;
  query: string;
  onClose: () => void;
  isLight: boolean;
  currency: string;
  invoiceName: string;
  runningTotal: string;
  actionLogs: InvoiceActionLog[];
  inventory: InventoryItem[];
  onSelectInvoice: (name: string) => void;
  onSelectInventory: (item: InventoryItem) => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
};

const buildInvoiceSearchIndex = (
  actionLogs: InvoiceActionLog[],
  currentName: string,
  runningTotal: string
): InvoiceSearchResult[] => {
  const grouped = new Map<string, InvoiceActionLog[]>();
  for (const log of actionLogs) {
    if (!grouped.has(log.invoiceName)) grouped.set(log.invoiceName, []);
    grouped.get(log.invoiceName)!.push(log);
  }

  const results: InvoiceSearchResult[] = [];
  for (const [name, logs] of grouped) {
    const computed = logs.reduce((sum, l) => sum + l.price * l.quantity, 0);
    const total = name === currentName ? runningTotal : computed.toFixed(2);
    results.push({
      id: `inv-${name}`,
      name,
      total,
      itemCount: logs.length,
      isCurrent: name === currentName,
    });
  }

  if (!grouped.has(currentName)) {
    results.unshift({
      id: `inv-${currentName}`,
      name: currentName,
      total: runningTotal,
      itemCount: 0,
      isCurrent: true,
    });
  }

  return results.sort((a, b) => (a.isCurrent ? -1 : b.isCurrent ? 1 : a.name.localeCompare(b.name)));
};

const normalize = (value: string) => value.toLowerCase().trim();

const searchInvoices = (invoices: InvoiceSearchResult[], query: string): InvoiceSearchResult[] => {
  const q = normalize(query);
  if (!q) return [];
  return invoices.filter((inv) => {
    const totalNum = parseFloat(inv.total);
    const totalStr = inv.total.replace(/,/g, '');
    return (
      inv.name.toLowerCase().includes(q) ||
      totalStr.includes(q) ||
      (!Number.isNaN(totalNum) && totalNum.toString().includes(q))
    );
  });
};

const searchInventory = (items: InventoryItem[], query: string): InventorySearchResult[] => {
  const q = normalize(query);
  if (!q) return [];
  return items
    .filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.supplier.toLowerCase().includes(q) ||
        item.price.toString().includes(q) ||
        item.stock.toString().includes(q)
    )
    .map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      stock: item.stock,
      category: item.category,
    }));
};

const SearchPanel: React.FC<SearchPanelProps> = ({
  isOpen,
  query,
  onClose,
  isLight,
  currency,
  invoiceName,
  runningTotal,
  actionLogs,
  inventory,
  onSelectInvoice,
  onSelectInventory,
  anchorRef,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  const invoiceIndex = useMemo(
    () => buildInvoiceSearchIndex(actionLogs, invoiceName, runningTotal),
    [actionLogs, invoiceName, runningTotal]
  );

  const invoiceHits = useMemo(() => searchInvoices(invoiceIndex, query), [invoiceIndex, query]);
  const inventoryHits = useMemo(() => searchInventory(inventory, query), [inventory, query]);

  const hasQuery = query.trim().length > 0;
  const hasResults = invoiceHits.length > 0 || inventoryHits.length > 0;

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen) return null;

  const panelBg = isLight ? 'bg-white/95 text-black' : 'bg-[#1c1c1e]/95 text-white';
  const rowHover = isLight ? 'hover:bg-black/5' : 'hover:bg-white/8';
  const muted = isLight ? 'text-zinc-500' : 'text-zinc-400';

  return (
    <div
      ref={panelRef}
      className={`absolute left-0 right-0 top-[calc(100%+0.5rem)] z-[70] rounded-2xl border shadow-2xl overflow-hidden ${panelBg} ${
        isLight ? 'border-black/8' : 'border-white/10'
      }`}
      id="search-results-panel"
      role="listbox"
      aria-label="Search results"
    >
      <div className="max-h-[min(50vh,320px)] overflow-y-auto custom-scrollbar p-2">
        {!hasQuery && (
          <p className={`px-3 py-4 text-center text-xs font-semibold ${muted}`}>
            Search invoices by name or total, or find inventory items
          </p>
        )}

        {hasQuery && !hasResults && (
          <p className={`px-3 py-4 text-center text-xs font-semibold ${muted}`}>
            No results for &ldquo;{query}&rdquo;
          </p>
        )}

        {invoiceHits.length > 0 && (
          <section className="mb-2">
            <p className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${muted}`}>
              Invoices
            </p>
            {invoiceHits.map((inv) => (
              <button
                key={inv.id}
                type="button"
                role="option"
                onClick={() => onSelectInvoice(inv.name)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${rowHover}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{inv.name}</p>
                  <p className={`text-[10px] font-semibold ${muted}`}>
                    {inv.isCurrent ? 'Current' : 'Saved'} · {inv.itemCount} items
                  </p>
                </div>
                <span className="text-sm font-black shrink-0">
                  {currency} {inv.total}
                </span>
              </button>
            ))}
          </section>
        )}

        {inventoryHits.length > 0 && (
          <section>
            <p className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${muted}`}>
              Inventory
            </p>
            {inventoryHits.map((hit) => {
              const item = inventory.find((i) => i.id === hit.id)!;
              return (
                <button
                  key={hit.id}
                  type="button"
                  role="option"
                  onClick={() => onSelectInventory(item)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${rowHover}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{hit.name}</p>
                    <p className={`text-[10px] font-semibold ${muted}`}>
                      {hit.category} · {hit.stock} in stock
                    </p>
                  </div>
                  <span className="text-sm font-black shrink-0">
                    {currency} {hit.price.toFixed(2)}
                  </span>
                </button>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
};

export default SearchPanel;