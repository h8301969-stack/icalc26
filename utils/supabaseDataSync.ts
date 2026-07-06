import {
  HistoryItem,
  InvoiceActionLog,
  InvoicePrintLog,
  POSRequest,
  RestockNote,
  SavedInvoice,
  SupplierRecord,
} from '../types';
import { ActivityLogEntry, InventoryItem, PurchaseRecord } from '../hooks/usePOS';
import { isCloudBackendEnabled, supabase } from './supabase';
import { safeEvaluate } from './calculator';
import { buildPosExpressionFromItems } from './posExpression';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (id: string) => UUID_RE.test(id);

const ensureUuid = (id: string) => (isUuid(id) ? id : crypto.randomUUID());

const formatRelativeTime = (timestamp: number) => {
  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

type DbInventoryRow = {
  id: string;
  name: string;
  stock: number;
  price: number | string;
  threshold: number;
  category: string;
  supplier: string | null;
  image_url: string | null;
  date_added: string;
  last_stocked: string;
};

type DbActivityRow = {
  id: string;
  item_id: string;
  type: ActivityLogEntry['type'];
  action: string;
  profile_name: string | null;
  logged_at: string;
};

const mapActivity = (row: DbActivityRow): ActivityLogEntry => {
  const timestamp = Date.parse(row.logged_at) || Date.now();
  return {
    id: row.id,
    type: row.type,
    action: row.action,
    time: formatRelativeTime(timestamp),
    timestamp,
    profileName: row.profile_name ?? undefined,
  };
};

const mapInventoryItem = (row: DbInventoryRow, activities: DbActivityRow[]): InventoryItem => ({
  id: row.id,
  name: row.name,
  stock: row.stock,
  price: Number(row.price),
  threshold: row.threshold,
  category: row.category,
  supplier: row.supplier ?? '',
  dateAdded: row.date_added,
  lastStocked: row.last_stocked,
  image: row.image_url ?? '',
  activities: activities
    .filter((activity) => activity.item_id === row.id)
    .sort((a, b) => Date.parse(b.logged_at) - Date.parse(a.logged_at))
    .map(mapActivity),
});

export const fetchInventoryFromSupabase = async (
  userId: string
): Promise<InventoryItem[] | null> => {
  if (!isCloudBackendEnabled()) return null;

  const { data: rows, error } = await supabase
    .from('inventory_items')
    .select(
      'id, name, stock, price, threshold, category, supplier, image_url, date_added, last_stocked'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  if (!rows?.length) return null;

  const { data: activities, error: activityError } = await supabase
    .from('inventory_activities')
    .select('id, item_id, type, action, profile_name, logged_at')
    .eq('user_id', userId);

  if (activityError) throw new Error(activityError.message);

  return (rows as DbInventoryRow[]).map((row) =>
    mapInventoryItem(row, (activities ?? []) as DbActivityRow[])
  );
};

export const syncInventoryToSupabase = async (
  userId: string,
  items: InventoryItem[]
): Promise<InventoryItem[]> => {
  if (!isCloudBackendEnabled()) return items;

  const normalizedItems = items.map((item) => ({
    ...item,
    id: ensureUuid(item.id),
    activities: item.activities.map((activity) => ({
      ...activity,
      id: ensureUuid(activity.id),
    })),
  }));

  const inventoryRows = normalizedItems.map((item) => ({
    id: item.id,
    user_id: userId,
    name: item.name,
    stock: item.stock,
    price: item.price,
    threshold: item.threshold,
    category: item.category,
    supplier: item.supplier || null,
    image_url: item.image || null,
    date_added: item.dateAdded,
    last_stocked: item.lastStocked,
  }));

  const { error: inventoryError } = await supabase
    .from('inventory_items')
    .upsert(inventoryRows, { onConflict: 'id' });

  if (inventoryError) throw new Error(inventoryError.message);

  const itemIds = normalizedItems.map((item) => item.id);
  if (itemIds.length > 0) {
    const { error: deleteActivitiesError } = await supabase
      .from('inventory_activities')
      .delete()
      .eq('user_id', userId)
      .in('item_id', itemIds);

    if (deleteActivitiesError) throw new Error(deleteActivitiesError.message);
  }

  const activityRows = normalizedItems.flatMap((item) =>
    item.activities.map((activity) => ({
      id: activity.id,
      user_id: userId,
      item_id: item.id,
      type: activity.type,
      action: activity.action,
      profile_name: activity.profileName ?? null,
      logged_at: new Date(activity.timestamp).toISOString(),
    }))
  );

  if (activityRows.length > 0) {
    const { error: activityError } = await supabase
      .from('inventory_activities')
      .insert(activityRows);

    if (activityError) throw new Error(activityError.message);
  }

  const { data: remoteRows } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('user_id', userId);

  const remoteIds = new Set((remoteRows ?? []).map((row) => row.id as string));
  const localIds = new Set(itemIds);
  const staleIds = [...remoteIds].filter((id) => !localIds.has(id));

  if (staleIds.length > 0) {
    await supabase.from('inventory_items').delete().in('id', staleIds);
  }

  return normalizedItems;
};

export interface InvoiceSyncPayload {
  invoiceName: string;
  expression: string;
  pastLogs: InvoiceActionLog[];
  printLogs: InvoicePrintLog[];
  savedInvoices: SavedInvoice[];
}

export interface InvoiceSyncResult {
  invoiceName: string;
  expression: string;
  pastLogs: InvoiceActionLog[];
  printLogs: InvoicePrintLog[];
  savedInvoices: SavedInvoice[];
}

const expressionFromLogs = (name: string, pastLogs: InvoiceActionLog[]): string => {
  const items = pastLogs
    .filter((log) => log.invoiceName === name)
    .map((log) => ({ price: log.price, quantity: log.quantity }));
  return buildPosExpressionFromItems(items) || '0';
};

const collectSavedInvoices = (payload: InvoiceSyncPayload): SavedInvoice[] => {
  const byName = new Map<string, SavedInvoice>();
  for (const invoice of payload.savedInvoices) {
    byName.set(invoice.name, invoice);
  }
  byName.set(payload.invoiceName, {
    name: payload.invoiceName,
    expression: payload.expression,
    isCurrent: true,
  });
  for (const log of payload.pastLogs) {
    if (!byName.has(log.invoiceName)) {
      byName.set(log.invoiceName, {
        name: log.invoiceName,
        expression: expressionFromLogs(log.invoiceName, payload.pastLogs),
        isCurrent: false,
      });
    }
  }
  return [...byName.values()].map((invoice) => ({
    ...invoice,
    isCurrent: invoice.name === payload.invoiceName,
  }));
};

export const fetchInvoiceDataFromSupabase = async (
  userId: string
): Promise<InvoiceSyncResult | null> => {
  if (!isCloudBackendEnabled()) return null;

  const { data: invoiceRows, error: invoiceError } = await supabase
    .from('invoices')
    .select('name, expression, is_current')
    .eq('user_id', userId)
    .order('updated_at', { ascending: true });

  if (invoiceError) throw new Error(invoiceError.message);

  const currentInvoice =
    (invoiceRows ?? []).find((row) => row.is_current) ?? (invoiceRows ?? [])[0] ?? null;

  const { data: actionRows, error: actionError } = await supabase
    .from('invoice_action_logs')
    .select(
      'id, invoice_name, message, item_name, price, quantity, is_unidentified, profile_name, logged_at'
    )
    .eq('user_id', userId)
    .order('logged_at', { ascending: true });

  if (actionError) throw new Error(actionError.message);

  const { data: printRows, error: printError } = await supabase
    .from('invoice_print_logs')
    .select('id, invoice_name, total, items, printed_at')
    .eq('user_id', userId)
    .order('printed_at', { ascending: true });

  if (printError) throw new Error(printError.message);

  const hasRemoteData =
    (invoiceRows?.length ?? 0) > 0 ||
    (actionRows?.length ?? 0) > 0 ||
    (printRows?.length ?? 0) > 0;

  if (!hasRemoteData) return null;

  const savedInvoices: SavedInvoice[] = (invoiceRows ?? []).map((row) => ({
    name: row.name as string,
    expression: (row.expression as string) ?? '0',
    isCurrent: !!row.is_current,
  }));

  return {
    invoiceName: currentInvoice?.name ?? 'Invoice #1',
    expression: (currentInvoice?.expression as string) ?? '0',
    savedInvoices,
    pastLogs: (actionRows ?? []).map((row) => ({
      id: row.id as string,
      message: row.message as string,
      itemName: (row.item_name as string | null) ?? undefined,
      price: Number(row.price),
      quantity: Number(row.quantity),
      invoiceName: row.invoice_name as string,
      timestamp: Date.parse(row.logged_at as string) || Date.now(),
      isUnidentified: !!row.is_unidentified,
      profileName: (row.profile_name as string | null) ?? undefined,
    })),
    printLogs: (printRows ?? []).map((row) => ({
      id: row.id as string,
      invoiceName: row.invoice_name as string,
      timestamp: Date.parse(row.printed_at as string) || Date.now(),
      total: row.total as string,
      items: (row.items as InvoicePrintLog['items']) ?? [],
    })),
  };
};

export const syncInvoiceDataToSupabase = async (
  userId: string,
  payload: InvoiceSyncPayload
): Promise<void> => {
  if (!isCloudBackendEnabled()) return;

  const savedInvoices = collectSavedInvoices(payload);
  const { data: existingRows } = await supabase
    .from('invoices')
    .select('id, name')
    .eq('user_id', userId);

  const existingByName = new Map(
    (existingRows ?? []).map((row) => [row.name as string, row.id as string])
  );

  const invoiceUpserts = savedInvoices.map((invoice) => ({
    id: existingByName.get(invoice.name) ?? crypto.randomUUID(),
    user_id: userId,
    name: invoice.name,
    expression: invoice.expression,
    is_current: invoice.isCurrent,
    total: Number(safeEvaluate(invoice.expression)) || 0,
  }));

  const { error: invoiceError } = await supabase
    .from('invoices')
    .upsert(invoiceUpserts, { onConflict: 'user_id,name' });

  if (invoiceError) throw new Error(invoiceError.message);

  const localNames = new Set(savedInvoices.map((invoice) => invoice.name));
  const staleInvoiceIds = (existingRows ?? [])
    .filter((row) => !localNames.has(row.name as string))
    .map((row) => row.id as string);

  if (staleInvoiceIds.length > 0) {
    await supabase.from('invoices').delete().in('id', staleInvoiceIds);
  }

  const { error: deleteLogsError } = await supabase
    .from('invoice_action_logs')
    .delete()
    .eq('user_id', userId);

  if (deleteLogsError) throw new Error(deleteLogsError.message);

  if (payload.pastLogs.length > 0) {
    const logRows = payload.pastLogs.map((log) => ({
      id: ensureUuid(log.id),
      user_id: userId,
      invoice_name: log.invoiceName,
      message: log.message,
      item_name: log.itemName ?? null,
      price: log.price,
      quantity: log.quantity,
      is_unidentified: !!log.isUnidentified,
      profile_name: log.profileName ?? null,
      logged_at: new Date(log.timestamp).toISOString(),
    }));

    const { error: insertLogsError } = await supabase
      .from('invoice_action_logs')
      .insert(logRows);

    if (insertLogsError) throw new Error(insertLogsError.message);
  }

  const { error: deletePrintError } = await supabase
    .from('invoice_print_logs')
    .delete()
    .eq('user_id', userId);

  if (deletePrintError) throw new Error(deletePrintError.message);

  if (payload.printLogs.length > 0) {
    const printRows = payload.printLogs.map((log) => ({
      id: ensureUuid(log.id),
      user_id: userId,
      invoice_name: log.invoiceName,
      total: log.total,
      items: log.items,
      printed_at: new Date(log.timestamp).toISOString(),
    }));

    const { error: insertPrintError } = await supabase
      .from('invoice_print_logs')
      .insert(printRows);

    if (insertPrintError) throw new Error(insertPrintError.message);
  }
};

export const fetchCalcHistoryFromSupabase = async (
  userId: string
): Promise<HistoryItem[] | null> => {
  if (!isCloudBackendEnabled()) return null;

  const { data, error } = await supabase
    .from('calc_history')
    .select('id, expression, result, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  if (!data?.length) return null;

  return data.map((row) => ({
    id: row.id as string,
    expression: row.expression as string,
    result: row.result as string,
    timestamp: Date.parse(row.created_at as string) || Date.now(),
  }));
};

export const syncCalcHistoryToSupabase = async (
  userId: string,
  history: HistoryItem[]
): Promise<HistoryItem[]> => {
  if (!isCloudBackendEnabled()) return history;

  const normalized = history.slice(0, 50).map((item) => ({
    ...item,
    id: ensureUuid(item.id),
  }));

  await supabase.from('calc_history').delete().eq('user_id', userId);

  if (normalized.length > 0) {
    const rows = normalized.map((item) => ({
      id: item.id,
      user_id: userId,
      expression: item.expression,
      result: item.result,
      created_at: new Date(item.timestamp).toISOString(),
    }));

    const { error } = await supabase.from('calc_history').insert(rows);
    if (error) throw new Error(error.message);
  }

  return normalized;
};

export const fetchPurchasesFromSupabase = async (
  userId: string
): Promise<PurchaseRecord[] | null> => {
  if (!isCloudBackendEnabled()) return null;

  const { data, error } = await supabase
    .from('purchases')
    .select('id, item_name, quantity, price, total, purchased_at')
    .eq('user_id', userId)
    .order('purchased_at', { ascending: false });

  if (error) throw new Error(error.message);
  if (!data?.length) return null;

  return data.map((row) => {
    const timestamp = Date.parse(row.purchased_at as string) || Date.now();
    return {
      id: row.id as string,
      itemName: row.item_name as string,
      quantity: Number(row.quantity),
      price: Number(row.price),
      total: Number(row.total),
      date: new Date(timestamp).toLocaleDateString(),
      timestamp,
    };
  });
};

export const syncPurchasesToSupabase = async (
  userId: string,
  purchases: PurchaseRecord[]
): Promise<PurchaseRecord[]> => {
  if (!isCloudBackendEnabled()) return purchases;

  const normalized = purchases.map((purchase) => ({
    ...purchase,
    id: ensureUuid(purchase.id),
  }));

  await supabase.from('purchases').delete().eq('user_id', userId);

  if (normalized.length > 0) {
    const rows = normalized.map((purchase) => ({
      id: purchase.id,
      user_id: userId,
      item_name: purchase.itemName,
      quantity: purchase.quantity,
      price: purchase.price,
      total: purchase.total,
      purchased_at: new Date(purchase.timestamp).toISOString(),
    }));

    const { error } = await supabase.from('purchases').insert(rows);
    if (error) throw new Error(error.message);
  }

  return normalized;
};

export const fetchSuppliersFromSupabase = async (
  userId: string
): Promise<SupplierRecord[] | null> => {
  if (!isCloudBackendEnabled()) return null;

  const { data: suppliers, error } = await supabase
    .from('suppliers')
    .select('id, name, last_received_at, total_items_received')
    .eq('user_id', userId)
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  if (!suppliers?.length) return null;

  const supplierIds = suppliers.map((row) => row.id as string);
  const { data: products, error: productError } = await supabase
    .from('supplier_products')
    .select('supplier_id, product_id')
    .in('supplier_id', supplierIds);

  if (productError) throw new Error(productError.message);

  return suppliers.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    lastReceivedAt: row.last_received_at
      ? Date.parse(row.last_received_at as string)
      : Date.now(),
    totalItemsReceived: Number(row.total_items_received),
    productIds: (products ?? [])
      .filter((product) => product.supplier_id === row.id)
      .map((product) => product.product_id as string),
  }));
};

