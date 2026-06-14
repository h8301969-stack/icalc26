import { useState, useEffect } from 'react';
import { supabase } from './supabase';

interface HistoryItem {
  id: string;
  expression: string;
  result: string;
  timestamp: number;
}

export default function App() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchHistory() {
      const { data, error } = await supabase
        .from('history')
        .select('*')
        .order('timestamp', { ascending: false });

      if (error) {
        console.error('Error fetching history:', error.message);
      } else if (data) {
        setHistory(data as HistoryItem[]);
      }
      setLoading(false);
    }

    fetchHistory();
  }, []);

  return (
    <div className="p-6 max-w-md mx-auto h-full overflow-y-auto custom-scrollbar">
      <h1 className="text-3xl font-bold mb-6">History</h1>
      {loading ? <p>Loading calculations...</p> : history.map((item) => (
        <div key={item.id} className="glass-panel p-4 mb-3 rounded-2xl animate-fade-in">
          <div className="text-sm text-zinc-400">{item.expression}</div>
          <div className="text-2xl font-semibold">{item.result}</div>
        </div>
      ))}
    </div>
  );
}