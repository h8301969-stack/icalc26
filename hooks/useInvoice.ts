import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { CartLineItem, InvoiceActionLog, InvoicePrintLog, SavedInvoice } from '../types';
import { InventoryItem } from './usePOS';
import { storage } from './storage';
import {
  buildPosExpressionFromItems,
  getLoggedSegments,
  parsePosLineItems,
  formatPriceLabel,
} from '../utils/posExpression';
import { safeEvaluate } from '../utils/calculator';

const INVOICE_NAME_KEY = 'invoice_name';
const PAST_LOGS_KEY = 'past_invoice_logs';
const PRINT_LOGS_KEY = 'invoice_print_logs';
/** Durable invoice roster — survives empty days / restarts until swipe-removed. */
const SAVED_INVOICES_KEY = 'saved_invoices';
const EXPRESSIONS_KEY = 'invoice_expressions';

const matchInventoryByPrice = (
  price: number,
  inventory: InventoryItem[]
): InventoryItem | undefined =>
  inventory.find((item) => Math.abs(item.price - price) < 0.001);

interface SegmentMeta {
  timestamp: number;
  profileName: string;
}

interface RemovedInvoiceSnapshot {
  name: string;
  expression: string;
  logs: InvoiceActionLog[];
  printLogs: InvoicePrintLog[];
  wasCurrent: boolean;
}

const loadSavedInvoices = (): SavedInvoice[] => {
  const raw = storage.get<SavedInvoice[]>(SAVED_INVOICES_KEY, []);
  if (!Array.isArray(raw) || raw.length === 0) {
    const name = storage.get(INVOICE_NAME_KEY, 'Invoice #1');
    return [{ name, expression: '0', isCurrent: true }];
  }
  return raw
    .filter((inv) => inv && typeof inv.name === 'string' && !inv.deletedAt)
    .map((inv) => ({
      name: inv.name,
      expression: typeof inv.expression === 'string' ? inv.expression : '0',
      isCurrent: !!inv.isCurrent,
    }));
};

