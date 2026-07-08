-- Run after schema.sql — adds columns for full settings sync from the app.
-- Safe to re-run.

alter table public.user_settings drop constraint if exists user_settings_invoice_switcher_mode_check;
alter table public.user_settings add constraint user_settings_invoice_switcher_mode_check
  check (invoice_switcher_mode in ('horizontal', 'grid', 'vertical', 'list'));

alter table public.user_settings
  add column if not exists expression_view_mode text not null default 'auto';

alter table public.user_settings drop constraint if exists user_settings_expression_view_mode_check;
alter table public.user_settings add constraint user_settings_expression_view_mode_check
  check (expression_view_mode in ('auto', 'list'));

alter table public.user_settings
  add column if not exists receipt_layout_mode text not null default 'summary';

alter table public.user_settings drop constraint if exists user_settings_receipt_layout_mode_check;
alter table public.user_settings add constraint user_settings_receipt_layout_mode_check
  check (receipt_layout_mode in ('summary', 'full'));