-- iCalc POS — paste this entire file into Supabase SQL Editor, then Run.
-- Project: Dashboard → SQL Editor → New query → paste → Run

-- Extensions
create extension if not exists "pgcrypto";

-- ── Inventory ────────────────────────────────────────────────────────────────
create table if not exists public.inventory_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade,
  name          text not null,
  stock         integer not null default 0 check (stock >= 0),
  price         numeric(12, 2) not null default 0,
  threshold     integer not null default 10,
  category      text not null default 'General',
  supplier      text,
  image_url     text,
  date_added    timestamptz not null default now(),
  last_stocked  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Purchases / transactions ─────────────────────────────────────────────────
create table if not exists public.purchases (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  item_name   text not null,
  quantity    integer not null default 1 check (quantity > 0),
  price       numeric(12, 2) not null,
  total       numeric(12, 2) not null,
  purchased_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- ── Invoices ───────────────────────────────────────────────────────────────
create table if not exists public.invoices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  name        text not null,
  is_current  boolean not null default false,
  total       numeric(12, 2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.invoice_line_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  item_name   text,
  price       numeric(12, 2) not null,
  quantity    integer not null default 1 check (quantity > 0),
  created_at  timestamptz not null default now()
);

create table if not exists public.invoice_action_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade,
  invoice_name  text not null,
  message       text not null,
  item_name     text,
  price         numeric(12, 2) not null default 0,
  quantity      integer not null default 1,
  logged_at     timestamptz not null default now()
);

-- ── Requests (restock / procurement) ─────────────────────────────────────────
create table if not exists public.requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  name        text not null,
  notes       text,
  status      text not null default 'pending'
                check (status in ('pending', 'delivered', 'outofstock')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Calculator history ───────────────────────────────────────────────────────
create table if not exists public.calc_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  expression  text not null,
  result      text not null,
  created_at  timestamptz not null default now()
);

-- ── Updated-at trigger ───────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inventory_items_updated_at on public.inventory_items;
create trigger inventory_items_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

drop trigger if exists invoices_updated_at on public.invoices;
create trigger invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

drop trigger if exists requests_updated_at on public.requests;
create trigger requests_updated_at
  before update on public.requests
  for each row execute function public.set_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.inventory_items      enable row level security;
alter table public.purchases            enable row level security;
alter table public.invoices             enable row level security;
alter table public.invoice_line_items   enable row level security;
alter table public.invoice_action_logs  enable row level security;
alter table public.requests             enable row level security;
alter table public.calc_history         enable row level security;

-- Authenticated users: own rows only
create policy "inventory_select_own" on public.inventory_items for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "inventory_insert_own" on public.inventory_items for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "inventory_update_own" on public.inventory_items for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "inventory_delete_own" on public.inventory_items for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "purchases_select_own" on public.purchases for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "purchases_insert_own" on public.purchases for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "invoices_select_own" on public.invoices for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "invoices_insert_own" on public.invoices for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "invoices_update_own" on public.invoices for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "invoices_delete_own" on public.invoices for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "invoice_lines_select_own" on public.invoice_line_items for select to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and i.user_id = (select auth.uid())
  ));
create policy "invoice_lines_insert_own" on public.invoice_line_items for insert to authenticated
  with check (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and i.user_id = (select auth.uid())
  ));
create policy "invoice_lines_update_own" on public.invoice_line_items for update to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and i.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and i.user_id = (select auth.uid())
  ));
create policy "invoice_lines_delete_own" on public.invoice_line_items for delete to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and i.user_id = (select auth.uid())
  ));

create policy "invoice_logs_select_own" on public.invoice_action_logs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "invoice_logs_insert_own" on public.invoice_action_logs for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "requests_select_own" on public.requests for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "requests_insert_own" on public.requests for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "requests_update_own" on public.requests for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "requests_delete_own" on public.requests for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "calc_history_select_own" on public.calc_history for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "calc_history_insert_own" on public.calc_history for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Grant API access (required if Data API does not auto-expose new tables)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;