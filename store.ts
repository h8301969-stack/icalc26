import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { HistoryItem } from './types';
import { supabase } from './supabase';

interface CalculatorState {
  display: string;
  history: HistoryItem[];
  lastResult: string | null;
  
  // Actions
  updateDisplay: (value: string) => void;
  clearDisplay: () => void;
  addHistoryItem: (expression: string, result: string) => void;
  clearHistory: () => void;
  fetchHistory: () => Promise<void>; // Added action to fetch history
  setResult: (result: string) => void;
}

export const useStore = create<CalculatorState>()(
  persist(
    (set) => ({
      display: '0',
      history: [],
      lastResult: null,

      updateDisplay: (value) => set((state) => ({
        display: state.display === '0' ? value : state.display + value
      })),

      clearDisplay: () => set({ display: '0' }),

      addHistoryItem: async (expression, result) => {
        const newItem: HistoryItem = {
          id: crypto.randomUUID(),
          expression,
          result,
          timestamp: Date.now(),
        };

        set((state) => ({
          history: [newItem, ...state.history].slice(0, 50)
        }));

        // Sync to Supabase
        const { error } = await supabase.from('history').insert([newItem]);
        if (error) console.error('Supabase sync error:', error.message);
      },

      // Action to fetch history from Supabase and update the store
      fetchHistory: async () => {
        const { data, error } = await supabase
          .from('history')
          .select('*')
          .order('timestamp', { ascending: false });
        if (error) {
          console.error('Error fetching history from Supabase:', error.message);
        } else if (data) {
          set({ history: data as HistoryItem[] });
        }
      },
      clearHistory: () => set({ history: [] }),

      setResult: (result) => set({ lastResult: result, display: result }),
    }),
    {
      name: 'icalc-26-state', // Unique key for localStorage
    }
  )
);