-- iCalc POS — complete Supabase setup (paste this entire file into SQL Editor, then Run)
-- Project: https://ttwgosajvcdyybkwdgdo.supabase.co
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Safe to re-run: IF NOT EXISTS tables, dropped policies/triggers, CREATE OR REPLACE functions.
-- Mirrors: types.ts, hooks/, utils/supabaseDataSync.ts, utils/supabaseAuth.ts, utils/accessControl.ts
-- Includes: app data tables, RLS, access-code admin system, business info, Realtime approvals.

-- Extensions
create extension if not exists "pgcrypto";

-- ── Profiles (UserProfile) ───────────────────────────────────────────────────
-- localStorage: calc_settings.profiles, icalc_accounts.profiles
create table if not exists public.user_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  avatar_url    text not null default '',
  is_system     boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, name)
);

-- ── User settings (calc_settings blob) ───────────────────────────────────────
create table if not exists public.user_settings (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  accent_color            text not null default '#ff9f0a',
  glass_blur              integer not null default 24,
  haptic_feedback         boolean not null default true,
  haptic_intensity        text not null default 'medium'
                            check (haptic_intensity in ('soft', 'medium', 'intense')),
  theme_mode              text not null default 'system'
                            check (theme_mode in ('light', 'dark', 'system')),
  currency                text not null default 'GHS'
                            check (currency in ('GHS', 'USD', 'EUR', 'GBP', 'JPY', 'NGN')),
  custom_wallpapers       jsonb not null default '[]'::jsonb,
  ui_scale                numeric(4, 2) not null default 1.00,
  disable_calculator_card boolean not null default false,
  layout_mode             text not null default 'portrait'
                            check (layout_mode in ('portrait', 'landscape')),
  layout_mode_auto        boolean not null default true,
  invoice_switcher_mode   text not null default 'horizontal'
                            check (invoice_switcher_mode in ('horizontal', 'grid', 'vertical', 'list')),
  expression_view_mode    text not null default 'auto'
                            check (expression_view_mode in ('auto', 'list')),
  receipt_layout_mode     text not null default 'summary'
                            check (receipt_layout_mode in ('summary', 'full')),
  standby_timer_seconds   integer not null default 0,
  active_profile_id       uuid references public.user_profiles(id) on delete set null,
  business_name           text,
  business_phone          text,
  business_address        text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ── Invite codes (invite-passwords.txt + icalc_used_invite_codes) ─────────────
create table if not exists public.invite_redemptions (
  code          text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  redeemed_at   timestamptz not null default now()
);

-- ── Inventory (pos_inventory) ────────────────────────────────────────────────
create table if not exists public.inventory_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  stock         integer not null default 0 check (stock >= 0),
  price         numeric(12, 2) not null default 0,
  threshold     integer not null default 10,
  category      text not null default 'General',
  supplier      text,
  image_url     text,
  date_added    date not null default current_date,
  last_stocked  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ActivityLogEntry — embedded in InventoryItem.activities locally
create table if not exists public.inventory_activities (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  item_id       uuid not null references public.inventory_items(id) on delete cascade,
  type          text not null
                  check (type in ('restock', 'sale', 'cart-add', 'cart-remove', 'image-update')),
  action        text not null,
  profile_name  text,
  logged_at     timestamptz not null default now()
);

-- ── Purchases / transactions (pos_purchases) ───────────────────────────────────
create table if not exists public.purchases (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  item_name     text not null,
  quantity      integer not null default 1 check (quantity > 0),
  price         numeric(12, 2) not null,
  total         numeric(12, 2) not null,
  purchased_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- ── Suppliers (pos_suppliers) ────────────────────────────────────────────────
create table if not exists public.suppliers (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  name                  text not null,
  last_received_at      timestamptz,
  total_items_received  integer not null default 0 check (total_items_received >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.supplier_products (
  supplier_id   uuid not null references public.suppliers(id) on delete cascade,
  product_id    uuid not null references public.inventory_items(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (supplier_id, product_id)
);

-- ── Invoices (invoice_name + expression in calculator) ───────────────────────
create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  expression    text not null default '0',
  is_current    boolean not null default false,
  total         numeric(12, 2) not null default 0,
  attendant_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, name)
);

-- CartLineItem — derived from expression, stored for sync / print
create table if not exists public.invoice_line_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices(id) on delete cascade,
  item_name     text,
  price         numeric(12, 2) not null,
  quantity      integer not null default 1 check (quantity > 0),
  created_at    timestamptz not null default now()
);

-- InvoiceActionLog (past_invoice_logs + live segments)
create table if not exists public.invoice_action_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  invoice_name    text not null,
  message         text not null,
  item_name       text,
  price           numeric(12, 2) not null default 0,
  quantity        integer not null default 1,
  is_unidentified boolean not null default false,
  profile_name    text,
  logged_at       timestamptz not null default now()
);

-- InvoicePrintLog (invoice_print_logs)
create table if not exists public.invoice_print_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  invoice_name  text not null,
  total         text not null,
  items         jsonb not null default '[]'::jsonb,
  printed_at    timestamptz not null default now()
);

