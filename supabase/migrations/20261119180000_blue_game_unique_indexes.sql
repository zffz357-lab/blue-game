create unique index if not exists shop_devices_owner_device_uidx
on public.shop_devices(owner_id, device_id);

create unique index if not exists shop_rates_owner_type_uidx
on public.shop_rates(owner_id, device_type);

create unique index if not exists shop_products_owner_name_uidx
on public.shop_products(owner_id, name);

create unique index if not exists worker_devices_user_uidx
on public.worker_devices(worker_user_id);
