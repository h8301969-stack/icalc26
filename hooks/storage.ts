export type StorageKey =
  | 'calc_history'
  | 'calc_settings'
  | 'icalc-history'
  | 'icalc-settings'
  | 'icalc-pos-inventory'
  | 'icalc-pos-sales'
  | string;

export const storage = {
  get: <T>(key: StorageKey, defaultValue: T): T => {
    try {
      const item = localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : defaultValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return defaultValue;
    }
  },

  /**
   * Stringifies and saves an item to localStorage.
   */
  set: <T>(key: StorageKey, value: T): void => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Error writing to localStorage key "${key}":`, error);
    }
  }
};