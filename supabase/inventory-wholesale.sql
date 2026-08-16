-- Add wholesale list partition + grams on inventory items (safe to re-run)
alter table public.inventory_items
  add column if not exists wholesale_id text not null default 'wholesale-1';

alter table public.inventory_items
  add column if not exists grams numeric(12, 2) not null default 0;

create index if not exists inventory_items_user_wholesale_idx
  on public.inventory_items (user_id, wholesale_id);
