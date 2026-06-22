import { useState, useEffect, useMemo } from 'react';
import { CartLineItem, InvoiceActionLog } from '../types';
import { InventoryItem } from './usePOS';
import { storage } from './storage';
import {
  getLoggedSegments,
  parsePosLineItems,
  formatPriceLabel,
} from '../utils/posExpression';
import { safeEvaluate } from '../utils/calculator';

const INVOICE_NAME_KEY = 'invoice_name';

const matchInventoryByPrice = (
  price: number,
  inventory: InventoryItem[]
): InventoryItem | undefined =>
  inventory.find((item) => Math.abs(item.price - price) < 0.001);

export const useInvoice = (
  expression: string,
  inventory: InventoryItem[],
  currency = 'GHS'
) => {
  const [invoiceName, setInvoiceName] = useState(() =>
    storage.get(INVOICE_NAME_KEY, 'Invoice #1')
  );

  useEffect(() => {
    storage.set(INVOICE_NAME_KEY, invoiceName);
  }, [invoiceName]);

  const cartItems = useMemo((): CartLineItem[] => {
    if (!expression || expression === '0') return [];
    return parsePosLineItems(expression).map((item) => ({
      ...item,
      name: matchInventoryByPrice(item.price, inventory)?.name,
    }));
  }, [expression, inventory]);

  const actionLogs = useMemo((): InvoiceActionLog[] => {
    const segments = getLoggedSegments(expression);
    return segments
      .map((segment, idx) => {
        const item = parsePosLineItems(segment)[0];
        if (!item) return null;

        const matched = matchInventoryByPrice(item.price, inventory);
        const label = matched?.name ?? formatPriceLabel(item.price, currency);

        return {
          id: `invoice-log-${idx}-${segment}`,
          message: `${label} has been added to ${invoiceName}`,
          itemName: matched?.name,
          price: item.price,
          quantity: item.quantity,
          invoiceName,
          timestamp: Date.now() - (segments.length - idx) * 1000,
        };
      })
      .filter((log): log is InvoiceActionLog => log !== null);
  }, [expression, inventory, invoiceName, currency]);

  const runningTotal = useMemo(() => {
    if (!expression || expression === '0') return '0.00';
    return safeEvaluate(expression);
  }, [expression]);

  return {
    invoiceName,
    setInvoiceName,
    cartItems,
    actionLogs,
    runningTotal,
  };
};
