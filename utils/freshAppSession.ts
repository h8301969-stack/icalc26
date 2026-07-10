import { storage } from '../hooks/storage';

/** Supabase auth user ids are UUIDs; local dev guest uses a fixed string id. */
export const isCloudUserAccount = (accountId: string): boolean =>
  accountId !== 'account-dev-guest' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId);

export const FRESH_INVOICE_NAME = 'Invoice #1';

/** Wipe POS / calculator / invoice local data (not auth or theme settings). */
export const clearAppSessionData = (): void => {
  storage.set('pos_inventory', []);
  storage.set('pos_purchases', []);
  storage.set('pos_suppliers', []);
  storage.set('pos_requests', []);
  storage.set('pos_restock_notes', []);
  storage.set('calc_history', []);
  storage.set('invoice_name', FRESH_INVOICE_NAME);
  storage.set('past_invoice_logs', []);
  storage.set('invoice_print_logs', []);
  storage.set('invoice_attendant_names', {});
};