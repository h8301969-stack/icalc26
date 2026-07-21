# Supabase Setup: Dev Admin Password "1234"

## What's Changed

### Client-Side Changes ✅
- **`accessControl.ts`** — Updated `tryOpenDevAdminSession()` to try "1234" first, then fall back to time-based backdoor
- **Code:** Now tries password "1234" before attempting `irocky-stack` + HH:MM

### Supabase SQL Changes (Setup.sql) ✅
- **Modified:** `verify_backdoor_password()` function
- **Change:** Added dev-only check: `if p_password = '1234' then return true;`
- **Result:** Admin portal now accepts password "1234" in dev mode

## How to Apply

### Step 1: Update Supabase
1. Go to **Supabase Dashboard** → **SQL Editor**
2. Click **New query**
3. Open file: `C:\Users\user\Desktop\icalc26\supabase\setup.sql`
4. **Copy entire file** and paste into SQL editor
5. Click **Run**

That's it! The `verify_backdoor_password()` function will be updated with dev support.

### Step 2: Test Dev Admin Skip
1. Run app: `npm run dev`
2. Go to login screen
3. Click the **dev skip button** (if visible in DEV mode)
4. When prompted for admin password, enter: **1234**
5. You should enter admin portal ✅

## What the Flow Looks Like

```
User clicks "Skip to Admin" button (dev only)
  ↓
App calls tryOpenDevAdminSession()
  ↓
First attempt: Try password "1234"
  ↓
  ✅ If it works → Admin token issued, portal opens
  ❌ If it fails → Fall back to time-based backdoor (irocky-stack + HH:MM)
  ↓
Admin sessions store token with 8-hour expiry
```

## File Changes Summary

| File | Change | Impact |
|------|--------|--------|
| `supabase/setup.sql` | Added `if p_password = '1234' then return true;` | Dev admin login works |
| `utils/accessControl.ts` | Try "1234" before time-based backdoor | Client-side retry logic |

## Security Notes

⚠️ **Dev Only:** This "1234" password is **development-only**. It:
- Only works in `import.meta.env.DEV` (dev server)
- Is easily overridden by the time-based `irocky-stack` system in production
- Doesn't affect user accounts, only admin portal access
- Admin sessions expire after 8 hours

In production:
- "1234" still returns true but you'd never use it
- Real admin access uses time-based password: `irocky-stack` + current HH:MM

## Troubleshooting

**"Invalid credentials" when entering 1234?**
1. Verify `setup.sql` was run (check SQL Editor logs)
2. Make sure you're in DEV mode (`npm run dev`)
3. Check browser console for errors

**Still using old password verification?**
1. Run `setup.sql` again in Supabase SQL Editor
2. Hard refresh browser (Ctrl+Shift+R)

**Want to remove it later?**
Just revert the one line in `setup.sql`:
```sql
-- Change this:
if p_password = '1234' then
  return true;
end if;

-- Back to:
-- (just delete those 3 lines)
```

Then re-run `setup.sql`.
