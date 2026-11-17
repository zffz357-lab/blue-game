create table if not exists public.shop_data (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  devices jsonb not null default '[]'::jsonb,
  invoices jsonb not null default '[]'::jsonb,
  inventory jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.shop_data enable row level security;

revoke all on public.shop_data from anon;
grant select, insert, update on public.shop_data to authenticated;

drop policy if exists "owner_select" on public.shop_data;
drop policy if exists "owner_insert" on public.shop_data;
drop policy if exists "owner_update" on public.shop_data;

create policy "owner_select"
on public.shop_data for select to authenticated
using (auth.uid() = owner_id);

create policy "owner_insert"
on public.shop_data for insert to authenticated
with check (auth.uid() = owner_id);

create policy "owner_update"
on public.shop_data for update to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);