-- invoice_attendant_names
create table if not exists public.invoice_attendants (
  user_id         uuid not null references auth.users(id) on delete cascade,
  invoice_name    text not null,
  attendant_name  text not null,
  updated_at      timestamptz not null default now(),
  primary key (user_id, invoice_name)
);

-- ── Requests (POS dashboard) ─────────────────────────────────────────────────
create table if not exists public.requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  requester     text not null,
  notes         text,
  status        text not null default 'pending'
                  check (status in ('pending', 'delivered', 'outofstock')),
  item_count    integer not null default 0 check (item_count >= 0),
  total         numeric(12, 2) not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Restock notes (POS dashboard, in-memory locally) ─────────────────────────
create table if not exists public.restock_notes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.restock_line_items (
  id              uuid primary key default gen_random_uuid(),
  restock_note_id uuid not null references public.restock_notes(id) on delete cascade,
  item_id         uuid references public.inventory_items(id) on delete set null,
  name            text not null,
  qty             integer not null default 1 check (qty > 0),
  created_at      timestamptz not null default now()
);

-- ── Calculator history (calc_history) ─────────────────────────────────────────
create table if not exists public.calc_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  expression    text not null,
  result        text not null,
  created_at    timestamptz not null default now()
);

-- ── Access codes + admin sessions (invite / approval gate) ─────────────────────
create table if not exists public.access_codes (
  code              text primary key check (char_length(code) = 7),
  status            text not null default 'unused'
                        check (status in ('unused', 'pending', 'approved', 'paused', 'denied')),
  user_id           uuid references auth.users(id) on delete set null,
  username          text,
  email             text,
  requested_at      timestamptz,
  approved_at       timestamptz,
  denied_at         timestamptz,
  paused_at         timestamptz,
  admin_memo        text,
  business_name     text,
  business_phone    text,
  business_address  text,
  created_at        timestamptz not null default now()
);

