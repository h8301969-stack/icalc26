import { useState, useCallback } from 'react';
import { HistoryItem } from '../types';
import { storage } from './storage';

const HISTORY_KEY = 'calc_history';

export const useHistory = () => {
  const [history, setHistory] = useState<HistoryItem[]>(() => storage.get(HISTORY_KEY, []));

  const saveResult = useCallback((expression: string, result: string) => {
    setHistory(prev => {
      const newList = [{ 
        id: Date.now().toString(), 
        expression, 
        result, 
        timestamp: Date.now() 
      }, ...prev].slice(0, 50);
      storage.set(HISTORY_KEY, newList);
      return newList;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    storage.set(HISTORY_KEY, []);
  }, []);

  return { history, setHistory, saveResult, clearHistory };
};