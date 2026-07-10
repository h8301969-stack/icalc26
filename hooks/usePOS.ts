import { useState, useEffect } from 'react';
import { HistoryItem } from '../types';
import { storage } from './storage';
import { WALLPAPER_IMAGE_URLS } from '../utils/wallpapers';

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

const INITIAL_INVENTORY: InventoryItem[] = [
  { 
    id: '1', 
    name: 'Neural Processor X1', 
    stock: 42, 
    price: 450,
    threshold: 50, 
    category: 'Hardware', 
    dateAdded: '2025-01-10', 
    supplier: 'Synapse Tech', 
    lastStocked: new Date(Date.now() - 3600000 * 2).toISOString(),
    image: WALLPAPER_IMAGE_URLS[0],
    activities: [
      { id: '1a', type: 'restock', action: 'Restocked 10 units', time: '2h ago', timestamp: Date.now() - 3600000 * 2 },
    ]
  },
  { 
    id: '2', 
    name: 'Optic Glass v26', 
    stock: 12, 
    price: 120,
    threshold: 20, 
    category: 'Optics', 
    dateAdded: '2025-02-14', 
    supplier: 'Lumina Corp', 
    lastStocked: new Date(Date.now() - 3600000 * 48).toISOString(),
    image: WALLPAPER_IMAGE_URLS[1],
    activities: [
      { id: '2b', type: 'restock', action: 'Restocked 5 units', time: '2 days ago', timestamp: Date.now() - 3600000 * 48 },
    ]
  }
];

export const usePOS = (_history: HistoryItem[]) => {
  const [items, setItems] = useState<InventoryItem[]>(() => storage.get('pos_inventory', INITIAL_INVENTORY));
  const [purchases, setPurchases] = useState<PurchaseRecord[]>(() => storage.get('pos_purchases', []));

  useEffect(() => { storage.set('pos_inventory', items); }, [items]);
  useEffect(() => { storage.set('pos_purchases', purchases); }, [purchases]);

  // Auto sales injection from history removed (cleared hardcoded cache sales)

  return { items, setItems, purchases, setPurchases };
};