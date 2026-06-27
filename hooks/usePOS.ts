import { useState, useEffect } from 'react';
import { HistoryItem } from '../types';
import { storage } from './storage';

export interface ActivityLogEntry {
  id: string;
  type: 'restock' | 'sale' | 'cart-add' | 'cart-remove' | 'image-update';
  action: string;
  time: string;
  timestamp: number;
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
    image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=400&q=80',
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
    image: 'https://images.unsplash.com/photo-1509223197845-458d87318791?w=400&q=80',
    activities: [
      { id: '2b', type: 'restock', action: 'Restocked 5 units', time: '2 days ago', timestamp: Date.now() - 3600000 * 48 },
    ]
  }
];

export const usePOS = (history: HistoryItem[]) => {
  const [items, setItems] = useState<InventoryItem[]>(() => storage.get('pos_inventory', INITIAL_INVENTORY));
  const [purchases, setPurchases] = useState<PurchaseRecord[]>(() => storage.get('pos_purchases', []));

  useEffect(() => { storage.set('pos_inventory', items); }, [items]);
  useEffect(() => { storage.set('pos_purchases', purchases); }, [purchases]);

  useEffect(() => {
    if (history.length > 0) {
      const latest = history[0];
      if (!purchases.some(p => p.id === latest.id)) {
        const newPurchase: PurchaseRecord = {
          id: latest.id,
          itemName: 'Retail Sale',
          quantity: 1,
          price: parseFloat(latest.result),
          total: parseFloat(latest.result),
          date: new Date(latest.timestamp).toLocaleString(),
          timestamp: latest.timestamp
        };
        setPurchases(prev => [newPurchase, ...prev].slice(0, 50));
      }
    }
  }, [history, purchases]);

  return { items, setItems, purchases, setPurchases };
};