create table if not exists public.admin_sessions (
  token       uuid primary key default gen_random_uuid(),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- ── Upgrade path for existing databases (safe to re-run) ───────────────────────
alter table public.user_settings
  add column if not exists expression_view_mode text,
  add column if not exists receipt_layout_mode text,
  add column if not exists business_name text,
  add column if not exists business_phone text,
  add column if not exists business_address text;

alter table public.user_settings alter column expression_view_mode set default 'auto';
alter table public.user_settings alter column receipt_layout_mode set default 'summary';
update public.user_settings set expression_view_mode = 'auto' where expression_view_mode is null;
update public.user_settings set receipt_layout_mode = 'summary' where receipt_layout_mode is null;
alter table public.user_settings alter column expression_view_mode set not null;
alter table public.user_settings alter column receipt_layout_mode set not null;

alter table public.user_settings drop constraint if exists user_settings_invoice_switcher_mode_check;
alter table public.user_settings add constraint user_settings_invoice_switcher_mode_check
  check (invoice_switcher_mode in ('horizontal', 'grid', 'vertical', 'list'));

alter table public.user_settings drop constraint if exists user_settings_expression_view_mode_check;
alter table public.user_settings add constraint user_settings_expression_view_mode_check
  check (expression_view_mode in ('auto', 'list'));

alter table public.user_settings drop constraint if exists user_settings_receipt_layout_mode_check;
alter table public.user_settings add constraint user_settings_receipt_layout_mode_check
  check (receipt_layout_mode in ('summary', 'full'));

alter table public.access_codes
  add column if not exists admin_memo text,
  add column if not exists business_name text,
  add column if not exists business_phone text,
  add column if not exists business_address text;

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists idx_user_profiles_user_id on public.user_profiles(user_id);
create index if not exists idx_inventory_items_user_id on public.inventory_items(user_id);
create index if not exists idx_inventory_activities_item_id on public.inventory_activities(item_id);
create index if not exists idx_purchases_user_id_logged on public.purchases(user_id, purchased_at desc);
create index if not exists idx_invoices_user_current on public.invoices(user_id, is_current);
create index if not exists idx_invoice_action_logs_user on public.invoice_action_logs(user_id, logged_at desc);
create index if not exists idx_invoice_print_logs_user on public.invoice_print_logs(user_id, printed_at desc);
create index if not exists idx_requests_user_status on public.requests(user_id, status);
create index if not exists idx_calc_history_user on public.calc_history(user_id, created_at desc);
create index if not exists idx_access_codes_status on public.access_codes(status);
create index if not exists idx_access_codes_user_id on public.access_codes(user_id);
create index if not exists idx_admin_sessions_expires on public.admin_sessions(expires_at);

-- ── Updated-at trigger ───────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

drop trigger if exists inventory_items_updated_at on public.inventory_items;
create trigger inventory_items_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

drop trigger if exists suppliers_updated_at on public.suppliers;
create trigger suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

drop trigger if exists invoices_updated_at on public.invoices;
create trigger invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

drop trigger if exists requests_updated_at on public.requests;
create trigger requests_updated_at
  before update on public.requests
  for each row execute function public.set_updated_at();

drop trigger if exists restock_notes_updated_at on public.restock_notes;
create trigger restock_notes_updated_at
  before update on public.restock_notes
  for each row execute function public.set_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.user_profiles          enable row level security;
alter table public.user_settings          enable row level security;
alter table public.invite_redemptions     enable row level security;
alter table public.inventory_items        enable row level security;
alter table public.inventory_activities   enable row level security;
alter table public.purchases              enable row level security;
alter table public.suppliers              enable row level security;
alter table public.supplier_products      enable row level security;
alter table public.invoices               enable row level security;
alter table public.invoice_line_items     enable row level security;
alter table public.invoice_action_logs    enable row level security;
alter table public.invoice_print_logs     enable row level security;
alter table public.invoice_attendants     enable row level security;
alter table public.requests               enable row level security;
alter table public.restock_notes          enable row level security;
alter table public.restock_line_items     enable row level security;
alter table public.calc_history           enable row level security;
alter table public.access_codes           enable row level security;
alter table public.admin_sessions         enable row level security;

revoke all on public.access_codes from public, anon, authenticated;
revoke all on public.admin_sessions from public, anon, authenticated;

-- Reset all existing RLS policies (fixes "policy already exists" on re-run)
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- Helper: own-row policies (drop + recreate so script is re-runnable)
-- user_profiles
drop policy if exists "profiles_select_own" on public.user_profiles;
create policy "profiles_select_own" on public.user_profiles for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "profiles_insert_own" on public.user_profiles;
create policy "profiles_insert_own" on public.user_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "profiles_update_own" on public.user_profiles;
create policy "profiles_update_own" on public.user_profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "profiles_delete_own" on public.user_profiles;
create policy "profiles_delete_own" on public.user_profiles for delete to authenticated
  using ((select auth.uid()) = user_id);

-- user_settings
drop policy if exists "settings_select_own" on public.user_settings;
create policy "settings_select_own" on public.user_settings for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "settings_insert_own" on public.user_settings;
create policy "settings_insert_own" on public.user_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "settings_update_own" on public.user_settings;
create policy "settings_update_own" on public.user_settings for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "settings_delete_own" on public.user_settings;
create policy "settings_delete_own" on public.user_settings for delete to authenticated
  using ((select auth.uid()) = user_id);

-- invite_redemptions (read own; insert on signup via service role or edge function)
drop policy if exists "invites_select_own" on public.invite_redemptions;
create policy "invites_select_own" on public.invite_redemptions for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "invites_insert_own" on public.invite_redemptions;
create policy "invites_insert_own" on public.invite_redemptions for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- inventory_items
drop policy if exists "inventory_select_own" on public.inventory_items;
create policy "inventory_select_own" on public.inventory_items for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "inventory_insert_own" on public.inventory_items;
create policy "inventory_insert_own" on public.inventory_items for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "inventory_update_own" on public.inventory_items;
create policy "inventory_update_own" on public.inventory_items for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "inventory_delete_own" on public.inventory_items;
create policy "inventory_delete_own" on public.inventory_items for delete to authenticated
  using ((select auth.uid()) = user_id);

-- inventory_activities
drop policy if exists "inv_activities_select_own" on public.inventory_activities;
create policy "inv_activities_select_own" on public.inventory_activities for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "inv_activities_insert_own" on public.inventory_activities;
create policy "inv_activities_insert_own" on public.inventory_activities for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "inv_activities_delete_own" on public.inventory_activities;
create policy "inv_activities_delete_own" on public.inventory_activities for delete to authenticated
  using ((select auth.uid()) = user_id);

-- purchases
drop policy if exists "purchases_select_own" on public.purchases;
create policy "purchases_select_own" on public.purchases for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "purchases_insert_own" on public.purchases;
create policy "purchases_insert_own" on public.purchases for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "purchases_delete_own" on public.purchases;
create policy "purchases_delete_own" on public.purchases for delete to authenticated
  using ((select auth.uid()) = user_id);

-- suppliers
drop policy if exists "suppliers_select_own" on public.suppliers;
create policy "suppliers_select_own" on public.suppliers for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "suppliers_insert_own" on public.suppliers;
create policy "suppliers_insert_own" on public.suppliers for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "suppliers_update_own" on public.suppliers;
create policy "suppliers_update_own" on public.suppliers for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "suppliers_delete_own" on public.suppliers;
create policy "suppliers_delete_own" on public.suppliers for delete to authenticated
  using ((select auth.uid()) = user_id);

-- supplier_products (via supplier ownership)
drop policy if exists "supplier_products_select_own" on public.supplier_products;
create policy "supplier_products_select_own" on public.supplier_products for select to authenticated
  using (exists (
    select 1 from public.suppliers s
    where s.id = supplier_id and s.user_id = (select auth.uid())
  ));
drop policy if exists "supplier_products_insert_own" on public.supplier_products;
create policy "supplier_products_insert_own" on public.supplier_products for insert to authenticated
  with check (exists (
    select 1 from public.suppliers s
    where s.id = supplier_id and s.user_id = (select auth.uid())
  ));
drop policy if exists "supplier_products_delete_own" on public.supplier_products;
create policy "supplier_products_delete_own" on public.supplier_products for delete to authenticated
  using (exists (
    select 1 from public.suppliers s
    where s.id = supplier_id and s.user_id = (select auth.uid())
  ));

-- invoices
drop policy if exists "invoices_select_own" on public.invoices;
create policy "invoices_select_own" on public.invoices for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "invoices_insert_own" on public.invoices;
create policy "invoices_insert_own" on public.invoices for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "invoices_update_own" on public.invoices;
create policy "invoices_update_own" on public.invoices for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "invoices_delete_own" on public.invoices;
create policy "invoices_delete_own" on public.invoices for delete to authenticated
  using ((select auth.uid()) = user_id);

-- invoice_line_items (via invoice ownership)
drop policy if exists "invoice_lines_select_own" on public.invoice_line_items;
create policy "invoice_lines_select_own" on public.invoice_line_items for select to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and i.user_id = (select auth.uid())
  ));
