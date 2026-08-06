import { useState, useEffect } from 'react';
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

/** One price change (or initial price) for the pricings history log. */
export interface PriceHistoryEntry {
  id: string;
  itemId: string;
  itemName: string;
  price: number;
  previousPrice?: number;
  timestamp: number;
  profileName?: string;
  source: 'create' | 'update' | 'restock';
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

export interface InventoryItem {
  id: string;
  name: string;
  /** Stock in packs / base units (not whole boxes). */
  stock: number;
  price: number;
  threshold: number;
  category: string;
  dateAdded: string;
  supplier: string;
  lastStocked: string;
  image: string;
  activities: ActivityLogEntry[];
  /**
   * How many packs fit in one box/carton.
   * e.g. 8 → adding 4 packs on the calculator means 1/2 box.
   */
  unitsPerBox?: number;
  /** Chronological price changes for this item (newest first preferred). */
  priceHistory?: PriceHistoryEntry[];
}

export const usePOS = (_history: HistoryItem[]) => {
  const [items, setItems] = useState<InventoryItem[]>(() => storage.get('pos_inventory', []));
  const [purchases, setPurchases] = useState<PurchaseRecord[]>(() => storage.get('pos_purchases', []));

  useEffect(() => { storage.set('pos_inventory', items); }, [items]);
  useEffect(() => { storage.set('pos_purchases', purchases); }, [purchases]);

  // Auto sales injection from history removed (cleared hardcoded cache sales)

  return { items, setItems, purchases, setPurchases };
};