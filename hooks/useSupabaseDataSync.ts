import { useEffect, useRef } from 'react';
import { HistoryItem, InvoiceActionLog, InvoicePrintLog, POSRequest, RestockNote, SavedInvoice, SupplierRecord } from '../types';
import { InventoryItem, PurchaseRecord } from './usePOS';
import { isCloudBackendEnabled } from '../utils/supabase';

import { FRESH_INVOICE_NAME } from '../utils/freshAppSession';
import {
  fetchCalcHistoryFromSupabase,
  fetchInventoryFromSupabase,
  fetchInvoiceDataFromSupabase,
  fetchPurchasesFromSupabase,
  fetchRequestsFromSupabase,
  fetchRestocksFromSupabase,
  fetchSuppliersFromSupabase,
  syncCalcHistoryToSupabase,
  syncInventoryToSupabase,
  syncInvoiceDataToSupabase,
  syncPurchasesToSupabase,
  syncRequestsToSupabase,
  syncRestocksToSupabase,
  syncSuppliersToSupabase,
} from '../utils/supabaseDataSync';

const SYNC_DEBOUNCE_MS = 1200;

interface UseSupabaseDataSyncOptions {
  userId: string | null;
  authReady: boolean;
  history: HistoryItem[];
  setHistory: React.Dispatch<React.SetStateAction<HistoryItem[]>>;
  inventory: InventoryItem[];
  setInventory: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  purchases: PurchaseRecord[];
  setPurchases: React.Dispatch<React.SetStateAction<PurchaseRecord[]>>;
  suppliers: SupplierRecord[];
  setSuppliers: React.Dispatch<React.SetStateAction<SupplierRecord[]>>;
  requests: POSRequest[];
  setRequests: React.Dispatch<React.SetStateAction<POSRequest[]>>;
  restocks: RestockNote[];
  setRestocks: React.Dispatch<React.SetStateAction<RestockNote[]>>;
  invoiceName: string;
  expression: string;
  pastLogs: InvoiceActionLog[];
  printLogs: InvoicePrintLog[];
  getSavedInvoices: () => SavedInvoice[];
  onInvoiceHydrated: (data: {
    invoiceName: string;
    expression: string;
    pastLogs: InvoiceActionLog[];
    printLogs: InvoicePrintLog[];
    savedInvoices: SavedInvoice[];
  }) => void;
}