drop policy if exists "invoice_lines_insert_own" on public.invoice_line_items;
create policy "invoice_lines_insert_own" on public.invoice_line_items for insert to authenticated
  with check (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and i.user_id = (select auth.uid())
  ));
drop policy if exists "invoice_lines_update_own" on public.invoice_line_items;
create policy "invoice_lines_update_own" on public.invoice_line_items for update to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and i.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and i.user_id = (select auth.uid())
  ));
drop policy if exists "invoice_lines_delete_own" on public.invoice_line_items;
create policy "invoice_lines_delete_own" on public.invoice_line_items for delete to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and i.user_id = (select auth.uid())
  ));

-- invoice_action_logs
drop policy if exists "invoice_logs_select_own" on public.invoice_action_logs;
create policy "invoice_logs_select_own" on public.invoice_action_logs for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "invoice_logs_insert_own" on public.invoice_action_logs;
create policy "invoice_logs_insert_own" on public.invoice_action_logs for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- invoice_print_logs
drop policy if exists "invoice_prints_select_own" on public.invoice_print_logs;
create policy "invoice_prints_select_own" on public.invoice_print_logs for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "invoice_prints_insert_own" on public.invoice_print_logs;
create policy "invoice_prints_insert_own" on public.invoice_print_logs for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- invoice_attendants
drop policy if exists "invoice_attendants_select_own" on public.invoice_attendants;
create policy "invoice_attendants_select_own" on public.invoice_attendants for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "invoice_attendants_insert_own" on public.invoice_attendants;
create policy "invoice_attendants_insert_own" on public.invoice_attendants for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "invoice_attendants_update_own" on public.invoice_attendants;
create policy "invoice_attendants_update_own" on public.invoice_attendants for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "invoice_attendants_delete_own" on public.invoice_attendants;
create policy "invoice_attendants_delete_own" on public.invoice_attendants for delete to authenticated
  using ((select auth.uid()) = user_id);

