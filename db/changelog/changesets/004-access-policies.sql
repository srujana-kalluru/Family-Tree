drop policy if exists "read person" on person;
drop policy if exists "write person" on person;
drop policy if exists "read marriage" on marriage;
drop policy if exists "write marriage" on marriage;
drop policy if exists "read parent_child" on parent_child;
drop policy if exists "write parent_child" on parent_child;
drop policy if exists "read app_settings" on app_settings;
drop policy if exists "write app_settings" on app_settings;

drop policy if exists person_select on person;
drop policy if exists person_insert on person;
drop policy if exists person_update on person;
drop policy if exists person_delete on person;
create policy person_select on person for select using (public.is_approved() or uuid = auth.uid());
create policy person_insert on person for insert to authenticated with check (public.is_approved() or uuid = auth.uid());
create policy person_update on person for update to authenticated using (public.is_approved()) with check (public.is_approved());
create policy person_delete on person for delete to authenticated using (public.is_approved());

drop policy if exists marriage_rw on marriage;
drop policy if exists parent_child_rw on parent_child;
create policy marriage_rw on marriage for all to authenticated using (public.is_approved()) with check (public.is_approved());
create policy parent_child_rw on parent_child for all to authenticated using (public.is_approved()) with check (public.is_approved());

drop policy if exists app_settings_select on app_settings;
drop policy if exists app_settings_write on app_settings;
create policy app_settings_select on app_settings for select to authenticated using (public.is_approved());
create policy app_settings_write on app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists bootstrap_owner_trg on person;
create trigger bootstrap_owner_trg before insert on person for each row execute function public.bootstrap_owner();
drop trigger if exists guard_person_flags_trg on person;
create trigger guard_person_flags_trg before update on person for each row execute function public.guard_person_flags();
