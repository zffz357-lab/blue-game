-- BLUE GAME CORE
-- Draft migration. DO NOT APPLY until frontend integration and data migration are reviewed.

create table if not exists public.shop_devices (
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id bigint not null,
  device_name text not null,
  device_type text not null default '',
  session jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, device_id)
);

create table if not exists public.shop_rates (
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_type text not null,
  hourly_price numeric not null check (hourly_price >= 0),
  primary key (owner_id, device_type)
);

create table if not exists public.shop_products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  price numeric not null check (price >= 0),
  active boolean not null default true,
  unique (owner_id, name)
);

create table if not exists public.shop_invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  invoice jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.worker_devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  worker_user_id uuid not null unique references auth.users(id) on delete cascade,
  device_label text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.worker_activation_codes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  code_hash bytea not null unique,
  device_label text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists shop_invoices_owner_date_idx
  on public.shop_invoices(owner_id, created_at desc);

create index if not exists worker_devices_owner_idx
  on public.worker_devices(owner_id);

create index if not exists worker_codes_owner_expiry_idx
  on public.worker_activation_codes(owner_id, expires_at);

alter table public.shop_devices enable row level security;
alter table public.shop_rates enable row level security;
alter table public.shop_products enable row level security;
alter table public.shop_invoices enable row level security;
alter table public.worker_devices enable row level security;
alter table public.worker_activation_codes enable row level security;

-- Remove direct access first. Access is granted explicitly below.
revoke all on public.shop_devices from anon, authenticated;
revoke all on public.shop_rates from anon, authenticated;
revoke all on public.shop_products from anon, authenticated;
revoke all on public.shop_invoices from anon, authenticated;
revoke all on public.worker_devices from anon, authenticated;
revoke all on public.worker_activation_codes from anon, authenticated;

grant select on public.shop_devices to authenticated;
grant select, insert, update, delete on public.shop_rates to authenticated;
grant select, insert, update, delete on public.shop_products to authenticated;
grant select on public.shop_invoices to authenticated;

-- Operational devices are visible to their owner and active workers only.
drop policy if exists shop_devices_read on public.shop_devices;
create policy shop_devices_read on public.shop_devices
for select to authenticated
using (
  owner_id = auth.uid()
  or exists (
    select 1 from public.worker_devices w
    where w.owner_id = shop_devices.owner_id
      and w.worker_user_id = auth.uid()
      and w.revoked_at is null
  )
);

-- Private management data: owner only.
drop policy if exists shop_rates_owner on public.shop_rates;
create policy shop_rates_owner on public.shop_rates
for all to authenticated
using (
  owner_id = auth.uid()
  and exists (select 1 from public.shop_data d where d.owner_id = auth.uid())
)
with check (
  owner_id = auth.uid()
  and exists (select 1 from public.shop_data d where d.owner_id = auth.uid())
);

drop policy if exists shop_products_owner on public.shop_products;
create policy shop_products_owner on public.shop_products
for all to authenticated
using (
  owner_id = auth.uid()
  and exists (select 1 from public.shop_data d where d.owner_id = auth.uid())
)
with check (
  owner_id = auth.uid()
  and exists (select 1 from public.shop_data d where d.owner_id = auth.uid())
);

drop policy if exists shop_invoices_owner on public.shop_invoices;
create policy shop_invoices_owner on public.shop_invoices
for select to authenticated
using (
  owner_id = auth.uid()
  and exists (select 1 from public.shop_data d where d.owner_id = auth.uid())
);

-- No direct access to worker identities or activation codes.
-- They are managed only through SECURITY DEFINER functions.

create or replace function public.is_shop_manager(p_owner uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shop_data d
    where d.owner_id = p_owner
  );
$$;

create or replace function public.is_active_shop_worker(p_owner uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.worker_devices w
    where w.owner_id = p_owner
      and w.worker_user_id = auth.uid()
      and w.revoked_at is null
  );
$$;

