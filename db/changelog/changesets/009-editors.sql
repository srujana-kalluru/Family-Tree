-- One row per editor, keyed by their auth UUID. Names/emails live here instead of being copied onto every person.
create table if not exists app_user (
  id         uuid primary key,
  name       text,
  email      text,
  updated_at timestamptz not null default now()
);
alter table app_user enable row level security;
drop policy if exists "read app_user" on app_user;
create policy "read app_user" on app_user for select using (true);
drop policy if exists "insert own app_user" on app_user;
create policy "insert own app_user" on app_user for insert with check (auth.uid() = id);
drop policy if exists "update own app_user" on app_user;
create policy "update own app_user" on app_user for update using (auth.uid() = id);

-- Backfill from the denormalised columns currently on person, so historical editors keep their names.
insert into app_user (id, name, email)
  select distinct created_by, created_by_name, created_by_email from person where created_by is not null
  on conflict (id) do nothing;
insert into app_user (id, name, email)
  select distinct updated_by, updated_by_name, updated_by_email from person where updated_by is not null
  on conflict (id) do update set
    name  = coalesce(app_user.name,  excluded.name),
    email = coalesce(app_user.email, excluded.email);

-- created_by / updated_by stay as UUIDs and are now resolved through app_user. The old per-row name/email
-- columns on person are left in place but unused; a follow-up migration can drop them once this build is live
-- (dropping them in the same deploy could briefly break the previous build that still reads them).