-- requests
drop policy if exists "requests_select_own" on public.requests;
create policy "requests_select_own" on public.requests for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "requests_insert_own" on public.requests;
create policy "requests_insert_own" on public.requests for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "requests_update_own" on public.requests;
create policy "requests_update_own" on public.requests for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "requests_delete_own" on public.requests;
create policy "requests_delete_own" on public.requests for delete to authenticated
  using ((select auth.uid()) = user_id);

-- restock_notes
drop policy if exists "restock_notes_select_own" on public.restock_notes;
create policy "restock_notes_select_own" on public.restock_notes for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "restock_notes_insert_own" on public.restock_notes;
create policy "restock_notes_insert_own" on public.restock_notes for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "restock_notes_update_own" on public.restock_notes;
create policy "restock_notes_update_own" on public.restock_notes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "restock_notes_delete_own" on public.restock_notes;
create policy "restock_notes_delete_own" on public.restock_notes for delete to authenticated
  using ((select auth.uid()) = user_id);

-- restock_line_items (via restock note ownership)
drop policy if exists "restock_lines_select_own" on public.restock_line_items;
create policy "restock_lines_select_own" on public.restock_line_items for select to authenticated
  using (exists (
    select 1 from public.restock_notes n
    where n.id = restock_note_id and n.user_id = (select auth.uid())
  ));
drop policy if exists "restock_lines_insert_own" on public.restock_line_items;
create policy "restock_lines_insert_own" on public.restock_line_items for insert to authenticated
  with check (exists (
    select 1 from public.restock_notes n
    where n.id = restock_note_id and n.user_id = (select auth.uid())
  ));
drop policy if exists "restock_lines_update_own" on public.restock_line_items;
create policy "restock_lines_update_own" on public.restock_line_items for update to authenticated
  using (exists (
    select 1 from public.restock_notes n
    where n.id = restock_note_id and n.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.restock_notes n
    where n.id = restock_note_id and n.user_id = (select auth.uid())
  ));
drop policy if exists "restock_lines_delete_own" on public.restock_line_items;
create policy "restock_lines_delete_own" on public.restock_line_items for delete to authenticated
  using (exists (
    select 1 from public.restock_notes n
    where n.id = restock_note_id and n.user_id = (select auth.uid())
  ));

-- calc_history
drop policy if exists "calc_history_select_own" on public.calc_history;
create policy "calc_history_select_own" on public.calc_history for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "calc_history_insert_own" on public.calc_history;
create policy "calc_history_insert_own" on public.calc_history for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "calc_history_delete_own" on public.calc_history;
create policy "calc_history_delete_own" on public.calc_history for delete to authenticated
  using ((select auth.uid()) = user_id);

-- access_codes: Realtime approval push (authenticated users see only their row)
drop policy if exists access_codes_select_own_realtime on public.access_codes;
create policy access_codes_select_own_realtime on public.access_codes
  for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.access_codes to authenticated;

-- ── RPCs: auth helpers ───────────────────────────────────────────────────────

create or replace function public.get_email_for_username(p_username text)
returns text
language sql
security definer
set search_path = public, auth
as $$
  select u.email::text
  from auth.users u
  inner join public.user_profiles p on p.user_id = u.id
  where p.is_system = false
    and lower(trim(p.name)) = lower(trim(p_username))
  limit 1;
$$;

revoke all on function public.get_email_for_username(text) from public;
grant execute on function public.get_email_for_username(text) to anon, authenticated;

-- ── RPCs: access-code system ─────────────────────────────────────────────────

drop function if exists public.verify_backdoor_password(text, bigint, integer);
drop function if exists public.open_admin_session(text, bigint, integer);

create or replace function public.generate_access_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
  idx int;
