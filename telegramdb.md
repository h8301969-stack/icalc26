# Telegram as a lightweight DB (auth + admin portal codes)

> Design note — not wired as the live backend yet.  
> Today iCalc still uses **Supabase** for access codes and admin sessions.  
> This document describes how a **Telegram Bot API** channel could replace that slice.

---

## The trick

Telegram bots can **send and edit messages** in a private chat or channel you control.  
Those messages become durable, queryable records if you treat each message as a **row** and pin / index them with a small protocol.

You do **not** get SQL. You get:

- append-only writes (`sendMessage`)
- in-place updates (`editMessageText`)
- optional deletes (`deleteMessage`)
- optional search via your own index message(s)

That is enough for **admin portal codes** and a thin **auth gate** if the client (or a tiny edge worker) talks to the bot with a secret.

---

## Why consider it

| Need | Supabase today | Telegram alternative |
|------|----------------|----------------------|
| Store unused / pending / approved codes | `access_codes` table | One message per code (JSON body) |
| Admin approve / deny / memo | RPC + RLS | Bot edits that message’s JSON |
| Admin session / backdoor | `admin_sessions` RPC | Short-lived token message or HMAC in client |
| Hosting cost / ops | Project + keys | Bot token + one private chat |
| Audit trail | DB rows + history | Message history in the chat |

Good fit when you want a **personal / low-volume** control plane (you are the only admin).  
Poor fit for multi-tenant SaaS scale, complex joins, or strong compliance.

---

## Threat model (read this first)

1. **Bot token = root.** Anyone with the token can read/write the “database.” Store it only in a server / edge function — never in the APK or Vite bundle.
2. Telegram is **not** a HIPAA/SOC2 vault. Treat codes as **semi-sensitive** (access gates), not bank credentials.
3. Rate limits exist. Burst approve/deny is fine; don’t poll every second from every client.
4. Prefer a **private channel or group** the bot can post to; never a public channel.

---

## Suggested layout

### 1. Control chat

Create a private Telegram chat or channel. Invite only your bot. Note the `chat_id` (negative for groups/channels).

### 2. Index message (optional but useful)

Pin one message that lists code → `message_id` mappings:

```json
{
  "v": 1,
  "kind": "index",
  "codes": {
    "AB12CD": 401122,
    "XY99ZZ": 401188
  },
  "updated_at": "2026-08-21T12:00:00.000Z"
}
```

Without an index, the admin UI can call `getUpdates` / `forwardMessage` patterns poorly — better to keep the index or a small Cloudflare Worker cache.

### 3. Row message (one per access code)

```json
{
  "v": 1,
  "kind": "access_code",
  "code": "AB12CD",
  "status": "pending",
  "username": "shop_owner",
  "email": null,
  "user_id": null,
  "admin_memo": "Accra stall",
  "business_name": "Kofi Mart",
  "business_phone": "+233…",
  "business_address": null,
  "created_at": "2026-08-20T09:00:00.000Z",
  "requested_at": "2026-08-20T09:05:00.000Z",
  "approved_at": null,
  "denied_at": null,
  "paused_at": null
}
```

Statuses mirror the current portal tabs: `unused` | `pending` | `approved` | `paused` | `denied`.

### 4. Auth / password history (optional)

Separate messages:

```json
{
  "v": 1,
  "kind": "password_event",
  "access_code": "AB12CD",
  "source": "signup",
  "password_value": "••••",
  "is_current": true,
  "created_at": "2026-08-20T09:05:00.000Z"
}
```

Prefer hashing passwords before they ever hit Telegram if you go this route.

---

## API surface (map from today’s `accessControl.ts`)

Keep the same TypeScript functions the UI already calls; swap the body from Supabase RPC to Telegram:

| App function | Telegram ops |
|--------------|--------------|
| `adminListCodes` | Read index → `forward`/`copy` not needed; worker returns parsed JSON for each `message_id` (cached) |
| `adminApproveCode` | `editMessageText` row → `status: approved`, set `approved_at` |
| `adminDenyCode` | `editMessageText` → `denied` |
| `adminUpdateMemo` | `editMessageText` memo field |
| `adminGrantAccess` / revoke | Same edits + optional password_event message |
| `tryOpenAdminSession` | Worker verifies admin password / clock backdoor → returns short JWT; optional session message with TTL |
| Signup request code | Client → Worker → bot `sendMessage` new row + update index |

**Critical:** the browser / Capacitor app must call **your worker**, not `api.telegram.org` with the bot token.

```
iCalc client  →  Edge worker (secret bot token)
                      ↓
              api.telegram.org
                      ↓
              private chat messages = rows
```

---

## Edge worker sketch

Env:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `ADMIN_HMAC_SECRET`
- `INDEX_MESSAGE_ID` (or discover from a pinned message)

Endpoints (examples):

- `GET /codes?status=pending` → list
- `POST /codes/:code/approve` → edit row
- `POST /codes/:code/deny`
- `POST /session` → admin login
- `POST /request` → user submits code request after signup

Worker responsibilities:

1. Validate admin session on mutating routes.
2. Serialize JSON compactly (Telegram message length limit ~4096 chars).
3. Update the index message after every insert.
4. Return the same shapes `AdminCodeDashboard` already expects (`AccessCodeRow`, etc.).

---

## Migration path from Supabase

1. Keep Supabase as source of truth.
2. Add a dual-write worker (optional) to mirror codes into Telegram for backup / offline admin.
3. Point `accessControl.ts` at the worker behind a flag, e.g. `VITE_ACCESS_BACKEND=telegram|supabase`.
4. Cut over when list/approve/deny parity is proven.
5. Leave inventory / invoices / sync on Supabase (or later) — Telegram is only proposed for **auth + admin codes**.

---

## What stays on Supabase (recommended)

- Inventory, purchases, invoice logs, activities  
- Account notifications  
- Profile / settings blobs  
- Realtime sync across devices  

Telegram is a clever **control-plane** DB, not a full app database.

---

## Admin portal reader

In the admin portal, **tap the logo / avatar** to open this file in a scrollable popup.  
That keeps the design notes available on-device without leaving the portal.

---

## Open questions before implementation

1. Host the worker on Cloudflare / Vercel / Fly?  
2. Single admin only, or multiple bot operators?  
3. Store password history in Telegram at all, or only code status?  
4. Keep clock backdoor (`irocky-stackHH:MM`) in the worker or retire it?

---

## Summary

**Yes — you can use Telegram Bot API as storage for auth gates and admin portal codes** by treating messages as rows and routing all bot calls through a secret-holding worker.  
This markdown is the design contract; live traffic still goes through Supabase until that worker and feature flag ship.
