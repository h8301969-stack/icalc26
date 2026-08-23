-- OPTIONAL only: trim OLD INVOICE LOGS on Supabase (~60 days).
-- Telegram is long-term shop memory. Auth / access codes are NEVER touched here.
--
-- DO NOT run deletes against:
--   auth.users, access_codes, admin sessions, account_notifications (auth/tenant)
--
-- Safe to re-run. Preview first if you want:
--   select count(*) from public.invoice_action_logs where logged_at < now() - interval '60 days';
--   select count(*) from public.invoice_print_logs where printed_at < now() - interval '60 days';

delete from public.invoice_action_logs
where logged_at < now() - interval '60 days';

delete from public.invoice_print_logs
where printed_at < now() - interval '60 days';