export const syncSuppliersToSupabase = async (
  userId: string,
  suppliers: SupplierRecord[]
): Promise<SupplierRecord[]> => {
  if (!isCloudBackendEnabled()) return suppliers;

  const normalized = suppliers.map((supplier) => ({
    ...supplier,
    id: ensureUuid(supplier.id),
    productIds: supplier.productIds.map((id) => ensureUuid(id)),
  }));

  const supplierRows = normalized.map((supplier) => ({
    id: supplier.id,
    user_id: userId,
    name: supplier.name,
    last_received_at: new Date(supplier.lastReceivedAt).toISOString(),
    total_items_received: supplier.totalItemsReceived,
  }));

  const { error: supplierError } = await supabase
    .from('suppliers')
    .upsert(supplierRows, { onConflict: 'user_id,name' });

  if (supplierError) throw new Error(supplierError.message);

  const supplierIds = normalized.map((supplier) => supplier.id);
  if (supplierIds.length > 0) {
    await supabase.from('supplier_products').delete().in('supplier_id', supplierIds);
  }

  const productRows = normalized.flatMap((supplier) =>
    supplier.productIds.map((productId) => ({
      supplier_id: supplier.id,
      product_id: productId,
    }))
  );

  if (productRows.length > 0) {
    const { error: productError } = await supabase.from('supplier_products').insert(productRows);
    if (productError) throw new Error(productError.message);
  }

  const { data: remoteRows } = await supabase
    .from('suppliers')
    .select('id')
    .eq('user_id', userId);

  const localIds = new Set(supplierIds);
  const staleIds = [...(remoteRows ?? []).map((row) => row.id as string)].filter(
    (id) => !localIds.has(id)
  );

  if (staleIds.length > 0) {
    await supabase.from('suppliers').delete().in('id', staleIds);
  }

  return normalized;
};

