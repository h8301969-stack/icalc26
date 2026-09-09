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
          className={`price-item-picker-overlay ${
            visible ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
        >
          <div
            className={`price-item-picker h-full w-full rounded-[16px] shadow-[0_8px_22px_rgba(0,0,0,0.28)] ${
              visible ? 'price-item-picker--in' : 'price-item-picker--out'
            } ${panelBg}`}
            role="dialog"
            aria-label={`Choose item, ${priceLabel}, ${items.length} matches`}
          >
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
                  className={`price-item-picker-tile ${selected ? 'price-item-picker-tile--selected' : ''}`}
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
                        <Icons.Check size={11} />
                      </span>
                    )}
                    <div className="price-item-picker-tile__caption">
                      <span className="price-item-picker-tile__name">{item.name}</span>
                      <span className="price-item-picker-tile__meta">
                        {(item.grams ?? 0) > 0 ? `${item.grams}g` : `Stock ${item.stock}`}
                      </span>
                    </div>
                  </div>
                </button>
                );
              })}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={`price-item-picker-close shrink-0 ${isLight ? 'bg-black/8 text-black/70' : 'bg-white/12 text-white/80'}`}
              >
                <Icons.X size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </MorphPresence>
  );
};

export default PriceItemPicker;