begin
  for i in 1..7 loop
    idx := floor(random() * length(chars) + 1)::int;
    result := result || substr(chars, idx, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.verify_backdoor_password(
  p_password text,
  p_client_epoch_ms bigint default null,
  p_tz_offset_minutes int default null,
  p_client_hour int default null,
  p_client_minute int default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_suffix text;
  v_pass_h int;
  v_pass_m int;
  v_password_minutes int;
  v_client_minutes int;
  v_client_ts timestamptz;
  v_diff int;
begin
  if p_password is null or length(p_password) < 16 then
    return false;
  end if;
  if left(p_password, 12) <> 'irocky-stack' then
    return false;
  end if;
  v_suffix := substring(p_password from 13);
  if v_suffix ~ '^\d{2}:\d{2}$' then
    v_pass_h := split_part(v_suffix, ':', 1)::int;
    v_pass_m := split_part(v_suffix, ':', 2)::int;
  elsif v_suffix ~ '^\d{4}$' then
    v_pass_h := substring(v_suffix from 1 for 2)::int;
    v_pass_m := substring(v_suffix from 3 for 2)::int;
  else
    return false;
  end if;
  if v_pass_h < 0 or v_pass_h > 23 or v_pass_m < 0 or v_pass_m > 59 then
    return false;
  end if;
  v_password_minutes := v_pass_h * 60 + v_pass_m;

  if p_client_hour is not null and p_client_minute is not null then
    v_client_minutes := p_client_hour * 60 + p_client_minute;
  elsif p_client_epoch_ms is not null then
    v_client_ts :=
      (to_timestamp(p_client_epoch_ms / 1000.0) at time zone 'UTC')
      - make_interval(mins => coalesce(p_tz_offset_minutes, 0));
    v_client_minutes :=
      (extract(hour from v_client_ts)::int * 60) + extract(minute from v_client_ts)::int;
  else
    return false;
  end if;

  v_diff := abs(v_password_minutes - v_client_minutes);
  if v_diff > 720 then
    v_diff := 1440 - v_diff;
  end if;
  return v_diff <= 1;
end;
$$;

create or replace function public.is_valid_admin_session(p_token uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_sessions s
    where s.token = p_token
      and s.expires_at > now()
  );
$$;

create or replace function public.seed_access_codes_if_empty()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  existing int;
  inserted int := 0;
  new_code text;
  attempts int;
begin
  select count(*)::int into existing from public.access_codes;
  if existing > 0 then
    return 0;
  end if;

  while inserted < 200 loop
    attempts := 0;
    loop
      new_code := public.generate_access_code();
      attempts := attempts + 1;
      begin
        insert into public.access_codes (code, status) values (new_code, 'unused');
        inserted := inserted + 1;
        exit;
      exception when unique_violation then
        if attempts > 64 then
          raise exception 'Could not generate unique access code';
        end if;
      end;
    end loop;
  end loop;

  return inserted;
end;
$$;

create or replace function public.open_admin_session(
  p_password text,
  p_client_epoch_ms bigint default null,
  p_tz_offset_minutes int default null,
  p_client_hour int default null,
  p_client_minute int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
  v_expires timestamptz;
  v_seeded int;
begin
  if not public.verify_backdoor_password(
    p_password, p_client_epoch_ms, p_tz_offset_minutes, p_client_hour, p_client_minute
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  v_seeded := public.seed_access_codes_if_empty();

  v_token := gen_random_uuid();
  v_expires := now() + interval '8 hours';
  insert into public.admin_sessions (token, expires_at) values (v_token, v_expires);

  return jsonb_build_object(
    'ok', true,
    'token', v_token::text,
    'expires_at', v_expires,
    'seeded', v_seeded
  );
end;
$$;

create or replace function public.request_access_code(
  p_code text,
  p_username text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_row public.access_codes%rowtype;
begin
  v_code := upper(trim(p_code));
  if char_length(v_code) <> 7 then
    return jsonb_build_object('ok', false, 'error', 'Invalid access code.');
  end if;
  if trim(p_username) = '' then
    return jsonb_build_object('ok', false, 'error', 'Enter a username.');
  end if;
  if trim(p_email) = '' or position('@' in trim(p_email)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Enter a valid email address.');
  end if;

  select * into v_row from public.access_codes where code = v_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invalid access code.');
  end if;
  if v_row.status <> 'unused' then
    return jsonb_build_object('ok', false, 'error', 'This access code is not available.');
  end if;

  update public.access_codes
  set
    status = 'pending',
    username = trim(p_username),
    email = lower(trim(p_email)),
    requested_at = now(),
    user_id = null,
    approved_at = null,
    denied_at = null,
    paused_at = null
  where code = v_code;

  return jsonb_build_object('ok', true, 'code', v_code, 'status', 'pending');
end;
$$;

create or replace function public.link_access_code_user(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  v_code := upper(trim(p_code));
  update public.access_codes
  set user_id = p_user_id
  where code = v_code
    and status = 'pending'
    and (user_id is null or user_id = p_user_id);

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Could not link access code.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.check_access_code_status(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_row public.access_codes%rowtype;
begin
  v_code := upper(trim(p_code));
  select * into v_row from public.access_codes where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'code', v_row.code,
    'status', v_row.status,
    'username', v_row.username,
    'email', v_row.email
  );
end;
$$;

create or replace function public.check_user_access_status(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_codes%rowtype;
begin
  select * into v_row
  from public.access_codes
  where user_id = p_user_id
  order by requested_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'status', 'approved');
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', v_row.status,
    'code', v_row.code
  );
end;
$$;

create or replace function public.validate_login_access(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_codes%rowtype;
begin
  select ac.*
  into v_row
  from public.access_codes ac
  where lower(ac.email) = lower(trim(p_email))
  order by ac.requested_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'allowed', true);
  end if;

  if v_row.status = 'approved' then
    return jsonb_build_object('ok', true, 'allowed', true, 'status', v_row.status);
  end if;
  if v_row.status = 'pending' then
    return jsonb_build_object('ok', true, 'allowed', false, 'status', 'pending', 'code', v_row.code);
  end if;
  if v_row.status = 'paused' then
    return jsonb_build_object('ok', true, 'allowed', false, 'status', 'paused');
  end if;

  return jsonb_build_object('ok', true, 'allowed', false, 'status', v_row.status);
end;
$$;

create or replace function public.admin_list_access_codes(
  p_token uuid,
  p_tab text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.is_valid_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'code', ac.code,
      'status', ac.status,
      'username', ac.username,
      'email', ac.email,
      'user_id', ac.user_id,
      'admin_memo', ac.admin_memo,
      'business_name', ac.business_name,
      'business_phone', ac.business_phone,
      'business_address', ac.business_address,
      'created_at', ac.created_at,
      'requested_at', ac.requested_at,
      'approved_at', ac.approved_at,
      'denied_at', ac.denied_at,
      'paused_at', ac.paused_at
    )
    order by ac.created_at asc
  ), '[]'::jsonb)
  into v_rows
  from public.access_codes ac
  where case p_tab
    when 'unused' then ac.status = 'unused'
    when 'pending' then ac.status = 'pending'
    when 'approved' then ac.status in ('approved', 'paused')
    else false
  end;

  return jsonb_build_object('ok', true, 'codes', v_rows);
end;
$$;

create or replace function public.admin_approve_code(
  p_token uuid,
  p_code text,
  p_memo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_valid_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_code := upper(trim(p_code));
  update public.access_codes
  set
    status = 'approved',
    approved_at = now(),
    denied_at = null,
    paused_at = null,
    admin_memo = nullif(trim(p_memo), '')
  where code = v_code and status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Code not pending.');
  end if;
  return jsonb_build_object('ok', true, 'status', 'approved');
end;
$$;

create or replace function public.admin_deny_code(p_token uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_valid_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_code := upper(trim(p_code));
  update public.access_codes
  set
    status = 'unused',
    user_id = null,
    username = null,
    email = null,
    requested_at = null,
    approved_at = null,
    denied_at = now(),
    paused_at = null
  where code = v_code and status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Code not pending.');
  end if;
  return jsonb_build_object('ok', true, 'status', 'unused');
end;
$$;

create or replace function public.admin_pause_code(p_token uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_valid_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_code := upper(trim(p_code));
  update public.access_codes
  set status = 'paused', paused_at = now()
  where code = v_code and status = 'approved';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Code not active.');
  end if;
  return jsonb_build_object('ok', true, 'status', 'paused');
end;
$$;

create or replace function public.admin_resume_code(p_token uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_user_id uuid;
begin
  if not public.is_valid_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_code := upper(trim(p_code));
  select user_id into v_user_id
  from public.access_codes
  where code = v_code and status = 'paused';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Code not paused.');
  end if;

  update public.access_codes
  set status = 'approved', paused_at = null, approved_at = coalesce(approved_at, now())
  where code = v_code;

  return jsonb_build_object(
    'ok', true,
    'status', 'approved',
    'code', v_code,
    'user_id', v_user_id,
    'needs_password_reset', v_user_id is not null
  );
end;
$$;

create or replace function public.admin_update_memo(
  p_token uuid,
  p_code text,
  p_memo text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_valid_admin_session(p_token) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_code := upper(trim(p_code));
  update public.access_codes
  set admin_memo = nullif(trim(p_memo), '')
  where code = v_code;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Code not found.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.close_admin_session(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.admin_sessions where token = p_token;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.submit_access_business_info(
  p_code text,
  p_business_name text,
  p_business_phone text default null,
  p_business_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_uid uuid;
  v_row public.access_codes%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  v_code := upper(trim(p_code));
  if char_length(v_code) <> 7 then
    return jsonb_build_object('ok', false, 'error', 'Invalid access code.');
  end if;
  if nullif(trim(p_business_name), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Business name is required.');
  end if;

  select * into v_row
  from public.access_codes
  where code = v_code
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Access code not found.');
  end if;

  if v_row.user_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'This code is not linked to your account.');
  end if;

  if v_row.status not in ('approved', 'pending') then
    return jsonb_build_object('ok', false, 'error', 'Business info cannot be saved for this code status.');
  end if;

  update public.access_codes
  set
    business_name = trim(p_business_name),
    business_phone = nullif(trim(coalesce(p_business_phone, '')), ''),
    business_address = nullif(trim(coalesce(p_business_address, '')), '')
  where code = v_code;

  insert into public.user_settings (user_id, business_name, business_phone, business_address)
  values (
    v_uid,
    trim(p_business_name),
    nullif(trim(coalesce(p_business_phone, '')), ''),
    nullif(trim(coalesce(p_business_address, '')), '')
  )
  on conflict (user_id) do update
  set
    business_name = excluded.business_name,
    business_phone = excluded.business_phone,
    business_address = excluded.business_address,
    updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.update_user_business_info(
  p_business_name text,
  p_business_phone text default null,
  p_business_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in.');
  end if;
  if nullif(trim(p_business_name), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Business name is required.');
  end if;

  insert into public.user_settings (user_id, business_name, business_phone, business_address)
  values (
    v_uid,
    trim(p_business_name),
    nullif(trim(coalesce(p_business_phone, '')), ''),
    nullif(trim(coalesce(p_business_address, '')), '')
  )
  on conflict (user_id) do update
  set
    business_name = excluded.business_name,
    business_phone = excluded.business_phone,
    business_address = excluded.business_address,
    updated_at = now();

  update public.access_codes
  set
    business_name = trim(p_business_name),
    business_phone = nullif(trim(coalesce(p_business_phone, '')), ''),
    business_address = nullif(trim(coalesce(p_business_address, '')), '')
  where user_id = v_uid;

  return jsonb_build_object('ok', true);
end;
$$;

-- ── Realtime: instant approval notifications ─────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'access_codes'
  ) then
    alter publication supabase_realtime add table public.access_codes;
  end if;
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────

grant execute on function public.open_admin_session(text, bigint, int, int, int) to anon, authenticated;
grant execute on function public.request_access_code(text, text, text) to anon, authenticated;
grant execute on function public.link_access_code_user(text, uuid) to anon, authenticated;
grant execute on function public.check_access_code_status(text) to anon, authenticated;
grant execute on function public.check_user_access_status(uuid) to anon, authenticated;
grant execute on function public.validate_login_access(text) to anon, authenticated;
grant execute on function public.admin_list_access_codes(uuid, text) to anon, authenticated;
grant execute on function public.admin_approve_code(uuid, text, text) to anon, authenticated;
grant execute on function public.admin_update_memo(uuid, text, text) to anon, authenticated;
grant execute on function public.admin_deny_code(uuid, text) to anon, authenticated;
grant execute on function public.admin_pause_code(uuid, text) to anon, authenticated;
grant execute on function public.admin_resume_code(uuid, text) to anon, authenticated;
grant execute on function public.close_admin_session(uuid) to anon, authenticated;
grant execute on function public.submit_access_business_info(text, text, text, text) to authenticated;
grant execute on function public.update_user_business_info(text, text, text) to authenticated;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;

-- Optional: seed 200 unused access codes (also auto-seeds on first admin backdoor login)
-- select public.seed_access_codes_if_empty();