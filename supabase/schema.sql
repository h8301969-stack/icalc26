-- iCalc POS — paste this entire file into Supabase SQL Editor, then Run.
-- Project: Dashboard → SQL Editor → New query → paste → Run
--
-- Safe to re-run: tables use IF NOT EXISTS; policies/triggers are dropped first.
-- Mirrors app types in types.ts, hooks/, utils/auth.ts, and localStorage keys.
-- Auth: Supabase auth.users (replaces local icalc_accounts / icalc_auth_session).

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
  invoice_switcher_grid_cols integer not null default 3
                            check (invoice_switcher_grid_cols in (3, 4)),
  expression_view_mode    text not null default 'auto'
                            check (expression_view_mode in ('auto', 'list')),
  receipt_layout_mode     text not null default 'summary'
                            check (receipt_layout_mode in ('summary', 'full')),
  standby_timer_seconds   integer not null default 0,
  active_profile_id       uuid references public.user_profiles(id) on delete set null,
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

-- Username → email lookup for sign-in (anon-safe, no password data exposed)
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

-- Grant API access (required if Data API does not auto-expose new tables)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;