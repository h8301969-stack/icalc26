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
  stock: number;
  price: number;
  threshold: number;
  category: string;
  dateAdded: string;
  supplier: string;
  lastStocked: string; 
  image: string;
  activities: ActivityLogEntry[];
}

export const usePOS = (_history: HistoryItem[]) => {
  const [items, setItems] = useState<InventoryItem[]>(() => storage.get('pos_inventory', []));
  const [purchases, setPurchases] = useState<PurchaseRecord[]>(() => storage.get('pos_purchases', []));

  useEffect(() => { storage.set('pos_inventory', items); }, [items]);
  useEffect(() => { storage.set('pos_purchases', purchases); }, [purchases]);

  // Auto sales injection from history removed (cleared hardcoded cache sales)

  return { items, setItems, purchases, setPurchases };
};