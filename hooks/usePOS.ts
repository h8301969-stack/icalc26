import { useState, useEffect, useCallback, type SetStateAction } from 'react';
import { HistoryItem } from '../types';
import { storage } from './storage';

export interface ActivityLogEntry {
  id: string;
  type: 'restock' | 'sale' | 'cart-add' | 'cart-remove' | 'image-update' | 'price-update' | 'stock-update';
  action: string;
  time: string;
  timestamp: number;
  profileName?: string;
}

export interface PurchaseRecord {
  id: string;
  itemName: string;
  quantity: number;
  price: number;
  total: number;
  date: string;
  timestamp: number;
}

/** Named inventory partition (toggleable in Asset Hub). */
export interface WholesaleList {
  id: string;
  name: string;
}

/** Soft-deleted wholesale list (items kept under wholesaleId for restore). */
export interface ArchivedWholesale extends WholesaleList {
  archivedAt: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  stock: number;
  price: number;
  threshold: number;
  category: string;
  dateAdded: string;
  supplier: string;
  lastStocked: string;
  image: string;
  /** Weight / measure (e.g. grams). */
  grams: number;
  activities: ActivityLogEntry[];
  /** Which wholesale list this item belongs to. */
  wholesaleId: string;
}

export const DEFAULT_WHOLESALE_LISTS: WholesaleList[] = [
  { id: 'wholesale-1', name: 'Wholesale 1' },
  { id: 'wholesale-2', name: 'Wholesale 2' },
  { id: 'wholesale-3', name: 'Wholesale 3' },
];

const WHOLESALES_KEY = 'pos_wholesales';
const ACTIVE_WHOLESALE_KEY = 'pos_active_wholesale';
const WHOLESALE_ARCHIVE_KEY = 'pos_wholesale_archive';
const MAX_WHOLESALES = 16;

