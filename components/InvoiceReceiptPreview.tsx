import React from 'react';
import { CartLineItem } from '../types';
import { InvoiceSwitcherProductLine, InvoiceSwitcherTotalRow } from './InvoiceSwitcherLine';
import BusinessReceiptIdentity from './BusinessReceiptIdentity';

export type InvoiceReceiptStatus = 'Current' | 'Paid' | 'Open' | 'Saved';

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
  businessName?: string;
  businessPhone?: string;
  businessAddress?: string;
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
  businessName = '',
  businessPhone = '',
  businessAddress = '',
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
        <BusinessReceiptIdentity
          businessName={businessName}
          businessPhone={businessPhone}
          businessAddress={businessAddress}
        />
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
              {visibleItems.map((item, index) => (
                <InvoiceSwitcherProductLine
                  key={`${item.name || 'item'}-${index}`}
                  item={item}
                  index={index}
                  currency={currency}
                  compact
                />
              ))}
              {overflowCount > 0 && (
                <div className="invoice-receipt-preview__more">+{overflowCount} more</div>
              )}
            </>
          )}
        </div>

        <div className="invoice-switcher-card__rule" aria-hidden="true" />
        <InvoiceSwitcherTotalRow total={total} currency={currency} />
      </div>
    </div>
  );
};

export default InvoiceReceiptPreview;