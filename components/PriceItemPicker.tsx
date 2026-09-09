import React, { useLayoutEffect, useRef } from 'react';
import { Icons } from '../constants';
import { InventoryItem } from '../hooks/usePOS';
import { MorphPresence } from './MorphCrossfade';
import InventoryItemImage from './InventoryItemImage';
import { formatPriceLabel } from '../utils/posExpression';

interface PriceItemPickerProps {
  isOpen: boolean;
  items: InventoryItem[];
  price: number;
  selectedItemId?: string | null;
  currency?: string;
  isLight: boolean;
  accountId?: string | null;
  onSelect: (item: InventoryItem) => void;
  onClose: () => void;
}

const PriceItemPicker: React.FC<PriceItemPickerProps> = ({
  isOpen,
  items,
  price,
  selectedItemId = null,
  currency = 'GHS',
  isLight,
  accountId = null,
  onSelect,
  onClose,
}) => {
  const panelBg = isLight ? 'bg-[#f2f2f7] text-zinc-900' : 'bg-[#1c1c1e] text-white';
  const tileBg = isLight ? 'bg-white border-zinc-200' : 'bg-zinc-800/70 border-white/8';
  const priceLabel = formatPriceLabel(price, currency);
  const rowRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!isOpen || !selectedItemId) return;
    const selected = rowRef.current?.querySelector(
      `[data-price-item="${CSS.escape(selectedItemId)}"]`
    );
    if (selected instanceof HTMLElement) {
      selected.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, [isOpen, selectedItemId]);

  return (
    <MorphPresence show={isOpen} exitMs={280}>
      {(visible) => (
        <div
          className={`price-item-picker-slot w-full shrink-0 px-[8%] ${
            visible ? 'price-item-picker-slot--in pointer-events-auto' : 'pointer-events-none'
          }`}
        >
          <div className="price-item-picker-slot__inner">
          <div
            className={`price-item-picker relative w-full mb-1 rounded-[20px] shadow-[0_12px_32px_rgba(0,0,0,0.28)] ${
              visible ? 'price-item-picker--in' : 'price-item-picker--out'
            } ${panelBg}`}
            role="dialog"
            aria-label="Choose item"
            aria-labelledby="price-item-picker-title"
          >
            <div
              className={`px-3 pt-2.5 pb-1.5 flex items-center justify-between border-b ${
                isLight ? 'border-black/6' : 'border-white/6'
              }`}
            >
              <div className="min-w-0 pr-3">
                <h3 id="price-item-picker-title" className="text-sm font-black truncate">
                  Choose item
                </h3>
                <p className={`text-[11px] font-semibold opacity-55 truncate`}>
                  {priceLabel} · {items.length} matches
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={`p-1.5 rounded-full shrink-0 ${isLight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
              >
                <Icons.X size={18} />
              </button>
            </div>
            <div ref={rowRef} className="price-item-picker-row" role="list">
              {items.map((item) => {
                const selected = item.id === selectedItemId;
                return (
                <button
                  key={item.id}
                  type="button"
                  role="listitem"
                  data-price-item={item.id}
                  onClick={() => onSelect(item)}
                  className={`price-item-picker-tile ${tileBg} ${selected ? 'price-item-picker-tile--selected' : ''}`}
                  aria-label={selected ? `${item.name}, selected` : `Use ${item.name} on invoice`}
                  aria-pressed={selected}
                >
                  <div className="price-item-picker-tile__image">
                    <InventoryItemImage
                      image={item.image}
                      alt={item.name}
                      accountId={accountId}
                      itemId={item.id}
                      className="w-full h-full object-cover"
                    />
                    {selected && (
                      <span className="price-item-picker-tile__check" aria-hidden="true">
                        <Icons.Check size={14} />
                      </span>
                    )}
                  </div>
                  <span className="price-item-picker-tile__name">{item.name}</span>
                  {(item.grams ?? 0) > 0 ? (
                    <span className="price-item-picker-tile__meta">{item.grams}g</span>
                  ) : (
                    <span className="price-item-picker-tile__meta">Stock {item.stock}</span>
                  )}
                </button>
                );
              })}
            </div>
          </div>
          </div>
        </div>
      )}
    </MorphPresence>
  );
};

export default PriceItemPicker;
