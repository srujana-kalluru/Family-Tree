insert into app_settings (id, owner_email)
  values (1, 'creation.k.91@gmail.com')
  on conflict (id) do update set owner_email = excluded.owner_email;
