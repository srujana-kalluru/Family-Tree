alter table app_settings add column if not exists allow_signups boolean not null default true;
alter table app_settings add column if not exists read_only     boolean not null default false;
alter table app_user      add column if not exists blocked       boolean not null default false;

create or replace function public.is_approved() returns boolean
  language sql security definer set search_path = public stable as
$fn$ select exists (select 1 from app_user where id = auth.uid() and approved and not blocked) $fn$;

create or replace function public.is_admin() returns boolean
  language sql security definer set search_path = public stable as
$fn$ select exists (select 1 from app_user where id = auth.uid() and is_admin and not blocked) $fn$;

create or replace function public.can_view() returns boolean
  language sql security definer set search_path = public stable as
$fn$ select auth.uid() is not null and not exists (select 1 from app_user where id = auth.uid() and blocked) $fn$;

create or replace function public.can_edit() returns boolean
  language sql security definer set search_path = public stable as
$fn$ select public.is_admin() or (public.is_approved() and not coalesce((select read_only from app_settings where id = 1), false)) $fn$;

create or replace function public.bootstrap_owner() returns trigger
  language plpgsql security definer set search_path = public as
$fn$
begin
  new.email := auth.jwt() ->> 'email';
  if new.id = auth.uid() and new.email = (select owner_email from app_settings where id = 1) then
    new.approved := true;
    new.is_admin := true;
    new.blocked := false;
  else
    new.approved := coalesce((select allow_signups from app_settings where id = 1), true);
    new.is_admin := false;
    new.blocked := false;
  end if;
  return new;
end;
$fn$;

create or replace function public.guard_user_flags() returns trigger
  language plpgsql security definer set search_path = public as
$fn$
begin
  if not public.is_admin() then
    new.approved := old.approved;
    new.is_admin := old.is_admin;
    new.blocked := old.blocked;
  end if;
  return new;
end;
$fn$;

create or replace function public.notify_new_user() returns trigger
  language plpgsql security definer set search_path = public as
$fn$
declare
  v_to text;
  v_app text;
  v_name text;
  v_level text;
begin
  select coalesce(notify_email, owner_email), app_url into v_to, v_app from app_settings where id = 1;
  if v_to is null then
    return new;
  end if;
  v_name := coalesce(nullif(btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), ''), 'Someone');
  v_level := case when new.approved then 'can view and edit it' else 'can view it' end;
  perform public.send_email(
    v_to,
    v_name || ' just signed in to your family tree',
    '<p><strong>' || v_name || '</strong>' ||
    case when new.email is not null then ' (' || new.email || ')' else '' end ||
    ' just signed in and ' || v_level || '. If you do not recognise them, open ' ||
    case when v_app is not null then '<a href="' || v_app || '">your family tree</a>' else 'your family tree app' end ||
    ' and remove them from Members.</p>'
  );
  return new;
end;
$fn$;

drop function if exists public.request_access() cascade;

drop trigger if exists bootstrap_owner_trg on app_user;
create trigger bootstrap_owner_trg before insert on app_user for each row execute function public.bootstrap_owner();
drop trigger if exists guard_user_flags_trg on app_user;
create trigger guard_user_flags_trg before update on app_user for each row execute function public.guard_user_flags();
drop trigger if exists notify_access_request_trg on app_user;
drop trigger if exists notify_access_granted_trg on app_user;
drop trigger if exists notify_new_user_trg on app_user;
create trigger notify_new_user_trg after insert on app_user for each row execute function public.notify_new_user();

drop policy if exists person_select on person;
drop policy if exists person_insert on person;
drop policy if exists person_update on person;
drop policy if exists person_delete on person;
create policy person_select on person for select to authenticated using (public.can_view());
create policy person_insert on person for insert to authenticated with check (public.can_edit());
create policy person_update on person for update to authenticated using (public.can_edit()) with check (public.can_edit());
create policy person_delete on person for delete to authenticated using (public.can_edit());

drop policy if exists marriage_rw on marriage;
drop policy if exists marriage_select on marriage;
drop policy if exists marriage_write on marriage;
create policy marriage_select on marriage for select to authenticated using (public.can_view());
create policy marriage_write on marriage for all to authenticated using (public.can_edit()) with check (public.can_edit());

drop policy if exists parent_child_rw on parent_child;
drop policy if exists parent_child_select on parent_child;
drop policy if exists parent_child_write on parent_child;
create policy parent_child_select on parent_child for select to authenticated using (public.can_view());
create policy parent_child_write on parent_child for all to authenticated using (public.can_edit()) with check (public.can_edit());

drop policy if exists app_settings_select on app_settings;
drop policy if exists app_settings_write on app_settings;
create policy app_settings_select on app_settings for select to authenticated using (public.can_view());
create policy app_settings_write on app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists app_user_select on app_user;
drop policy if exists app_user_insert on app_user;
drop policy if exists app_user_update on app_user;
create policy app_user_select on app_user for select to authenticated using (id = auth.uid() or public.is_admin());
create policy app_user_insert on app_user for insert to authenticated with check (id = auth.uid());
create policy app_user_update on app_user for update to authenticated using (public.is_admin()) with check (public.is_admin());
