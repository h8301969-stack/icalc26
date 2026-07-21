# Supabase Schema Migrations for Data Recovery & Audit

This guide outlines the required Supabase schema changes to enable soft deletes, conflict resolution, and audit logging.

## Required Changes

### 1. Add `deleted_at` to existing tables

Soft deletes allow recovery of deleted items. Run these migrations in your Supabase SQL editor:

```sql
-- inventory_items
ALTER TABLE inventory_items ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
CREATE INDEX idx_inventory_deleted ON inventory_items(user_id, deleted_at);

-- invoices
ALTER TABLE invoices ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
CREATE INDEX idx_invoices_deleted ON invoices(user_id, deleted_at);

-- purchases
ALTER TABLE purchases ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
CREATE INDEX idx_purchases_deleted ON purchases(user_id, deleted_at);

-- suppliers
ALTER TABLE suppliers ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
CREATE INDEX idx_suppliers_deleted ON suppliers(user_id, deleted_at);

-- pos_requests
ALTER TABLE pos_requests ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
CREATE INDEX idx_requests_deleted ON pos_requests(user_id, deleted_at);

-- restock_notes
ALTER TABLE restock_notes ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
CREATE INDEX idx_restocks_deleted ON restock_notes(user_id, deleted_at);
```

### 2. Add `updated_at` for conflict resolution

Track when records were last modified for detecting conflicts:

```sql
-- inventory_items
ALTER TABLE inventory_items ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE INDEX idx_inventory_updated ON inventory_items(updated_at);

-- invoices
ALTER TABLE invoices ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE INDEX idx_invoices_updated ON invoices(updated_at);

-- purchases
ALTER TABLE purchases ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE INDEX idx_purchases_updated ON purchases(updated_at);

-- suppliers
ALTER TABLE suppliers ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE INDEX idx_suppliers_updated ON suppliers(updated_at);

-- pos_requests
ALTER TABLE pos_requests ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE INDEX idx_requests_updated ON pos_requests(updated_at);

-- restock_notes
ALTER TABLE restock_notes ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE INDEX idx_restocks_updated ON restock_notes(updated_at);
```

### 3. Create audit_logs table

Track all changes to entities:

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL,
  profile_name VARCHAR(255),
  timestamp BIGINT NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp DESC);
```

### 4. Update RLS Policies

Update your fetch queries to exclude soft-deleted items:

```sql
-- Example for inventory_items
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only see their own non-deleted inventory"
  ON inventory_items FOR SELECT
  USING (user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "Users can update their own inventory"
  ON inventory_items FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert into their inventory"
  ON inventory_items FOR INSERT
  WITH CHECK (user_id = auth.uid());
```

## Implementation Steps

1. **Backup your database** before making changes
2. Copy the SQL migrations above into Supabase SQL editor
3. Run migrations one section at a time
4. Test with your app—soft deletes will automatically work
5. Verify audit logs appear in the new `audit_logs` table

## Client-Side Integration

The client already has support for:
- ✅ Soft delete UI (TrashPanel.tsx)
- ✅ Audit log viewing (AuditLogPanel.tsx)
- ✅ Sync status tracking (SyncStatusIndicator.tsx)
- ✅ Auto-retry on failures

## Backup Strategy

After schema changes:
1. Enable Supabase automated backups (check Dashboard → Project Settings → Backups)
2. Set backup frequency to daily
3. Test recovery by deleting and restoring an item

## Rollback Plan

If issues occur:
```sql
-- Remove soft deletes
ALTER TABLE inventory_items DROP COLUMN deleted_at;
ALTER TABLE invoices DROP COLUMN deleted_at;
-- etc...

-- Remove audit logs
DROP TABLE audit_logs;
```
