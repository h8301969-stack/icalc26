import { useEffect, useState } from 'react';
import { POSRequest, RestockNote, SupplierRecord } from '../types';
import { storage } from './storage';

const SUPPLIERS_KEY = 'pos_suppliers';
const REQUESTS_KEY = 'pos_requests';
const RESTOCKS_KEY = 'pos_restock_notes';

export const usePOSDashboardData = () => {
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>(() =>
    storage.get(SUPPLIERS_KEY, [])
  );
  const [requests, setRequests] = useState<POSRequest[]>(() => storage.get(REQUESTS_KEY, []));
  const [restocks, setRestocks] = useState<RestockNote[]>(() => storage.get(RESTOCKS_KEY, []));

  useEffect(() => {
    storage.set(SUPPLIERS_KEY, suppliers);
  }, [suppliers]);

  useEffect(() => {
    storage.set(REQUESTS_KEY, requests);
  }, [requests]);

  useEffect(() => {
    storage.set(RESTOCKS_KEY, restocks);
  }, [restocks]);

  const hydrateDashboardData = (data: {
    suppliers?: SupplierRecord[];
    requests?: POSRequest[];
    restocks?: RestockNote[];
  }) => {
    if (data.suppliers) setSuppliers(data.suppliers);
    if (data.requests) setRequests(data.requests);
    if (data.restocks) setRestocks(data.restocks);
  };

  return {
    suppliers,
    setSuppliers,
    requests,
    setRequests,
    restocks,
    setRestocks,
    hydrateDashboardData,
  };
};