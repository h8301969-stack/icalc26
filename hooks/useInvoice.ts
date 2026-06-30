import { useState, useEffect, useMemo } from 'react';
import { CartLineItem, InvoiceActionLog, InvoicePrintLog } from '../types';
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

const PAST_LOGS_KEY = 'past_invoice_logs';
const PRINT_LOGS_KEY = 'invoice_print_logs';

export const useInvoice = (
  expression: string,
  inventory: InventoryItem[],
  currency = 'GHS'
) => {
  const [invoiceName, setInvoiceName] = useState(() =>
    storage.get(INVOICE_NAME_KEY, 'Invoice #1')
  );

  const [pastLogs, setPastLogs] = useState<InvoiceActionLog[]>(() =>
    storage.get(PAST_LOGS_KEY, [])
  );

  const [printLogs, setPrintLogs] = useState<InvoicePrintLog[]>(() =>
    storage.get(PRINT_LOGS_KEY, [])
  );

  useEffect(() => {
    storage.set(INVOICE_NAME_KEY, invoiceName);
  }, [invoiceName]);

  useEffect(() => {
    storage.set(PAST_LOGS_KEY, pastLogs);
  }, [pastLogs]);

  useEffect(() => {
    storage.set(PRINT_LOGS_KEY, printLogs);
  }, [printLogs]);

  const cartItems = useMemo((): CartLineItem[] => {
    if (!expression || expression === '0') return [];
    return parsePosLineItems(expression).map((item) => ({
      ...item,
      name: matchInventoryByPrice(item.price, inventory)?.name,
    }));
  }, [expression, inventory]);

  const currentLogs = useMemo((): InvoiceActionLog[] => {
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
      .filter((log): log is NonNullable<typeof log> => log !== null) as InvoiceActionLog[];
  }, [expression, inventory, invoiceName, currency]);

  const actionLogs = useMemo(() => {
    return [...pastLogs, ...currentLogs];
  }, [pastLogs, currentLogs]);

  const runningTotal = useMemo(() => {
    if (!expression || expression === '0') return '0.00';
    return safeEvaluate(expression);
  }, [expression]);

  const saveCurrentInvoiceAndStartNew = () => {
    if (currentLogs.length > 0) {
      setPastLogs((prev) => [...prev, ...currentLogs]);
    }
    
    // Increment invoice number
    const match = invoiceName.match(/Invoice #(\d+)/);
    let nextNum = 2;
    if (match) {
      nextNum = parseInt(match[1], 10) + 1;
    }
    setInvoiceName(`Invoice #${nextNum}`);
  };

  const clearAllInvoices = () => {
    setPastLogs([]);
  };

  const recordPrint = (name: string, total: string, items: CartLineItem[]) => {
    setPrintLogs((prev) => [
      ...prev,
      {
        id: `print-${Date.now()}`,
        invoiceName: name,
        timestamp: Date.now(),
        total,
        items,
      },
    ]);
  };

  return {
    invoiceName,
    setInvoiceName,
    cartItems,
    actionLogs,
    runningTotal,
    printLogs,
    saveCurrentInvoiceAndStartNew,
    clearAllInvoices,
    recordPrint,
  };
};
