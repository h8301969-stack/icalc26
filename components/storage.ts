/**
 * Production-grade Storage Service.
 * Centralizes persistence logic so the storage engine (localStorage, IndexedDB, Backend API)
 * can be swapped without changing UI components or business hooks.
 */

export type StorageKey = 'icalc-history' | 'icalc-settings' | 'icalc-pos-inventory' | 'icalc-pos-sales';

export const storage = {
  get: <T>(key: StorageKey, defaultValue: T): T => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      console.error(`[Storage Service] Error reading key "${key}":`, error);
      return defaultValue;
    }
  },

  set: <T>(key: StorageKey, value: T): void => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`[Storage Service] Error saving key "${key}":`, error);
    }
  }
};