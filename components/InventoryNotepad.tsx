import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { RestockLineItem } from '../types';
import { InventoryItem } from '../hooks/usePOS';
import { formInputClass, formTextareaClass } from '../utils/formFields';

const QTY_COL_WIDTH = '4.5rem';

function getInventorySuggestions(items: InventoryItem[], query: string, limit = 8): InventoryItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return items
    .filter((item) => {
      const name = item.name.toLowerCase();
      const category = (item.category ?? '').toLowerCase();
      return name.includes(q) || category.includes(q);
    })
    .slice(0, limit);
}

export interface InventoryNotepadProps {
  isLight: boolean;
  items: InventoryItem[];
  lineItems: RestockLineItem[];
  onLineItemsChange: (lines: RestockLineItem[]) => void;
  composeQuery: string;
  onComposeQueryChange: (query: string) => void;
  freeNotes?: string;
  onFreeNotesChange?: (notes: string) => void;
  freeNotesPlaceholder?: string;
  accentClass: string;
  timestampLabel?: string;
  showUpdateButton?: boolean;
  emptyHint?: string;
}

const InventoryNotepad: React.FC<InventoryNotepadProps> = ({
  isLight,
  items,
  lineItems,
  onLineItemsChange,
  composeQuery,
  onComposeQueryChange,
  freeNotes = '',
  onFreeNotesChange,
  freeNotesPlaceholder = 'Optional notes...',
  accentClass,
  timestampLabel,
  showUpdateButton = true,
  emptyHint = 'Type to search products…',
}) => {
  const composeRef = useRef<HTMLInputElement>(null);
  const [highlightIdx, setHighlightIdx] = useState(0);

  const suggestions = useMemo(
    () => getInventorySuggestions(items, composeQuery),
    [items, composeQuery]
  );

  const overallQty = useMemo(
    () => lineItems.reduce((sum, line) => sum + line.qty, 0),
    [lineItems]
  );

  useEffect(() => {
    setHighlightIdx(0);
  }, [composeQuery, suggestions.length]);

  const addProduct = useCallback(
    (item: InventoryItem) => {
      onLineItemsChange(
        (() => {
          const existing = lineItems.find((line) => line.itemId === item.id);
          if (existing) {
            return lineItems.map((line) =>
              line.itemId === item.id ? { ...line, qty: line.qty + 1 } : line
            );
          }
          return [...lineItems, { itemId: item.id, name: item.name, qty: 1 }];
        })()
      );
      onComposeQueryChange('');
      composeRef.current?.focus();
    },
    [lineItems, onLineItemsChange, onComposeQueryChange]
  );

  const commitCompose = useCallback(() => {
    const q = composeQuery.trim();
    if (!q) return false;
    if (suggestions.length > 0) {
      addProduct(suggestions[highlightIdx] ?? suggestions[0]);
      return true;
    }
    const exact = items.find((item) => item.name.toLowerCase() === q.toLowerCase());
    if (exact) {
      addProduct(exact);
      return true;
    }
    const partial = getInventorySuggestions(items, q, 1)[0];
    if (partial) {
      addProduct(partial);
      return true;
    }
    return false;
  }, [addProduct, composeQuery, highlightIdx, items, suggestions]);

  const updateLineQty = useCallback(
    (itemId: string, raw: string) => {
      const parsed = Math.max(1, Math.round(parseFloat(raw) || 1));
      onLineItemsChange(
        lineItems.map((line) => (line.itemId === itemId ? { ...line, qty: parsed } : line))
      );
    },
    [lineItems, onLineItemsChange]
  );

  const handleComposeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % suggestions.length);
      return;
    }
    if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault();
      setHighlightIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commitCompose();
      return;
    }
    if (e.key === 'Escape') {
      onComposeQueryChange('');
    }
  };

  const lineGridStyle = {
    gridTemplateColumns: `1fr ${QTY_COL_WIDTH}`,
  } as const;

  const textMain = isLight ? 'text-zinc-800' : 'text-zinc-200';
  const textMuted = isLight ? 'text-zinc-600' : 'text-zinc-400';
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {timestampLabel && (
        <div className="px-5 pt-4 pb-2 shrink-0">
          <p className={`text-sm font-bold leading-7 select-none ${textMuted}`}>{timestampLabel}</p>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-5 custom-scrollbar">
        {lineItems.length > 0 ? (
          <div className="space-y-0.5 pb-2">
            {lineItems.map((line) => (
              <div
                key={line.itemId}
                className="grid items-center gap-3 text-base leading-7 font-medium"
                style={lineGridStyle}
              >
                <span className={`min-w-0 truncate ${textMain}`}>{line.name}</span>
                <div className={`flex items-center justify-end gap-1 tabular-nums font-black ${accentClass}`}>
                  <span className="select-none">×</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={line.qty}
                    onChange={(e) => updateLineQty(line.itemId, e.target.value)}
                    className={`w-12 bg-transparent text-right outline-none font-black tabular-nums ${accentClass}`}
                    aria-label={`Quantity for ${line.name}`}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={`app-subtext text-[10px] opacity-45 ${textMain}`}>{emptyHint}</p>
        )}
      </div>

      {onFreeNotesChange && (
        <div className="px-5 py-2 shrink-0">
          <textarea
            value={freeNotes}
            onChange={(e) => onFreeNotesChange(e.target.value)}
            placeholder={freeNotesPlaceholder}
            rows={2}
            className={formTextareaClass(isLight, 'leading-6')}
          />
        </div>
      )}

      <div
        className="shrink-0 px-5 py-4 border-t space-y-3"
        style={{ borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)' }}
      >
        <div className="grid items-center gap-3" style={lineGridStyle}>
          <span />
          <span className={`text-xl font-black tabular-nums text-right ${accentClass}`}>= {overallQty}</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0 relative">
            <input
              ref={composeRef}
              type="text"
              value={composeQuery}
              onChange={(e) => onComposeQueryChange(e.target.value)}
              onKeyDown={handleComposeKeyDown}
              placeholder="Type product name…"
              className={formInputClass(isLight, { className: 'leading-7' })}
              style={{ lineHeight: '28px' }}
              aria-label="Add product"
              aria-autocomplete="list"
              aria-expanded={suggestions.length > 0}
            />
            {suggestions.length > 0 && (
              <div
                className={`absolute left-0 right-0 bottom-full mb-1 max-h-40 overflow-y-auto rounded-xl border shadow-lg z-10 custom-scrollbar ${
                  isLight ? 'bg-white border-black/10 text-black' : 'bg-[#1c1c1e] border-white/15 text-white'
                }`}
                role="listbox"
              >
                {suggestions.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={idx === highlightIdx}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    onClick={() => addProduct(item)}
                    className={`w-full text-left px-4 py-2.5 text-sm font-bold transition-colors ${
                      idx === highlightIdx
                        ? isLight
                          ? 'bg-black/8'
                          : 'bg-white/12'
                        : isLight
                          ? 'hover:bg-black/5'
                          : 'hover:bg-white/8'
                    }`}
                  >
                    {item.name}
                    {item.category && (
                      <span className="ml-2 text-[10px] font-black opacity-50">{item.category}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          {showUpdateButton && (
            <button
              type="button"
              onClick={commitCompose}
              disabled={!composeQuery.trim()}
              className={`shrink-0 px-5 py-2.5 rounded-full font-black text-xs tracking-[0.2em] uppercase active:scale-95 transition-all disabled:opacity-40 ${
                isLight ? 'bg-zinc-900 text-white' : 'bg-white text-black'
              }`}
              aria-label="Add product to list"
            >
              Update
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default InventoryNotepad;