create or replace function public.create_worker_activation_code(
  p_device_label text
)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if auth.uid() is null or not public.is_shop_manager(auth.uid()) then
    raise exception 'manager_only';
  end if;

  v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));

  insert into public.worker_activation_codes
    (owner_id, code_hash, device_label, expires_at)
  values (
    auth.uid(),
    digest(v_code, 'sha256'),
    coalesce(nullif(trim(p_device_label), ''), 'هاتف عامل'),
    now() + interval '15 minutes'
  );

  return v_code;
end;
$$;

create or replace function public.activate_shop_worker(p_code text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_code public.worker_activation_codes%rowtype;
  v_worker_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  select * into v_code
  from public.worker_activation_codes
  where code_hash = digest(upper(trim(p_code)), 'sha256')
    and used_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'invalid_or_expired_code';
  end if;

  if public.is_shop_manager(auth.uid()) then
    raise exception 'manager_cannot_be_worker';
  end if;

  update public.worker_activation_codes
  set used_at = now()
  where id = v_code.id;

  insert into public.worker_devices
    (owner_id, worker_user_id, device_label)
  values
    (v_code.owner_id, auth.uid(), v_code.device_label)
  on conflict (worker_user_id) do update
    set owner_id = excluded.owner_id,
        device_label = excluded.device_label,
        revoked_at = null,
        last_seen_at = now()
  returning id into v_worker_id;

  return jsonb_build_object('ok', true, 'worker_device_id', v_worker_id);
end;
$$;

create or replace function public.revoke_shop_worker(p_worker_device_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_shop_manager(auth.uid()) then
    raise exception 'manager_only';
  end if;

  update public.worker_devices
  set revoked_at = now()
  where id = p_worker_device_id
    and owner_id = auth.uid();

  return found;
end;
$$;

create or replace function public.start_shop_session(
  p_device_id bigint,
  p_device_type text,
  p_mode text,
  p_duration_minutes integer default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_rate numeric;
  v_device public.shop_devices%rowtype;
  v_session jsonb;
begin
  if public.is_shop_manager(auth.uid()) then
    v_owner := auth.uid();
  else
    select owner_id into v_owner
    from public.worker_devices
    where worker_user_id = auth.uid()
      and revoked_at is null;
  end if;

  if v_owner is null then raise exception 'not_authorized'; end if;
  if p_mode not in ('fixed', 'open') then raise exception 'invalid_mode'; end if;
  if p_mode = 'fixed' and coalesce(p_duration_minutes, 0) < 1
    then raise exception 'invalid_duration'; end if;

  select hourly_price into v_rate
  from public.shop_rates
  where owner_id = v_owner and device_type = p_device_type;

  if v_rate is null then raise exception 'rate_not_configured'; end if;

  select * into v_device
  from public.shop_devices
  where owner_id = v_owner and device_id = p_device_id
  for update;

  if not found then raise exception 'device_not_found'; end if;
  if v_device.session is not null then raise exception 'device_busy'; end if;

  v_session := jsonb_build_object(
    'mode', p_mode,
    'startedAt', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
    'price', v_rate,
    'purchases', jsonb_build_array()
  );

  if p_mode = 'fixed' then
    v_session := v_session || jsonb_build_object(
      'durationMinutes', p_duration_minutes,
      'endsAt', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
        + p_duration_minutes * 60000,
      'fixedAmount', ceil(p_duration_minutes * v_rate / 60)
    );
  end if;

  update public.shop_devices
  set device_type = p_device_type,
      session = v_session,
      updated_at = now()
  where owner_id = v_owner and device_id = p_device_id;

  return v_session;
end;
$$;

create or replace function public.add_shop_purchase(
  p_device_id bigint,
  p_product_name text,
  p_quantity integer
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_price numeric;
  v_device public.shop_devices%rowtype;
  v_items jsonb;
begin
  if public.is_shop_manager(auth.uid()) then
    v_owner := auth.uid();
  else
    select owner_id into v_owner
    from public.worker_devices
    where worker_user_id = auth.uid() and revoked_at is null;
  end if;

  if v_owner is null then raise exception 'not_authorized'; end if;
  if p_quantity < 1 or p_quantity > 100 then raise exception 'invalid_quantity'; end if;

  select price into v_price
  from public.shop_products
  where owner_id = v_owner and name = p_product_name and active = true;

  if v_price is null then raise exception 'product_not_found'; end if;

  select * into v_device
  from public.shop_devices
  where owner_id = v_owner and device_id = p_device_id
  for update;

  if not found or v_device.session is null then raise exception 'session_not_active'; end if;

  v_items := coalesce(v_device.session->'purchases', '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
      'name', p_product_name,
      'price', v_price,
      'quantity', p_quantity
    ));

  update public.shop_devices
  set session = jsonb_set(v_device.session, '{purchases}', v_items),
      updated_at = now()
  where owner_id = v_owner and device_id = p_device_id;

  return v_items;
end;
$$;

create or replace function public.finish_shop_session(p_device_id bigint)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_device public.shop_devices%rowtype;
  v_session jsonb;
  v_purchases jsonb;
  v_minutes integer;
  v_play numeric;
  v_items_total numeric;
  v_total numeric;
  v_invoice jsonb;
begin
  if public.is_shop_manager(auth.uid()) then
    v_owner := auth.uid();
  else
    select owner_id into v_owner
    from public.worker_devices
    where worker_user_id = auth.uid() and revoked_at is null;
  end if;

  if v_owner is null then raise exception 'not_authorized'; end if;

  select * into v_device
  from public.shop_devices
  where owner_id = v_owner and device_id = p_device_id
  for update;

  if not found or v_device.session is null then raise exception 'session_not_active'; end if;

  v_session := v_device.session;
  v_purchases := coalesce(v_session->'purchases', '[]'::jsonb);

  v_minutes := greatest(1, ceil(
    (extract(epoch from clock_timestamp()) * 1000
      - (v_session->>'startedAt')::numeric) / 60000
  )::integer);

  if v_session->>'mode' = 'fixed' then
    v_play := (v_session->>'fixedAmount')::numeric;
  else
    v_play := ceil(v_minutes * (v_session->>'price')::numeric / 60);
  end if;

  select coalesce(sum(
    (item->>'price')::numeric * (item->>'quantity')::numeric
  ), 0)
  into v_items_total
  from jsonb_array_elements(v_purchases) item;

  v_total := v_play + v_items_total;

  v_invoice := jsonb_build_object(
    'id', gen_random_uuid(),
    'date', now(),
    'device', v_device.device_name,
    'type', v_device.device_type,
    'mode', v_session->>'mode',
    'duration', v_minutes,
    'playAmount', v_play,
    'purchases', v_purchases,
    'purchasesTotal', v_items_total,
    'grandTotal', v_total
  );

  insert into public.shop_invoices(owner_id, invoice)
  values (v_owner, v_invoice);

  update public.shop_devices
  set session = null, updated_at = now()
  where owner_id = v_owner and device_id = p_device_id;

  return v_invoice;
end;
$$;

revoke all on function public.is_shop_manager(uuid) from public, anon, authenticated;
revoke all on function public.is_active_shop_worker(uuid) from public, anon, authenticated;
revoke all on function public.create_worker_activation_code(text) from public, anon;
revoke all on function public.activate_shop_worker(text) from public, anon;
revoke all on function public.revoke_shop_worker(uuid) from public, anon;
revoke all on function public.start_shop_session(bigint,text,text,integer) from public, anon;
revoke all on function public.add_shop_purchase(bigint,text,integer) from public, anon;
revoke all on function public.finish_shop_session(bigint) from public, anon;

grant execute on function public.create_worker_activation_code(text) to authenticated;
grant execute on function public.activate_shop_worker(text) to authenticated;
grant execute on function public.revoke_shop_worker(uuid) to authenticated;
grant execute on function public.start_shop_session(bigint,text,text,integer) to authenticated;
grant execute on function public.add_shop_purchase(bigint,text,integer) to authenticated;
grant execute on function public.finish_shop_session(bigint) to authenticated;

-- Realtime only exposes operational station state, never invoices or private prices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shop_devices'
  ) then
    alter publication supabase_realtime add table public.shop_devices;
  end if;
exception when undefined_object then
  raise notice 'supabase_realtime publication not found; enable it in Supabase later';
end $$;
