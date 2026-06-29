alter table person add column if not exists approved boolean not null default false;
alter table person add column if not exists is_admin boolean not null default false;
alter table app_settings add column if not exists owner_email text;

insert into app_settings (id, owner_email) values (1, 'srujana.kalluru@gmail.com')
  on conflict (id) do update set owner_email = excluded.owner_email;

update person set approved = true, is_admin = true
  where uuid is not null and email = (select owner_email from app_settings where id = 1);
