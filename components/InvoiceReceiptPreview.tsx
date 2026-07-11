import React from 'react';
import { CartLineItem } from '../types';

export type InvoiceReceiptStatus = 'Current' | 'Paid' | 'Open' | 'Saved';

const formatLineAmount = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
};

export interface InvoiceReceiptPreviewProps {
  brandLabel?: string;
  title: string;
  status: InvoiceReceiptStatus;
  items: CartLineItem[];
  total: string;
  currency: string;
  variant?: 'tile' | 'list' | 'drawer';
  maxItemLines?: number;
  meta?: string;
  className?: string;
}

const InvoiceReceiptPreview: React.FC<InvoiceReceiptPreviewProps> = ({
  brandLabel = 'iCalc POS',
  title,
  status,
  items,
  total,
  currency,
  variant = 'drawer',
  maxItemLines,
  meta,
  className = '',
}) => {
  const isPaid = status === 'Paid';
  const visibleItems = maxItemLines != null ? items.slice(0, maxItemLines) : items;
  const overflowCount =
    maxItemLines != null && items.length > maxItemLines ? items.length - maxItemLines : 0;

  return (
    <div
      className={`invoice-switcher-card invoice-receipt-preview invoice-receipt-preview--${variant} ${className}`.trim()}
    >
      <header className="invoice-switcher-card__header">
        <div className="invoice-switcher-card__brand-row">
          <span className="invoice-switcher-card__brand" title={brandLabel}>
            {brandLabel}
          </span>
          <span
            className={`invoice-switcher-card__badge ${isPaid ? 'invoice-switcher-card__badge--paid' : ''}`}
          >
            {status}
          </span>
        </div>
        <div className="invoice-switcher-card__title invoice-receipt-line truncate" title={title}>
          {title}
        </div>
        {(meta || variant !== 'list') && (
          <p className="invoice-switcher-card__meta">{meta ?? `${items.length} items`}</p>
        )}
      </header>

      <div className="invoice-switcher-card__body invoice-receipt-line">
        <div className="invoice-switcher-card__rule" aria-hidden="true" />

        <div className="invoice-switcher-card__lines">
          {items.length === 0 ? (
            <div className="invoice-receipt-preview__empty">No items yet</div>
          ) : (
            <>
              {visibleItems.map((item, index) => {
                const name = item.name || `Item ${index + 1}`;
                const priceLabel = formatLineAmount(item.price);
                const lineTotal = formatLineAmount(item.price * item.quantity);

                return (
                  <div
                    key={`${name}-${index}`}
                    className="invoice-switcher-card__line invoice-switcher-card__line--compact"
                    title={`${name} ${priceLabel} * ${item.quantity} = ${currency}${lineTotal}`}
                  >
                    <span className="min-w-0 truncate">
                      {name}{' '}
                      <span className="font-semibold">{priceLabel}</span>
                      {' * '}
                      {item.quantity}
                    </span>
                    <span className="invoice-switcher-card__line-total shrink-0 tabular-nums font-semibold">
                      {currency}
                      {lineTotal}
                    </span>
                  </div>
                );
              })}
              {overflowCount > 0 && (
                <div className="invoice-receipt-preview__more">+{overflowCount} more</div>
              )}
            </>
          )}
        </div>

        <div className="invoice-switcher-card__rule" aria-hidden="true" />
        <div className="invoice-switcher-card__total">
          <span className="invoice-switcher-card__total-label">Total</span>
          <span className="invoice-switcher-card__total-value tabular-nums">
            {currency}
            {total}
          </span>
        </div>
      </div>
    </div>
  );
};

export default InvoiceReceiptPreview;