export const useSupabaseDataSync = ({
  userId,
  authReady,
  history,
  setHistory,
  inventory,
  setInventory,
  purchases,
  setPurchases,
  suppliers,
  setSuppliers,
  requests,
  setRequests,
  restocks,
  setRestocks,
  invoiceName,
  expression,
  pastLogs,
  printLogs,
  getSavedInvoices,
  onInvoiceHydrated,
}: UseSupabaseDataSyncOptions) => {
  const hydratedRef = useRef(false);
  const hydratingRef = useRef(false);
  const inventorySyncTimerRef = useRef<number | null>(null);
  const invoiceSyncTimerRef = useRef<number | null>(null);
  const historySyncTimerRef = useRef<number | null>(null);
  const purchasesSyncTimerRef = useRef<number | null>(null);
  const dashboardSyncTimerRef = useRef<number | null>(null);

  const historyRef = useRef(history);
  const inventoryRef = useRef(inventory);
  const purchasesRef = useRef(purchases);
  const suppliersRef = useRef(suppliers);
  const requestsRef = useRef(requests);
  const restocksRef = useRef(restocks);
  const invoiceRef = useRef({ invoiceName, expression, pastLogs, printLogs, getSavedInvoices });
  const onInvoiceHydratedRef = useRef(onInvoiceHydrated);
  onInvoiceHydratedRef.current = onInvoiceHydrated;

  historyRef.current = history;
  inventoryRef.current = inventory;
  purchasesRef.current = purchases;
  suppliersRef.current = suppliers;
  requestsRef.current = requests;
  restocksRef.current = restocks;
  invoiceRef.current = { invoiceName, expression, pastLogs, printLogs, getSavedInvoices };

  useEffect(() => {
    hydratedRef.current = false;
    hydratingRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (!authReady || !userId || !isCloudBackendEnabled()) return;
    if (hydratedRef.current || hydratingRef.current) return;

    let cancelled = false;

    const hydrate = async () => {
      hydratingRef.current = true;

      try {
        const [
          remoteInventory,
          remoteInvoice,
          remoteHistory,
          remotePurchases,
          remoteSuppliers,
          remoteRequests,
          remoteRestocks,
        ] = await Promise.all([
          fetchInventoryFromSupabase(userId),
          fetchInvoiceDataFromSupabase(userId),
          fetchCalcHistoryFromSupabase(userId),
          fetchPurchasesFromSupabase(userId),
          fetchSuppliersFromSupabase(userId),
          fetchRequestsFromSupabase(userId),
          fetchRestocksFromSupabase(userId),
        ]);

        if (cancelled) return;

        if (remoteInventory?.length) {
          const localById = new Map(inventoryRef.current.map((item) => [item.id, item]));
          setInventory(
            remoteInventory.map((remote) => {
              const local = localById.get(remote.id);
              const image = local?.image || remote.image || '';
              return { ...remote, image };
            })
          );
        } else if (!cancelled) {
          setInventory([]);
        }

        if (remoteHistory?.length) {
          setHistory(remoteHistory);
        } else if (!cancelled) {
          setHistory([]);
        }

        if (remotePurchases?.length) {
          setPurchases(remotePurchases);
        } else if (!cancelled) {
          setPurchases([]);
        }

        if (remoteSuppliers?.length) {
          setSuppliers(remoteSuppliers);
        } else if (!cancelled) {
          setSuppliers([]);
        }

        if (remoteRequests?.length) {
          setRequests(remoteRequests);
        } else if (!cancelled) {
          setRequests([]);
        }

        if (remoteRestocks?.length) {
          setRestocks(remoteRestocks);
        } else if (!cancelled) {
          setRestocks([]);
        }

        if (remoteInvoice) {
          onInvoiceHydratedRef.current(remoteInvoice);
        } else if (!cancelled) {
          onInvoiceHydratedRef.current({
            invoiceName: FRESH_INVOICE_NAME,
            expression: '0',
            pastLogs: [],
            printLogs: [],
            savedInvoices: [{ name: FRESH_INVOICE_NAME, expression: '0', isCurrent: true }],
          });
        }
      } catch (error) {
        console.error('[iCalc sync] hydrate failed', error);
      } finally {
        hydratingRef.current = false;
        hydratedRef.current = true;
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [authReady, userId, setHistory, setInventory, setPurchases, setSuppliers, setRequests, setRestocks]);

  useEffect(() => {
    if (!authReady || !userId || !isCloudBackendEnabled() || !hydratedRef.current || hydratingRef.current) return;

    if (inventorySyncTimerRef.current) window.clearTimeout(inventorySyncTimerRef.current);
    inventorySyncTimerRef.current = window.setTimeout(() => {
      void syncInventoryToSupabase(userId, inventoryRef.current)
        .then((synced) => {
          setInventory((prev) => (JSON.stringify(prev) === JSON.stringify(synced) ? prev : synced));
        })
        .catch((error) => console.error('[iCalc sync] inventory save failed', error));
    }, SYNC_DEBOUNCE_MS);

    return () => {
      if (inventorySyncTimerRef.current) window.clearTimeout(inventorySyncTimerRef.current);
    };
  }, [authReady, userId, inventory, setInventory]);

  useEffect(() => {
    if (!authReady || !userId || !isCloudBackendEnabled() || !hydratedRef.current || hydratingRef.current) return;

    if (historySyncTimerRef.current) window.clearTimeout(historySyncTimerRef.current);
    historySyncTimerRef.current = window.setTimeout(() => {
      void syncCalcHistoryToSupabase(userId, historyRef.current)
        .then((synced) => {
          setHistory((prev) => (JSON.stringify(prev) === JSON.stringify(synced) ? prev : synced));
        })
        .catch((error) => console.error('[iCalc sync] history save failed', error));
    }, SYNC_DEBOUNCE_MS);

    return () => {
      if (historySyncTimerRef.current) window.clearTimeout(historySyncTimerRef.current);
    };
  }, [authReady, userId, history, setHistory]);

  useEffect(() => {
    if (!authReady || !userId || !isCloudBackendEnabled() || !hydratedRef.current || hydratingRef.current) return;

    if (purchasesSyncTimerRef.current) window.clearTimeout(purchasesSyncTimerRef.current);
    purchasesSyncTimerRef.current = window.setTimeout(() => {
      void syncPurchasesToSupabase(userId, purchasesRef.current)
        .then((synced) => {
          setPurchases((prev) => (JSON.stringify(prev) === JSON.stringify(synced) ? prev : synced));
        })
        .catch((error) => console.error('[iCalc sync] purchases save failed', error));
    }, SYNC_DEBOUNCE_MS);

    return () => {
      if (purchasesSyncTimerRef.current) window.clearTimeout(purchasesSyncTimerRef.current);
    };
  }, [authReady, userId, purchases, setPurchases]);

  useEffect(() => {
    if (!authReady || !userId || !isCloudBackendEnabled() || !hydratedRef.current || hydratingRef.current) return;

    if (dashboardSyncTimerRef.current) window.clearTimeout(dashboardSyncTimerRef.current);
    dashboardSyncTimerRef.current = window.setTimeout(() => {
      void syncSuppliersToSupabase(userId, suppliersRef.current)
        .then((synced) => {
          setSuppliers((prev) => (JSON.stringify(prev) === JSON.stringify(synced) ? prev : synced));
        })
        .catch((error) => console.error('[iCalc sync] suppliers save failed', error));

      void syncRequestsToSupabase(userId, requestsRef.current)
        .then((synced) => {
          setRequests((prev) => (JSON.stringify(prev) === JSON.stringify(synced) ? prev : synced));
        })
        .catch((error) => console.error('[iCalc sync] requests save failed', error));

      void syncRestocksToSupabase(userId, restocksRef.current)
        .then((synced) => {
          setRestocks((prev) => (JSON.stringify(prev) === JSON.stringify(synced) ? prev : synced));
        })
        .catch((error) => console.error('[iCalc sync] restocks save failed', error));
    }, SYNC_DEBOUNCE_MS);

    return () => {
      if (dashboardSyncTimerRef.current) window.clearTimeout(dashboardSyncTimerRef.current);
    };
  }, [authReady, userId, suppliers, requests, restocks, setSuppliers, setRequests, setRestocks]);

  useEffect(() => {
    if (!authReady || !userId || !isCloudBackendEnabled() || !hydratedRef.current || hydratingRef.current) return;

    if (invoiceSyncTimerRef.current) window.clearTimeout(invoiceSyncTimerRef.current);
    invoiceSyncTimerRef.current = window.setTimeout(() => {
      void syncInvoiceDataToSupabase(userId, {
        ...invoiceRef.current,
        savedInvoices: invoiceRef.current.getSavedInvoices(),
      }).catch((error) => console.error('[iCalc sync] invoice save failed', error));
    }, SYNC_DEBOUNCE_MS);

    return () => {
      if (invoiceSyncTimerRef.current) window.clearTimeout(invoiceSyncTimerRef.current);
    };
  }, [authReady, userId, invoiceName, expression, pastLogs, printLogs, getSavedInvoices]);
};