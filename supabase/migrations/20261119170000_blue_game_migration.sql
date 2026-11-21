-- BLUE GAME: legacy data migration and manager setup
-- Safe to run repeatedly. Does not delete or modify shop_data.

create or replace function public.bootstrap_shop_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_row public.shop_data%rowtype;
  v_device jsonb;
  v_invoice jsonb;
  v_purchase jsonb;
  v_devices_count integer := 0;
  v_invoices_count integer := 0;
begin
  if v_owner is null or not public.is_shop_manager(v_owner) then
    raise exception 'manager_only';
  end if;

  select * into v_row
  from public.shop_data
  where owner_id = v_owner;

  -- Preserve device definitions and active sessions.
  for v_device in
    select value from jsonb_array_elements(
      coalesce(v_row.devices, '[]'::jsonb)
    )
  loop
    insert into public.shop_devices
      (owner_id, device_id, device_name, device_type, session)
    values (
      v_owner,
      (v_device->>'id')::bigint,
      coalesce(v_device->>'name', 'جهاز'),
      coalesce(v_device->>'type', ''),
      case
        when coalesce(v_device->'session', 'null'::jsonb) = 'null'::jsonb
          then null
        else v_device->'session'
      end
    )
    on conflict (owner_id, device_id) do update
      set device_name = excluded.device_name,
          device_type = excluded.device_type,
          session = excluded.session,
          updated_at = now();

    v_devices_count := v_devices_count + 1;

    if coalesce(v_device->>'type', '') <> ''
       and coalesce((v_device->>'price')::numeric, 0) > 0 then
      insert into public.shop_rates(owner_id, device_type, hourly_price)
      values (
        v_owner,
        v_device->>'type',
        (v_device->>'price')::numeric
      )
      on conflict (owner_id, device_type) do nothing;
    end if;

    for v_purchase in
      select value
      from jsonb_array_elements(
        coalesce(v_device->'session'->'purchases', '[]'::jsonb)
      )
    loop
      if coalesce(v_purchase->>'name', '') <> ''
         and coalesce((v_purchase->>'price')::numeric, 0) >= 0 then
        insert into public.shop_products(owner_id, name, price)
        values (
          v_owner,
          v_purchase->>'name',
          (v_purchase->>'price')::numeric
        )
        on conflict (owner_id, name) do nothing;
      end if;
    end loop;
  end loop;

  -- Historical invoices are intentionally not migrated.

  insert into public.shop_rates(owner_id, device_type, hourly_price)
  values
    (v_owner, 'ثنائي', 10000),
    (v_owner, 'ثلاثي', 15000),
    (v_owner, 'رباعي', 18000)
  on conflict (owner_id, device_type) do nothing;

  -- Seed the current shop menu only when a product is missing.
  insert into public.shop_products(owner_id, name, price)
  values
    (v_owner, 'ميلو', 5000),
    (v_owner, 'شاي', 2500),
    (v_owner, 'قهوة', 4000),
    (v_owner, 'ثلاثة بواحد', 5000),
    (v_owner, 'إندومي', 8000),
    (v_owner, 'أركيلة - تفاحتين نخلة', 20000),
    (v_owner, 'أركيلة - علكة', 20000),
    (v_owner, 'أركيلة - بولو', 20000)
  on conflict (owner_id, name) do nothing;

  return jsonb_build_object(
    'ok', true,
    'devices_copied', v_devices_count,
    'new_invoices_copied', v_invoices_count
  );
end;
$$;

create or replace function public.add_shop_device(
  p_device_id bigint,
  p_device_name text,
  p_device_type text default 'ثنائي'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_rate numeric;
begin
  if v_owner is null or not public.is_shop_manager(v_owner) then
    raise exception 'manager_only';
  end if;

  select hourly_price into v_rate
  from public.shop_rates
  where owner_id = v_owner and device_type = p_device_type;

  if v_rate is null then
    raise exception 'rate_not_configured';
  end if;

  insert into public.shop_devices
    (owner_id, device_id, device_name, device_type, session)
  values (v_owner, p_device_id, p_device_name, p_device_type, null);

  return jsonb_build_object(
    'id', p_device_id,
    'name', p_device_name,
    'type', p_device_type
  );
end;
$$;

create or replace function public.list_shop_workers()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_shop_manager(auth.uid()) then
    raise exception 'manager_only';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'label', device_label,
      'created_at', created_at,
      'last_seen_at', last_seen_at,
      'revoked_at', revoked_at
    ) order by created_at)
    from public.worker_devices
    where owner_id = auth.uid()
  ), '[]'::jsonb);
end;
$$;

-- Ensure pgcrypto digest is resolved from the public extension schema.
create or replace function public.create_worker_activation_code(
  p_device_label text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
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
language plpgsql
security definer
set search_path = public, pg_temp
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

revoke all on function public.bootstrap_shop_data() from public, anon;
revoke all on function public.add_shop_device(bigint,text,text) from public, anon;
revoke all on function public.list_shop_workers() from public, anon;

grant execute on function public.bootstrap_shop_data() to authenticated;
grant execute on function public.add_shop_device(bigint,text,text) to authenticated;
grant execute on function public.list_shop_workers() to authenticated;
grant execute on function public.create_worker_activation_code(text) to authenticated;
grant execute on function public.activate_shop_worker(text) to authenticated;