export const fetchRequestsFromSupabase = async (
  userId: string
): Promise<POSRequest[] | null> => {
  if (!isCloudBackendEnabled()) return null;

  const { data, error } = await supabase
    .from('requests')
    .select('id, requester, notes, status, item_count, total, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  if (!data?.length) return null;

  return data.map((row) => ({
    id: row.id as string,
    requester: row.requester as string,
    notes: (row.notes as string | null) ?? '',
    status: row.status as POSRequest['status'],
    itemCount: Number(row.item_count),
    total: Number(row.total),
    timestamp: Date.parse(row.created_at as string) || Date.now(),
  }));
};

export const syncRequestsToSupabase = async (
  userId: string,
  requests: POSRequest[]
): Promise<POSRequest[]> => {
  if (!isCloudBackendEnabled()) return requests;

  const normalized = requests.map((request) => ({
    ...request,
    id: ensureUuid(request.id),
  }));

  await supabase.from('requests').delete().eq('user_id', userId);

  if (normalized.length > 0) {
    const rows = normalized.map((request) => ({
      id: request.id,
      user_id: userId,
      requester: request.requester,
      notes: request.notes || null,
      status: request.status,
      item_count: request.itemCount,
      total: request.total,
      created_at: new Date(request.timestamp).toISOString(),
      updated_at: new Date(request.timestamp).toISOString(),
    }));

    const { error } = await supabase.from('requests').insert(rows);
    if (error) throw new Error(error.message);
  }

  return normalized;
};

export const fetchRestocksFromSupabase = async (
  userId: string
): Promise<RestockNote[] | null> => {
  if (!isCloudBackendEnabled()) return null;

  const { data: notes, error } = await supabase
    .from('restock_notes')
    .select('id, title, notes, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  if (!notes?.length) return null;

  const noteIds = notes.map((row) => row.id as string);
  const { data: lines, error: lineError } = await supabase
    .from('restock_line_items')
    .select('id, restock_note_id, item_id, name, qty')
    .in('restock_note_id', noteIds);

  if (lineError) throw new Error(lineError.message);

  return notes.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    notes: (row.notes as string | null) ?? '',
    timestamp: Date.parse(row.created_at as string) || Date.now(),
    lineItems: (lines ?? [])
      .filter((line) => line.restock_note_id === row.id)
      .map((line) => ({
        itemId: (line.item_id as string | null) ?? line.id,
        name: line.name as string,
        qty: Number(line.qty),
      })),
  }));
};

