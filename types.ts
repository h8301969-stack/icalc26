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
}

export interface UserProfile {
  id: string;
  name: string;
  avatarUrl: string;
}