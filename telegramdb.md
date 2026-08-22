# Telegram database (per admin account)

## Split

| Layer | Backend |
|-------|---------|
| Login / signup / sessions | **Supabase Auth** |
| Admin portal + **7-character** access codes (Premium / Regular) | **Supabase** |
| App data (inventory, invoices, settings blobs, …) | **Telegram bot** (per approved account) |
| Admin portal / **dev skip** entry | **No Bot API paste** — system bot via Supabase Edge Function secret |

### Access codes (no more 200-seed pool)

- Admin portal has two buttons: **Premium** and **Regular**.
- Each click mints **one** 7-character alphanumeric code (RPC `admin_issue_access_code`).
- Opening the portal clears leftover **unused** codes (`admin_clear_unused_access_codes`).
- **Premium** (after approve): can create mini-profiles.
- **Regular** (after approve): cannot create mini-profiles.

### System Telegram secret (your bot)

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=…   # never commit
supabase functions deploy telegram-bot
```

Admin portal / dev-skip users enter the app without pasting a token.  
Approved shop accounts still connect **their** bot on first login after the 7-char code is approved.

Supabase must **not** store end-user POS data once a Telegram bot is linked.

```
Signup with 7-char code → pending
Admin approves code
User logs in → Admin info popup (*)
  - business name / phone / address
  - Telegram Bot API token *  → connects THIS account’s DB
App reads/writes JSON rows via that bot (device-held token)
```

## Flow

1. User signs up with a **7-character** one-time code → `pending`.
2. Admin portal approves the code (Supabase).
3. App listens (realtime / poll). On `approved`, show **Admin info** popup.
4. Required field: **Telegram Bot API** from BotFather.
5. Token is verified (`getMe`), storage chat resolved (`/start` once or chat id).
6. Config is saved **only on device** (`icalc_telegram_db_<accountId>`). Never commit tokens. Never upsert tokens to Supabase.
7. Inventory / settings sync to Telegram messages; Supabase data sync is skipped while connected.

## Row format

```json
{
  "v": 1,
  "kind": "snapshot",
  "id": "inventory",
  "user_id": "<supabase-user-uuid>",
  "payload": { },
  "updated_at": "2026-08-22T12:00:00.000Z"
}
```

## Security

- Rotate any token that was pasted into chat or git.
- Prefer the Android build for Bot API calls (browser CORS often blocks `api.telegram.org`).
- Token never belongs in the repo, `.env` committed files, or Supabase user tables.

## Code

- `utils/telegramDb.ts` — connect, verify, upsert entities
- Auth overlay — Admin info popup after 7-char approval
- `useSupabaseDataSync` — no-op when Telegram DB is connected