export const syncRestocksToSupabase = async (
  userId: string,
  restocks: RestockNote[]
): Promise<RestockNote[]> => {
  if (!isCloudBackendEnabled()) return restocks;

  const normalized = restocks.map((note) => ({
    ...note,
    id: ensureUuid(note.id),
    lineItems: note.lineItems.map((line) => ({
      ...line,
      itemId: isUuid(line.itemId) ? line.itemId : '',
    })),
  }));

  await supabase.from('restock_notes').delete().eq('user_id', userId);

  if (normalized.length === 0) return normalized;

  const noteRows = normalized.map((note) => ({
    id: note.id,
    user_id: userId,
    title: note.title,
    notes: note.notes || null,
    created_at: new Date(note.timestamp).toISOString(),
    updated_at: new Date(note.timestamp).toISOString(),
  }));

  const { error: noteError } = await supabase.from('restock_notes').insert(noteRows);
  if (noteError) throw new Error(noteError.message);

  const lineRows = normalized.flatMap((note) =>
    note.lineItems.map((line) => ({
      id: crypto.randomUUID(),
      restock_note_id: note.id,
      item_id: line.itemId && isUuid(line.itemId) ? line.itemId : null,
      name: line.name,
      qty: line.qty,
    }))
  );

  if (lineRows.length > 0) {
    const { error: lineError } = await supabase.from('restock_line_items').insert(lineRows);
    if (lineError) throw new Error(lineError.message);
  }

  return normalized;
};