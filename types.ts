export type Operation = '+' | '-' | '*' | '/' | '%' | null;

export interface HistoryItem {
  id: string;
  expression: string;
  result: string;
  timestamp: number;
}

export interface InvoiceActionLog {
  id: string;
  message: string;
  itemName?: string;
  price: number;
  quantity: number;
  invoiceName: string;
  timestamp: number;
  isUnidentified?: boolean;
  profileName?: string;
}

export interface CartLineItem {
  price: number;
  quantity: number;
  name?: string;
}

export interface InvoicePrintLog {
  id: string;
  invoiceName: string;
  timestamp: number;
  total: string;
  items: CartLineItem[];
}

export type ProfileSellerType = 'wholesaler' | 'retailer';

export interface UserProfile {
  id: string;
  name: string;
  avatarUrl: string;
  email?: string;
  phone?: string;
  sellerType?: ProfileSellerType;
  isSystem?: boolean;
}

export interface NewProfileInput {
  name: string;
  avatarUrl: string;
  email: string;
  phone: string;
  sellerType: ProfileSellerType;
}

export type RequestStatus = 'pending' | 'delivered' | 'outofstock';

export interface POSRequest {
  id: string;
  requester: string;
  notes: string;
  status: RequestStatus;
  timestamp: number;
  itemCount: number;
  total: number;
}

export interface RestockLineItem {
  itemId: string;
  name: string;
  qty: number;
}

export interface RestockNote {
  id: string;
  title: string;
  notes: string;
  timestamp: number;
  lineItems: RestockLineItem[];
}

export interface SupplierRecord {
  id: string;
  name: string;
  lastReceivedAt: number;
  totalItemsReceived: number;
  productIds: string[];
}

export interface SavedInvoice {
  name: string;
  expression: string;
  isCurrent: boolean;
  deletedAt?: number;
}

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastError?: string;
  lastSyncTime?: number;
  failedItems: Map<string, { count: number; nextRetryAt: number }>;
}

export interface AuditLogEntry {
  id: string;
  entityType: 'inventory' | 'invoice' | 'purchase' | 'supplier' | 'request' | 'restock';
  entityId: string;
  action: 'create' | 'update' | 'delete' | 'restore';
  profileName?: string;
  timestamp: number;
  details?: Record<string, any>;
}