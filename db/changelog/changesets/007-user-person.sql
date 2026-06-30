create table if not exists user_person (
  user_id    uuid        primary key references app_user(id) on delete cascade,
  person_id  bigint      not null references person(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table user_person enable row level security;
grant select, insert, update, delete on user_person to authenticated;

drop policy if exists user_person_select on user_person;
drop policy if exists user_person_insert on user_person;
drop policy if exists user_person_update on user_person;
drop policy if exists user_person_delete on user_person;
create policy user_person_select on user_person for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy user_person_insert on user_person for insert to authenticated with check (user_id = auth.uid() or public.is_admin());
create policy user_person_update on user_person for update to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy user_person_delete on user_person for delete to authenticated using (user_id = auth.uid() or public.is_admin());