export const createWholesaleId = (): string =>
  `wholesale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const ensureWholesaleLists = (lists: WholesaleList[] | null | undefined): WholesaleList[] => {
  if (!lists?.length) return DEFAULT_WHOLESALE_LISTS.map((w) => ({ ...w }));
  return lists.map((w, i) => ({
    id: w.id || `wholesale-${i + 1}`,
    name: (w.name || `Wholesale ${i + 1}`).trim() || `Wholesale ${i + 1}`,
  }));
};

export const defaultWholesaleId = (lists: WholesaleList[]): string =>
  lists[0]?.id ?? DEFAULT_WHOLESALE_LISTS[0].id;

export const normalizeInventoryItem = (
  item: InventoryItem,
  fallbackWholesaleId: string
): InventoryItem => ({
  ...item,
  grams: typeof item.grams === 'number' && Number.isFinite(item.grams) ? item.grams : 0,
  wholesaleId: item.wholesaleId || fallbackWholesaleId,
});

export const normalizeInventoryItems = (
  items: InventoryItem[],
  fallbackWholesaleId: string
): InventoryItem[] => items.map((item) => normalizeInventoryItem(item, fallbackWholesaleId));

export const usePOS = (_history: HistoryItem[]) => {
  const [wholesales, setWholesalesState] = useState<WholesaleList[]>(() =>
    ensureWholesaleLists(storage.get<WholesaleList[]>(WHOLESALES_KEY, DEFAULT_WHOLESALE_LISTS))
  );
  const [activeWholesaleId, setActiveWholesaleIdState] = useState<string>(() => {
    const lists = ensureWholesaleLists(storage.get<WholesaleList[]>(WHOLESALES_KEY, DEFAULT_WHOLESALE_LISTS));
    const saved = storage.get<string>(ACTIVE_WHOLESALE_KEY, lists[0].id);
    return lists.some((w) => w.id === saved) ? saved : lists[0].id;
  });
  const [items, setItems] = useState<InventoryItem[]>(() => {
    const lists = ensureWholesaleLists(storage.get<WholesaleList[]>(WHOLESALES_KEY, DEFAULT_WHOLESALE_LISTS));
    const fallback = defaultWholesaleId(lists);
    return normalizeInventoryItems(storage.get<InventoryItem[]>('pos_inventory', []), fallback);
  });
  const [purchases, setPurchases] = useState<PurchaseRecord[]>(() => storage.get('pos_purchases', []));
  const [archivedWholesales, setArchivedWholesales] = useState<ArchivedWholesale[]>(() =>
    storage.get<ArchivedWholesale[]>(WHOLESALE_ARCHIVE_KEY, [])
  );

  useEffect(() => {
    storage.set(WHOLESALES_KEY, wholesales);
  }, [wholesales]);

  useEffect(() => {
    storage.set(ACTIVE_WHOLESALE_KEY, activeWholesaleId);
  }, [activeWholesaleId]);

  useEffect(() => {
    storage.set(WHOLESALE_ARCHIVE_KEY, archivedWholesales);
  }, [archivedWholesales]);

  useEffect(() => {
    storage.set('pos_inventory', items);
  }, [items]);

  useEffect(() => {
    storage.set('pos_purchases', purchases);
  }, [purchases]);

  const setWholesales = useCallback((next: SetStateAction<WholesaleList[]>) => {
    setWholesalesState((prev) => {
      const resolved = ensureWholesaleLists(typeof next === 'function' ? next(prev) : next);
      return resolved.slice(0, MAX_WHOLESALES);
    });
  }, []);

  const setActiveWholesaleId = useCallback((id: string) => {
    setActiveWholesaleIdState(id);
  }, []);

  const renameWholesale = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setWholesalesState((prev) =>
      prev.map((w) => (w.id === id ? { ...w, name: trimmed } : w))
    );
  }, []);

  const addWholesale = useCallback((): WholesaleList | null => {
    let created: WholesaleList | null = null;
    setWholesalesState((prev) => {
      if (prev.length >= MAX_WHOLESALES) return prev;
      const n = prev.length + 1;
      created = { id: createWholesaleId(), name: `Wholesale ${n}` };
      return [...prev, created];
    });
    if (created) {
      setActiveWholesaleIdState(created.id);
    }
    return created;
  }, []);

  /** Soft-delete: move list to archive (inventory rows stay on wholesaleId). */
  const archiveWholesale = useCallback((id: string): { ok: true } | { ok: false; error: string } => {
    const target = wholesales.find((w) => w.id === id);
    if (!target) return { ok: false, error: 'Wholesale not found.' };
    if (wholesales.length <= 1) {
      return { ok: false, error: 'Keep at least one wholesale list.' };
    }
    setWholesalesState((prev) => prev.filter((w) => w.id !== id));
    setArchivedWholesales((prev) => [
      { id: target.id, name: target.name, archivedAt: Date.now() },
      ...prev.filter((w) => w.id !== id),
    ]);
    if (activeWholesaleId === id) {
      const next = wholesales.find((w) => w.id !== id);
      if (next) setActiveWholesaleIdState(next.id);
    }
    return { ok: true };
  }, [wholesales, activeWholesaleId]);

  const restoreWholesale = useCallback((id: string): { ok: true } | { ok: false; error: string } => {
    const target = archivedWholesales.find((w) => w.id === id);
    if (!target) return { ok: false, error: 'Archived wholesale not found.' };
    if (wholesales.length >= MAX_WHOLESALES) {
      return { ok: false, error: 'Maximum wholesale lists reached.' };
    }
    if (wholesales.some((w) => w.id === id)) {
      setArchivedWholesales((prev) => prev.filter((w) => w.id !== id));
      return { ok: true };
    }
    setWholesalesState((prev) => [...prev, { id: target.id, name: target.name }].slice(0, MAX_WHOLESALES));
    setArchivedWholesales((prev) => prev.filter((w) => w.id !== id));
    setActiveWholesaleIdState(id);
    return { ok: true };
  }, [archivedWholesales, wholesales.length]);

  // Keep active id valid if lists change
  useEffect(() => {
    if (!wholesales.some((w) => w.id === activeWholesaleId) && wholesales[0]) {
      setActiveWholesaleIdState(wholesales[0].id);
    }
  }, [wholesales, activeWholesaleId]);

  // Assign missing wholesaleId on load / list changes
  useEffect(() => {
    const fallback = defaultWholesaleId(wholesales);
    setItems((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (item.wholesaleId) return item;
        changed = true;
        return { ...item, wholesaleId: fallback };
      });
      return changed ? next : prev;
    });
  }, [wholesales]);

  return {
    items,
    setItems,
    purchases,
    setPurchases,
    wholesales,
    setWholesales,
    activeWholesaleId,
    setActiveWholesaleId,
    renameWholesale,
    addWholesale,
    archivedWholesales,
    archiveWholesale,
    restoreWholesale,
  };
};
