import React from 'react';
import { CartLineItem } from '../types';
import { formatSwitcherLineSum, formatSwitcherTotal } from '../utils/switcherCurrency';

export const formatSwitcherLineAmount = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
};

interface InvoiceSwitcherProductLineProps {
  item: CartLineItem;
  index: number;
  currency: string;
  compact?: boolean;
}

export const InvoiceSwitcherProductLine: React.FC<InvoiceSwitcherProductLineProps> = ({
  item,
  index,
  currency,
  compact = false,
}) => {
  const name = item.name || `Item ${index + 1}`;
  const lineTotal = formatSwitcherLineAmount(item.price * item.quantity);

  return (
    <div
      className={`invoice-switcher-card__line ${compact ? 'invoice-switcher-card__line--compact' : ''}`}
      title={`${item.quantity} · ${name} · ${currency}${lineTotal}`}
    >
      <span className="invoice-switcher-card__line-qty tabular-nums">{item.quantity}</span>
      <span className="invoice-switcher-card__line-name truncate" title={name}>
        {name}
      </span>
      <span className="invoice-switcher-card__line-sum tabular-nums">
        {formatSwitcherLineSum(lineTotal, currency)}
      </span>
    </div>
  );
};

interface InvoiceSwitcherTotalRowProps {
  total: string;
  currency: string;
}

export const InvoiceSwitcherTotalRow: React.FC<InvoiceSwitcherTotalRowProps> = ({
  total,
  currency,
}) => (
  <div className="invoice-switcher-card__total">
    <span className="invoice-switcher-card__total-value tabular-nums">
      {formatSwitcherTotal(total, currency)}
    </span>
  </div>
);