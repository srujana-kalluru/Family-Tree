insert into app_settings (id, owner_email, notify_email, from_email)
  values (1, 'creation.k.91@gmail.com', 'creation.k.91@gmail.com', 'hello@demomailtrap.com')
  on conflict (id) do update set owner_email = excluded.owner_email, notify_email = excluded.notify_email, from_email = excluded.from_email;
