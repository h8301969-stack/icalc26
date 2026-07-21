# Data Recovery & Sync Features

This document describes the 5 data safety features implemented to prevent data loss and improve sync reliability.

## 1. 🔄 Sync Status Indicator

**What it does:** Shows real-time sync status in the UI. Users see when data is syncing, when sync succeeds, or when there's a failure.

**Components:**
- `SyncStatusIndicator.tsx` — Floating indicator in bottom-right corner
- `useSyncStatus.ts` — Hook that tracks sync state and retry logic

**User Experience:**
- ✅ Green checkmark briefly appears after successful sync
- ⏳ Spinning indicator shows while syncing
- ⚠️ Red warning appears if sync fails (user can click to see details)
- 🔁 "Retry" button lets users manually retry failed syncs

**Implementation Status:** ✅ Complete (client-side)
- Integration added to App.tsx
- SyncStatusIndicator component created
- useSyncStatus hook with exponential backoff retry logic

---

## 2. 🗑️ Soft Deletes & Trash Recovery

**What it does:** Instead of permanently deleting items, they're marked as deleted. Users can recover deleted invoices and inventory items from a trash panel.

**Components:**
- `TrashPanel.tsx` — UI modal showing deleted items
- `enhancedSync.ts` — `handleSoftDelete()`, `handleSoftRestore()` functions

**User Experience:**
- Delete button marks item as deleted (not permanent)
- Trash panel accessible from settings
- Browse deleted invoices/inventory by date
- One-click restore

**Database Changes Needed:**
```sql
ALTER TABLE inventory_items ADD COLUMN deleted_at TIMESTAMP;
ALTER TABLE invoices ADD COLUMN deleted_at TIMESTAMP;
-- (see SUPABASE_MIGRATIONS.md for all tables)
```

**Implementation Status:**
- ✅ Client-side: TrashPanel component, delete/restore logic
- ✅ Audit logging of deletes
- ⏳ **TODO:** Run Supabase migrations to add `deleted_at` columns
- ⏳ **TODO:** Update fetch queries to exclude soft-deleted items (`WHERE deleted_at IS NULL`)

---

## 3. 🔁 Auto-Retry with Exponential Backoff

**What it does:** If a sync fails (network timeout, server error), the app automatically retries with increasing delays instead of silently giving up.

**Implementation:**
```
Attempt 1: Immediate
Attempt 2: ~1s + random
Attempt 3: ~2s + random
Attempt 4: ~4s + random
Attempt 5: ~8s + random (max 30s)
```

**Components:**
- `useSyncStatus.ts` — `scheduleRetry()`, exponential backoff math

**Features:**
- Tracks failed items separately
- Retries automatically on next data change
- Shows retry status in SyncStatusIndicator
- User can manually trigger retry

**Implementation Status:** ✅ Complete (logic added, needs integration into sync hooks)

---

## 4. 📋 Audit Trail

**What it does:** Logs every create, update, delete action with timestamp, user/profile, and entity type for debugging and compliance.

**Components:**
- `auditLog.ts` — `logAuditEntry()`, `fetchAuditLogs()` functions
- `AuditLogPanel.tsx` — UI modal showing change history

