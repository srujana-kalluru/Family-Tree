insert into app_settings (id, owner_email, notify_email)
  values (1, 'creation.k.91@gmail.com', 'srujana.kalluru@gmail.com')
  on conflict (id) do update set owner_email = excluded.owner_email, notify_email = excluded.notify_email;
