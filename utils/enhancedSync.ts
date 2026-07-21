import { InventoryItem, PurchaseRecord } from '../hooks/usePOS';
import { SavedInvoice, SupplierRecord, POSRequest, RestockNote, InvoiceActionLog, InvoicePrintLog } from '../types';
import { logAuditEntry } from './auditLog';
import { supabase, isCloudBackendEnabled } from './supabase';

const CONFLICT_RESOLUTION_POLICY = 'last-write-wins' as const;

export interface SyncConflict {
  entityId: string;
  entityType: string;
  clientUpdatedAt: number;
  serverUpdatedAt: number;
  resolved: boolean;
}

export const handleSoftDelete = async (
  userId: string,
  entityType: string,
  entityId: string,
  profileName?: string
): Promise<void> => {
  if (!isCloudBackendEnabled()) return;

  const now = new Date().toISOString();
  const tableMap: Record<string, string> = {
    inventory: 'inventory_items',
    invoice: 'invoices',
    purchase: 'purchases',
    supplier: 'suppliers',
    request: 'pos_requests',
    restock: 'restock_notes',
  };

  const tableName = tableMap[entityType];
  if (!tableName) return;

  const { error } = await supabase
    .from(tableName)
    .update({ deleted_at: now, updated_at: now })
    .eq('id', entityId)
    .eq('user_id', userId);

  if (error) throw new Error(error.message);

  await logAuditEntry(userId, {
    entityType: entityType as any,
    entityId,
    action: 'delete',
    profileName,
    timestamp: Date.now(),
  });
};

export const handleSoftRestore = async (
  userId: string,
  entityType: string,
  entityId: string,
  profileName?: string
): Promise<void> => {
  if (!isCloudBackendEnabled()) return;

  const now = new Date().toISOString();
  const tableMap: Record<string, string> = {
    inventory: 'inventory_items',
    invoice: 'invoices',
    purchase: 'purchases',
    supplier: 'suppliers',
    request: 'pos_requests',
    restock: 'restock_notes',
  };

  const tableName = tableMap[entityType];
  if (!tableName) return;

  const { error } = await supabase
    .from(tableName)
    .update({ deleted_at: null, updated_at: now })
    .eq('id', entityId)
    .eq('user_id', userId);

  if (error) throw new Error(error.message);

  await logAuditEntry(userId, {
    entityType: entityType as any,
    entityId,
    action: 'restore',
    profileName,
    timestamp: Date.now(),
  });
};

export const fetchDeletedItems = async (
  userId: string,
  entityType: string
): Promise<any[]> => {
  if (!isCloudBackendEnabled()) return [];

  const tableMap: Record<string, string> = {
    inventory: 'inventory_items',
    invoice: 'invoices',
    purchase: 'purchases',
    supplier: 'suppliers',
    request: 'pos_requests',
    restock: 'restock_notes',
  };

  const tableName = tableMap[entityType];
  if (!tableName) return [];

  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  if (error) {
    console.error(`[iCalc] Failed to fetch deleted ${entityType}:`, error);
    return [];
  }

  return data || [];
};

export const checkConflicts = async (
  userId: string,
  entityType: string,
  items: Array<{ id: string; updatedAt?: number }>
): Promise<SyncConflict[]> => {
  if (!isCloudBackendEnabled() || !items.length) return [];

  const tableMap: Record<string, string> = {
    inventory: 'inventory_items',
    invoice: 'invoices',
    purchase: 'purchases',
  };

  const tableName = tableMap[entityType];
  if (!tableName) return [];

  const { data: remoteItems, error } = await supabase
    .from(tableName)
    .select('id, updated_at')
    .eq('user_id', userId)
    .in('id', items.map(i => i.id));

  if (error) {
    console.error('[iCalc] Failed to check conflicts:', error);
    return [];
  }

  const conflicts: SyncConflict[] = [];
  const remoteMap = new Map((remoteItems || []).map(r => [r.id, r.updated_at]));

  for (const item of items) {
    const remoteUpdatedAt = remoteMap.get(item.id);
    if (remoteUpdatedAt && item.updatedAt && item.updatedAt < Date.parse(remoteUpdatedAt)) {
      conflicts.push({
        entityId: item.id,
        entityType,
        clientUpdatedAt: item.updatedAt,
        serverUpdatedAt: Date.parse(remoteUpdatedAt),
        resolved: CONFLICT_RESOLUTION_POLICY === 'last-write-wins' && item.updatedAt > Date.parse(remoteUpdatedAt),
      });
    }
  }

  return conflicts;
};

export const logSyncAction = async (
  userId: string,
  entityType: string,
  entityId: string,
  action: 'create' | 'update' | 'delete',
  profileName?: string,
  details?: Record<string, any>
): Promise<void> => {
  await logAuditEntry(userId, {
    entityType: entityType as any,
    entityId,
    action,
    profileName,
    timestamp: Date.now(),
    details,
  });
};