**Database Table Needed:**
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  action VARCHAR(20),  -- 'create', 'update', 'delete', 'restore'
  profile_name VARCHAR(255),
  timestamp BIGINT,
  details JSONB,
  created_at TIMESTAMP
);
```

**User Experience:**
- Admin-accessible audit log in settings
- See who changed what and when
- Time-stamped entries
- JSON details of changes (optional)

**Implementation Status:**
- ✅ Client-side: auditLog utilities, AuditLogPanel component
- ✅ Logging functions ready
- ⏳ **TODO:** Run Supabase migrations to create `audit_logs` table
- ⏳ **TODO:** Call `logAuditEntry()` when creating/updating/deleting items

---

## 5. ⚔️ Conflict Resolution (Last-Write-Wins)

**What it does:** If two devices/tabs edit the same record simultaneously, uses timestamps to detect conflicts and applies a last-write-wins strategy.

**Components:**
- `enhancedSync.ts` — `checkConflicts()` function

**How it works:**
```
1. Client has updated_at timestamp
2. Before sync, check if server has newer version
3. If server is newer, keep server version
4. If client is newer, send client version
5. Log conflict for audit trail
```

**Database Changes Needed:**
```sql
ALTER TABLE inventory_items ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE invoices ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
-- (see SUPABASE_MIGRATIONS.md)
```

**Implementation Status:**
- ✅ Client-side: conflict detection logic
- ⏳ **TODO:** Run Supabase migrations to add `updated_at` columns
- ⏳ **TODO:** Integrate into sync functions before upsert

---

## Getting Started

### Phase 1: Immediate (No DB Changes)
1. ✅ SyncStatusIndicator is live — you'll see sync status
2. ✅ Retry logic is in place — failures auto-retry
3. Test by going offline briefly, see "Sync failed" appear, then auto-retry

### Phase 2: Enable Data Recovery (Requires DB Changes)
1. Run migrations from `SUPABASE_MIGRATIONS.md`
2. Add `deleted_at` and `updated_at` to tables
3. Create `audit_logs` table
4. Update fetch queries to skip soft-deleted items
5. Test trash recovery in Settings

### Phase 3: Full Audit Trail
1. Call `logAuditEntry()` in sync functions
2. Open AuditLogPanel from Settings to verify logs appear
3. Review who changed what

---

## Testing Checklist

### Sync Status
- [ ] Make a change (e.g., add inventory item)
- [ ] Observe spinner while syncing
- [ ] See checkmark after success
- [ ] Disconnect network, make a change
- [ ] See "Sync failed" warning
- [ ] Reconnect, auto-retry or click "Retry"
- [ ] Verify change synced

### Soft Deletes
- [ ] Delete an inventory item
- [ ] Item appears in Trash
- [ ] Click Restore
- [ ] Item reappears in inventory

### Audit Log
- [ ] Make create/update/delete actions
- [ ] Open Audit Log in Settings
- [ ] Verify entries appear with timestamps

### Conflict Resolution
- [ ] Open app in two browser tabs
- [ ] Edit same item in both tabs
- [ ] Verify last edit wins (no data loss)
- [ ] Check audit log shows both edits

---

## File Structure

```
New files:
├── hooks/
│   ├── useSyncStatus.ts              (sync state tracking + retries)
│   └── useSupabaseSyncWithStatus.ts  (wrapper for integration)
├── components/
│   ├── SyncStatusIndicator.tsx       (floating UI indicator)
│   ├── TrashPanel.tsx                (trash/recovery UI)
│   └── AuditLogPanel.tsx             (audit log viewer)
├── utils/
│   ├── auditLog.ts                   (audit logging functions)
│   └── enhancedSync.ts               (soft deletes, conflict resolution)
├── types.ts                           (updated with SyncStatus, AuditLogEntry)
├── constants.tsx                      (added Sync icon)
└── SUPABASE_MIGRATIONS.md            (SQL for schema changes)
```

---

## Troubleshooting

**Sync status not showing?**
- Check browser DevTools → Console for errors
- Verify Supabase connection is working

**Trash is empty but I deleted something?**
- Run migrations first to add `deleted_at` column
- Restart app after migrations

**Audit log shows nothing?**
- Migrations must be run first
- Ensure `logAuditEntry()` is being called
- Check Supabase logs for errors

**Conflicts still happening?**
- `updated_at` columns must be added (see migrations)
- Verify sync is using `checkConflicts()` before upsert

---

## Next Steps

1. **Immediate:** Monitor sync status indicator in production
2. **This week:** Run Supabase migrations (soft deletes + audit logs)
3. **Next week:** Integrate audit logging into sync functions
4. **Later:** Add audit log viewer to admin dashboard
