create table if not exists app_settings (
  id                smallint primary key default 1,
  default_person_id bigint references person(id) on delete set null,
  updated_by_email  text,
  updated_at        timestamptz default now(),
  constraint app_settings_single_row check (id = 1)
);

alter table app_settings enable row level security;

create policy "read app_settings"  on app_settings for select using (true);
create policy "write app_settings" on app_settings for all to authenticated using (true) with check (true);
