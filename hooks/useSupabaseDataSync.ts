import { useEffect, useRef } from 'react';
import { HistoryItem, InvoiceActionLog, InvoicePrintLog, POSRequest, RestockNote, SavedInvoice, SupplierRecord } from '../types';
import { InventoryItem, PurchaseRecord } from './usePOS';
import { isCloudBackendEnabled } from '../utils/supabase';
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
          setInventory(remoteInventory);
        } else if (inventoryRef.current.length > 0) {
          const synced = await syncInventoryToSupabase(userId, inventoryRef.current);
          if (!cancelled) setInventory(synced);
        }

        if (remoteHistory?.length) {
          setHistory(remoteHistory);
        } else if (historyRef.current.length > 0) {
          const synced = await syncCalcHistoryToSupabase(userId, historyRef.current);
          if (!cancelled) setHistory(synced);
        }

        if (remotePurchases?.length) {
          setPurchases(remotePurchases);
        } else if (purchasesRef.current.length > 0) {
          const synced = await syncPurchasesToSupabase(userId, purchasesRef.current);
          if (!cancelled) setPurchases(synced);
        }

        if (remoteSuppliers?.length) {
          setSuppliers(remoteSuppliers);
        } else if (suppliersRef.current.length > 0) {
          const synced = await syncSuppliersToSupabase(userId, suppliersRef.current);
          if (!cancelled) setSuppliers(synced);
        }

        if (remoteRequests?.length) {
          setRequests(remoteRequests);
        } else if (requestsRef.current.length > 0) {
          const synced = await syncRequestsToSupabase(userId, requestsRef.current);
          if (!cancelled) setRequests(synced);
        }

        if (remoteRestocks?.length) {
          setRestocks(remoteRestocks);
        } else if (restocksRef.current.length > 0) {
          const synced = await syncRestocksToSupabase(userId, restocksRef.current);
          if (!cancelled) setRestocks(synced);
        }

        if (remoteInvoice) {
          onInvoiceHydrated(remoteInvoice);
        } else {
          await syncInvoiceDataToSupabase(userId, {
            invoiceName: invoiceRef.current.invoiceName,
            expression: invoiceRef.current.expression,
            pastLogs: invoiceRef.current.pastLogs,
            printLogs: invoiceRef.current.printLogs,
            savedInvoices: invoiceRef.current.getSavedInvoices(),
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
  }, [
    authReady,
    userId,
    onInvoiceHydrated,
    setHistory,
    setInventory,
    setPurchases,
    setSuppliers,
    setRequests,
    setRestocks,
  ]);

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