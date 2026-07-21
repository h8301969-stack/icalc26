# Implementation Checklist: Data Recovery Features

## ✅ Completed (Client-Side Code)

### Sync Status & Retry
- [x] Created `useSyncStatus.ts` hook — tracks sync state with exponential backoff
- [x] Created `SyncStatusIndicator.tsx` component — shows sync status in UI
- [x] Integrated indicator into App.tsx
- [x] Added Sync icon to constants.tsx
- [x] Retry logic with exponential backoff (1s, 2s, 4s, 8s, 30s max)

### Soft Deletes & Trash
- [x] Created `TrashPanel.tsx` — UI for browsing/recovering deleted items
- [x] Created `handleSoftDelete()` and `handleSoftRestore()` in enhancedSync.ts
- [x] Audit logging for delete/restore actions
- [x] Filter by inventory vs invoices

### Audit Logging
- [x] Created `auditLog.ts` — log entry functions
- [x] Created `AuditLogPanel.tsx` — viewer for audit history
- [x] Added AuditLogEntry type to types.ts
- [x] Shows entity changes, who, when, details

### Conflict Resolution
- [x] Created `checkConflicts()` in enhancedSync.ts
- [x] Last-write-wins strategy ready to use
- [x] SyncConflict type defined

### Type Definitions
- [x] Added SyncStatus enum to types.ts
- [x] Added SyncState interface
- [x] Added AuditLogEntry type
- [x] Updated SavedInvoice with optional deletedAt

---

## ⏳ TODO (Supabase Setup)

### 1. Run Database Migrations
**Time: ~5-10 minutes**

Visit Supabase Dashboard → SQL Editor and run these:

```
COPY ALL from SUPABASE_MIGRATIONS.md
```

Specific migrations:
- [ ] Add `deleted_at` columns to 6 tables (inventory, invoices, purchases, suppliers, requests, restocks)
- [ ] Add `updated_at` columns to 6 tables
- [ ] Create `audit_logs` table with schema
- [ ] Create indexes for performance

### 2. Update Fetch Queries
**Time: ~15-20 minutes**

File: `utils/supabaseDataSync.ts`

For each fetch function, add `.is()` or `.not()` filter:

```typescript
// BEFORE:
const { data: rows } = await supabase
  .from('inventory_items')
  .select('*')
  .eq('user_id', userId);

// AFTER:
const { data: rows } = await supabase
  .from('inventory_items')
  .select('*')
  .eq('user_id', userId)
  .is('deleted_at', null);  // <-- Add this line
```

Apply to:
- [ ] `fetchInventoryFromSupabase()`
- [ ] `fetchInvoiceDataFromSupabase()`
- [ ] `fetchPurchasesFromSupabase()`
- [ ] `fetchSuppliersFromSupabase()`
- [ ] `fetchRequestsFromSupabase()`
- [ ] `fetchRestocksFromSupabase()`

### 3. Integrate Audit Logging in Sync
**Time: ~20 minutes**

File: `utils/supabaseDataSync.ts`

After each upsert/insert/delete, call:

```typescript
import { logAuditEntry } from './auditLog';

// After successful sync:
await logAuditEntry(userId, {
  entityType: 'inventory',
  entityId: item.id,
  action: 'update',
  profileName: currentProfile?.name,
  timestamp: Date.now(),
});
```

Apply to:
- [ ] `syncInventoryToSupabase()` — log updates
- [ ] `syncInvoiceDataToSupabase()` — log invoice changes
- [ ] `syncPurchasesToSupabase()` — log purchases
- [ ] `syncSuppliersToSupabase()` — log supplier changes
- [ ] `syncRequestsToSupabase()` — log request changes
- [ ] `syncRestocksToSupabase()` — log restock changes

### 4. Add Soft Delete Hooks to UI
**Time: ~10 minutes**

When user clicks delete (you'll find these in components):

```typescript
import { handleSoftDelete } from '../utils/enhancedSync';

// Instead of permanent delete:
await handleSoftDelete(userId, 'inventory', itemId, profileName);
```

Find these in:
- [ ] Inventory item delete buttons
- [ ] Invoice delete buttons
- [ ] Purchase delete buttons

### 5. Add Trash Panel to Settings
**Time: ~5 minutes**

File: `components/SettingsPanel.tsx`

Add a "Trash" button that opens TrashPanel:

```typescript
import { TrashPanel } from './TrashPanel';

// In component:
const [isTrashOpen, setIsTrashOpen] = useState(false);

<button onClick={() => setIsTrashOpen(true)}>
  Trash
</button>

<TrashPanel
  isOpen={isTrashOpen}
  onClose={() => setIsTrashOpen(false)}
  userId={account?.id}
  isLight={isLight}
/>
```

- [ ] Add trash button to settings
- [ ] Wire up TrashPanel state

### 6. Add Audit Log Viewer to Settings
**Time: ~5 minutes**

File: `components/SettingsPanel.tsx`

Add "Audit Log" button:

```typescript
import { AuditLogPanel } from './AuditLogPanel';

// In component:
const [isAuditOpen, setIsAuditOpen] = useState(false);

<button onClick={() => setIsAuditOpen(true)}>
  Audit Log (Admin)
</button>

<AuditLogPanel
  isOpen={isAuditOpen}
  onClose={() => setIsAuditOpen(false)}
  userId={account?.id}
  isLight={isLight}
/>
```

- [ ] Add audit button to settings
- [ ] Wire up AuditLogPanel state

### 7. Test Everything
**Time: ~15 minutes**

- [ ] Sync status shows ✅ when syncing succeeds
- [ ] Sync status shows ⚠️ when disconnected
- [ ] Delete item → appears in Trash
- [ ] Restore from Trash → item reappears
- [ ] Audit Log shows delete/restore actions
- [ ] Offline → make changes → online → auto-syncs

---

## Recommended Order

1. **First:** Run all Supabase migrations (15 min)
2. **Second:** Update fetch queries to exclude deleted items (20 min)
3. **Third:** Add audit logging calls (20 min)
4. **Fourth:** Add trash/audit UI to settings (10 min)
5. **Fifth:** Integrate soft delete into delete handlers (10 min)
6. **Test:** Verify everything works (15 min)

**Total: ~90 minutes**

---

## Commands to Test

After implementing, run in browser console:

```javascript
// Check sync status
console.log(document.querySelector('[title="Syncing..."]'));

// Trigger offline
navigator.onLine = false;
// Make a change
// See "Sync failed" appear
navigator.onLine = true;
// Should auto-retry
```

---

## Rollback Plan

If something breaks:

1. Delete the new components (TrashPanel, AuditLogPanel, etc.)
2. Remove the `.is('deleted_at', null)` filters from fetch queries
3. Revert this commit
4. Database migrations are backwards-compatible (just adds columns, doesn't break existing code)

---

## Production Readiness

After completing all items above, you'll have:
- ✅ Sync status visibility (no more silent failures)
- ✅ Data recovery (soft deletes + trash)
- ✅ Auto-retry on failures
- ✅ Audit trail for compliance
- ✅ Conflict detection
- ✅ **Production rating: 7-8/10** (up from 5)

What's still missing for 9+:
- E2E tests (Cypress/Playwright)
- Load testing
- Error tracking (Sentry)
- Automated backups verification