export const useInvoice = (
  expression: string,
  inventory: InventoryItem[],
  currency = 'GHS',
  profileName = 'Staff'
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

  const [savedInvoices, setSavedInvoices] = useState<SavedInvoice[]>(() => loadSavedInvoices());

  const segmentMetaRef = useRef<Map<string, SegmentMeta>>(new Map());
  const expressionsByInvoiceRef = useRef<Record<string, string>>(
    storage.get<Record<string, string>>(EXPRESSIONS_KEY, {})
  );
  const undoStackRef = useRef<RemovedInvoiceSnapshot[]>([]);
  const [, setUndoTick] = useState(0);

  useEffect(() => {
    expressionsByInvoiceRef.current[invoiceName] = expression;
    storage.set(EXPRESSIONS_KEY, expressionsByInvoiceRef.current);
  }, [invoiceName, expression]);

  useEffect(() => {
    storage.set(INVOICE_NAME_KEY, invoiceName);
  }, [invoiceName]);

  useEffect(() => {
    storage.set(PAST_LOGS_KEY, pastLogs);
  }, [pastLogs]);

  useEffect(() => {
    storage.set(PRINT_LOGS_KEY, printLogs);
  }, [printLogs]);

  useEffect(() => {
    // Keep current flag in sync and ensure current invoice is always listed.
    setSavedInvoices((prev) => {
      const byName = new Map(prev.map((inv) => [inv.name, inv]));
      if (!byName.has(invoiceName)) {
        byName.set(invoiceName, {
          name: invoiceName,
          expression,
          isCurrent: true,
        });
      }
      const next = [...byName.values()].map((inv) => ({
        ...inv,
        expression:
          inv.name === invoiceName
            ? expression
            : expressionsByInvoiceRef.current[inv.name] ?? inv.expression,
        isCurrent: inv.name === invoiceName,
      }));
      return next;
    });
  }, [invoiceName, expression]);

  useEffect(() => {
    storage.set(SAVED_INVOICES_KEY, savedInvoices);
  }, [savedInvoices]);

  const cartItems = useMemo((): CartLineItem[] => {
    if (!expression || expression === '0') return [];
    return parsePosLineItems(expression).map((item) => ({
      ...item,
      name: matchInventoryByPrice(item.price, inventory)?.name,
    }));
  }, [expression, inventory]);

  const currentLogs = useMemo((): InvoiceActionLog[] => {
    const segments = getLoggedSegments(expression);
    const now = Date.now();
    const metaMap = segmentMetaRef.current;

    segments.forEach((segment) => {
      if (!metaMap.has(segment)) {
        metaMap.set(segment, { timestamp: now, profileName });
      }
    });
    for (const key of [...metaMap.keys()]) {
      if (!segments.includes(key)) metaMap.delete(key);
    }

    return segments
      .map((segment, idx) => {
        const item = parsePosLineItems(segment)[0];
        if (!item) return null;

        const matched = matchInventoryByPrice(item.price, inventory);
        const isUnidentified = !matched;
        const label = matched?.name ?? formatPriceLabel(item.price, currency);
        const meta = metaMap.get(segment);

        return {
          id: `invoice-log-${idx}-${segment}`,
          message: `${label} has been added to ${invoiceName}`,
          itemName: matched?.name,
          price: item.price,
          quantity: item.quantity,
          invoiceName,
          timestamp: meta?.timestamp ?? now,
          isUnidentified,
          profileName: meta?.profileName ?? profileName,
        };
      })
      .filter((log): log is NonNullable<typeof log> => log !== null) as InvoiceActionLog[];
  }, [expression, inventory, invoiceName, currency, profileName]);

  const actionLogs = useMemo(() => {
    return [...pastLogs, ...currentLogs];
  }, [pastLogs, currentLogs]);

  const runningTotal = useMemo(() => {
    if (!expression || expression === '0') return '0.00';
    return safeEvaluate(expression);
  }, [expression]);

  const saveCurrentToPast = () => {
    if (currentLogs.length > 0) {
      setPastLogs((prev) => [...prev, ...currentLogs]);
    }
  };

  const switchToInvoice = (name: string) => {
    setPastLogs((prev) => prev.filter((log) => log.invoiceName !== name));
    setInvoiceName(name);
  };

  const saveCurrentInvoiceAndStartNew = () => {
    saveCurrentToPast();
    expressionsByInvoiceRef.current[invoiceName] = expression;

    const match = invoiceName.match(/Invoice #(\d+)/);
    let nextNum = 2;
    if (match) {
      nextNum = parseInt(match[1], 10) + 1;
    }
    // Prefer next unused number among saved roster
    const used = new Set(savedInvoices.map((inv) => inv.name));
    while (used.has(`Invoice #${nextNum}`)) nextNum += 1;
    const nextName = `Invoice #${nextNum}`;
    expressionsByInvoiceRef.current[nextName] = '0';
    storage.set(EXPRESSIONS_KEY, expressionsByInvoiceRef.current);
    setSavedInvoices((prev) => {
      const byName = new Map(prev.map((inv) => [inv.name, { ...inv, isCurrent: false }]));
      byName.set(invoiceName, {
        name: invoiceName,
        expression,
        isCurrent: false,
      });
      byName.set(nextName, { name: nextName, expression: '0', isCurrent: true });
      return [...byName.values()];
    });
    setInvoiceName(nextName);
  };

  const clearAllInvoices = () => {
    setPastLogs([]);
  };

  const resolveUnidentifiedPrice = (price: number, itemName: string) => {
    setPastLogs((prev) =>
      prev.map((log) =>
        log.isUnidentified && Math.abs(log.price - price) < 0.001
          ? {
              ...log,
              itemName,
              isUnidentified: false,
              message: `${itemName} has been added to ${log.invoiceName}`,
            }
          : log
      )
    );
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

  const getInvoiceExpression = useCallback(
    (name: string) => {
      if (expressionsByInvoiceRef.current[name]) return expressionsByInvoiceRef.current[name];
      if (name === invoiceName) return expression;
      const items = pastLogs
        .filter((log) => log.invoiceName === name)
        .map((log) => ({ price: log.price, quantity: log.quantity }));
      return buildPosExpressionFromItems(items) || '0';
    },
    [expression, invoiceName, pastLogs]
  );

  const getSavedInvoices = useCallback((): SavedInvoice[] => {
    const byName = new Map<string, SavedInvoice>();
    for (const inv of savedInvoices) {
      byName.set(inv.name, {
        name: inv.name,
        expression: getInvoiceExpression(inv.name),
        isCurrent: inv.name === invoiceName,
      });
    }
    // Include any names that only exist in logs (legacy)
    for (const log of pastLogs) {
      if (!byName.has(log.invoiceName)) {
        byName.set(log.invoiceName, {
          name: log.invoiceName,
          expression: getInvoiceExpression(log.invoiceName),
          isCurrent: log.invoiceName === invoiceName,
        });
      }
    }
    if (!byName.has(invoiceName)) {
      byName.set(invoiceName, {
        name: invoiceName,
        expression,
        isCurrent: true,
      });
    }
    return [...byName.values()];
  }, [savedInvoices, pastLogs, getInvoiceExpression, invoiceName, expression]);

  const canUndoRemove = undoStackRef.current.length > 0;

  /** Swipe-up remove — keeps roster forever unless explicitly removed. */
  const removeInvoice = useCallback(
    (name: string): { ok: true } | { ok: false; error: string } => {
      const roster = getSavedInvoices();
      if (roster.length <= 1) {
        return { ok: false, error: 'Keep at least one invoice.' };
      }
      const target = roster.find((inv) => inv.name === name);
      if (!target) return { ok: false, error: 'Invoice not found.' };

      const snapshot: RemovedInvoiceSnapshot = {
        name,
        expression: getInvoiceExpression(name),
        logs: pastLogs.filter((l) => l.invoiceName === name),
        printLogs: printLogs.filter((p) => p.invoiceName === name),
        wasCurrent: name === invoiceName,
      };
      undoStackRef.current = [...undoStackRef.current.slice(-19), snapshot];
      setUndoTick((n) => n + 1);

      setPastLogs((prev) => prev.filter((l) => l.invoiceName !== name));
      setPrintLogs((prev) => prev.filter((p) => p.invoiceName !== name));
      setSavedInvoices((prev) => prev.filter((inv) => inv.name !== name));
      delete expressionsByInvoiceRef.current[name];
      storage.set(EXPRESSIONS_KEY, expressionsByInvoiceRef.current);

      if (name === invoiceName) {
        const next = roster.find((inv) => inv.name !== name);
        if (next) setInvoiceName(next.name);
      }
      return { ok: true };
    },
    [getSavedInvoices, getInvoiceExpression, pastLogs, printLogs, invoiceName]
  );

  const undoRemoveInvoice = useCallback((): { ok: true; name: string } | { ok: false } => {
    const snapshot = undoStackRef.current.pop();
    setUndoTick((n) => n + 1);
    if (!snapshot) return { ok: false };

    expressionsByInvoiceRef.current[snapshot.name] = snapshot.expression;
    storage.set(EXPRESSIONS_KEY, expressionsByInvoiceRef.current);
    setPastLogs((prev) => [...prev, ...snapshot.logs]);
    setPrintLogs((prev) => [...prev, ...snapshot.printLogs]);
    setSavedInvoices((prev) => {
      if (prev.some((inv) => inv.name === snapshot.name)) return prev;
      return [
        ...prev.map((inv) => ({ ...inv, isCurrent: false })),
        {
          name: snapshot.name,
          expression: snapshot.expression,
          isCurrent: snapshot.wasCurrent,
        },
      ];
    });
    if (snapshot.wasCurrent) setInvoiceName(snapshot.name);
    return { ok: true, name: snapshot.name };
  }, []);

  const hydrateInvoiceState = useCallback((data: {
    invoiceName: string;
    pastLogs: InvoiceActionLog[];
    printLogs: InvoicePrintLog[];
    savedInvoices?: SavedInvoice[];
  }) => {
    setInvoiceName(data.invoiceName);
    setPastLogs(data.pastLogs);
    setPrintLogs(data.printLogs);
    segmentMetaRef.current.clear();
    if (data.savedInvoices?.length) {
      expressionsByInvoiceRef.current = {
        ...expressionsByInvoiceRef.current,
        ...Object.fromEntries(data.savedInvoices.map((invoice) => [invoice.name, invoice.expression])),
      };
      storage.set(EXPRESSIONS_KEY, expressionsByInvoiceRef.current);
      setSavedInvoices(
        data.savedInvoices.map((inv) => ({
          name: inv.name,
          expression: inv.expression,
          isCurrent: inv.name === data.invoiceName,
        }))
      );
    }
  }, []);

  /** Replace history arrays only (retention trim / Telegram restore). */
  const replaceInvoiceHistory = useCallback(
    (next: { pastLogs: InvoiceActionLog[]; printLogs: InvoicePrintLog[] }) => {
      setPastLogs(next.pastLogs);
      setPrintLogs(next.printLogs);
    },
    []
  );

  return {
    invoiceName,
    setInvoiceName,
    cartItems,
    actionLogs,
    pastLogs,
    runningTotal,
    printLogs,
    saveCurrentInvoiceAndStartNew,
    saveCurrentToPast,
    switchToInvoice,
    clearAllInvoices,
    recordPrint,
    resolveUnidentifiedPrice,
    hydrateInvoiceState,
    replaceInvoiceHistory,
    getInvoiceExpression,
    getSavedInvoices,
    removeInvoice,
    undoRemoveInvoice,
    canUndoRemove,
  };
};
