# Supabase Schema Updates — Local App Structure Sync

This document describes the changes made to align Supabase SQL schema files with the current app data structure.

## Changes Made

### `supabase/setup.sql`

**Updated**: `inventory_activities` table activity type check constraint

**Before**:
```sql
check (type in ('restock', 'sale', 'cart-add', 'cart-remove', 'image-update'))
```

**After**:
```sql
check (type in ('restock', 'sale', 'cart-add', 'cart-remove', 'image-update', 'price-update', 'stock-update'))
```

**Reason**: The app's `ActivityLogEntry` type in `hooks/usePOS.ts` supports `price-update` and `stock-update` activities that track inventory price and stock changes independently from sales.

## Verification

The following app structures have been verified to match the Supabase schema:

### Data Types Mapped

| Local Storage Key | App Type | Supabase Table | Status |
|---|---|---|---|
| `calc_settings` | `AppSettings` | `user_settings` | ✓ Synced |
| `pos_inventory` | `InventoryItem[]` | `inventory_items` + `inventory_activities` | ✓ Synced |
| `calc_history` | `HistoryItem[]` | `calc_history` | ✓ Synced |
| `pos_purchases` | `PurchaseRecord[]` | `purchases` | ✓ Synced |
| `pos_suppliers` | `SupplierRecord[]` | `suppliers` + `supplier_products` | ✓ Synced |
| `pos_requests` | `POSRequest[]` | `requests` | ✓ Synced |
| `pos_restock_notes` | `RestockNote[]` | `restock_notes` + `restock_line_items` | ✓ Synced |
| `invoice_*` | Invoice data | `invoices` + `invoice_action_logs` + `invoice_print_logs` | ✓ Synced |
| `calc_settings.profiles` | `UserProfile[]` | `user_profiles` | ✓ Synced |

### Activity Types

All activity types are now supported:
- `restock` — Stock replenishment
- `sale` — Item sold
- `cart-add` — Item added to cart
- `cart-remove` — Item removed from cart
- `image-update` — Product image changed
- `price-update` — **NEW**: Item price changed
- `stock-update` — **NEW**: Item stock adjusted

## How to Apply

### Option 1: Fresh Setup

1. Go to Supabase Dashboard → SQL Editor
2. Create a new query
3. Copy the entire contents of `supabase/setup.sql`
4. Click **Run**
5. Wait for completion
6. Run `supabase/admin-business-info.sql` (after setup.sql)
7. Run `supabase/password-history-and-access.sql` (after setup.sql)

### Option 2: Update Existing Setup

If you already have the old schema, update the activity type check:

```sql
-- Drop old constraint
ALTER TABLE public.inventory_activities 
DROP CONSTRAINT inventory_activities_type_check;

-- Add updated constraint
ALTER TABLE public.inventory_activities 
ADD CONSTRAINT inventory_activities_type_check 
CHECK (type in ('restock', 'sale', 'cart-add', 'cart-remove', 'image-update', 'price-update', 'stock-update'));
```

## Files Not Changed

These files are working correctly and require no updates:

- `supabase/schema.sql` — Stub pointing to setup.sql (by design)
- `supabase/admin-business-info.sql` — Business info functions (no app changes)
- `supabase/password-history-and-access.sql` — Password audit (no app changes)
- `supabase/optional-strip-image-data.sql` — Optional cleanup (no app changes)

## Commit and Deploy

After testing locally:

```bash
git add supabase/setup.sql
git commit -m "Update inventory_activities type constraint to include price-update and stock-update"
git push origin main
```

The updated schema is now ready for production Supabase environments.

## Next Steps

1. Test the updated schema in your Supabase instance
2. Verify that all activity types are being logged correctly
3. Monitor activity logs in production to ensure price and stock updates are captured
4. Push to GitHub for version control

## Questions?

- Verify schema with: `SELECT constraint_name, constraint_definition FROM information_schema.table_constraints WHERE table_name = 'inventory_activities';`
- Check activity logs: `SELECT DISTINCT type FROM public.inventory_activities;`
- View app types: See `types.ts` and `hooks/usePOS.ts` for source of truth
