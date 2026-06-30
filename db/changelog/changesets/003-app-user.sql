create table if not exists app_user (
  id                uuid primary key,
  email             text,
  first_name        text,
  last_name         text,
  approved          boolean not null default false,
  is_admin          boolean not null default false,
  last_requested_at timestamptz,
  created_at        timestamptz not null default now()
);

insert into app_user (id, email, first_name, last_name, approved, is_admin, last_requested_at)
  select uuid, email, first_name, last_name, approved, is_admin, last_requested_at
  from person where uuid is not null
  on conflict (id) do nothing;

delete from person where uuid is not null;

create or replace function public.is_approved() returns boolean
  language sql security definer set search_path = public stable as
$fn$ select exists (select 1 from app_user where id = auth.uid() and approved) $fn$;

create or replace function public.is_admin() returns boolean
  language sql security definer set search_path = public stable as
$fn$ select exists (select 1 from app_user where id = auth.uid() and is_admin) $fn$;

create or replace function public.bootstrap_owner() returns trigger
  language plpgsql security definer set search_path = public as
$fn$
begin
  new.email := auth.jwt() ->> 'email';
  if new.id = auth.uid() and new.email = (select owner_email from app_settings where id = 1) then
    new.approved := true;
    new.is_admin := true;
  else
    new.approved := false;
    new.is_admin := false;
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
  end if;
  return new;
end;
$fn$;

create or replace function public.notify_access_request() returns trigger
  language plpgsql security definer set search_path = public as
$fn$
begin
  if new.approved is not true then
    perform public.send_access_email(new.first_name, new.last_name, new.email);
  end if;
  return new;
end;
$fn$;

create or replace function public.notify_access_granted() returns trigger
  language plpgsql security definer set search_path = public as
$fn$
declare
  v_app text;
begin
  if new.email is not null and new.approved is true and old.approved is distinct from true then
    select app_url into v_app from app_settings where id = 1;
    perform public.send_email(
      new.email,
      'You are in - family tree access approved',
      '<p>Good news - your access to the family tree has been approved. Open ' ||
      case when v_app is not null then '<a href="' || v_app || '">the family tree</a>' else 'the family tree app' end ||
      ' and sign in.</p>'
    );
  end if;
  return new;
end;
$fn$;

create or replace function public.request_access() returns void
  language plpgsql security definer set search_path = public as
$fn$
declare
  u app_user;
begin
  select * into u from app_user where id = auth.uid();
  if u.id is null or u.approved is true then
    return;
  end if;
  if u.last_requested_at is not null and u.last_requested_at > now() - interval '30 minutes' then
    return;
  end if;
  update app_user set last_requested_at = now() where id = auth.uid();
  perform public.send_access_email(u.first_name, u.last_name, u.email);
end;
$fn$;

grant execute on function public.request_access() to authenticated;

drop trigger if exists bootstrap_owner_trg on person;
drop trigger if exists guard_person_flags_trg on person;
drop trigger if exists notify_access_request_trg on person;
drop trigger if exists notify_access_granted_trg on person;
drop function if exists public.guard_person_flags cascade;

drop trigger if exists bootstrap_owner_trg on app_user;
create trigger bootstrap_owner_trg before insert on app_user for each row execute function public.bootstrap_owner();
drop trigger if exists guard_user_flags_trg on app_user;
create trigger guard_user_flags_trg before update on app_user for each row execute function public.guard_user_flags();
drop trigger if exists notify_access_request_trg on app_user;
create trigger notify_access_request_trg after insert on app_user for each row execute function public.notify_access_request();
drop trigger if exists notify_access_granted_trg on app_user;
create trigger notify_access_granted_trg after update on app_user for each row execute function public.notify_access_granted();

alter table app_user enable row level security;
grant select, insert, update, delete on app_user to authenticated;
drop policy if exists app_user_select on app_user;
drop policy if exists app_user_insert on app_user;
drop policy if exists app_user_update on app_user;
create policy app_user_select on app_user for select to authenticated using (id = auth.uid() or public.is_admin());
create policy app_user_insert on app_user for insert to authenticated with check (id = auth.uid());
create policy app_user_update on app_user for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists person_select on person;
drop policy if exists person_insert on person;
drop policy if exists person_update on person;
drop policy if exists person_delete on person;
create policy person_select on person for select using (public.is_approved());
create policy person_insert on person for insert to authenticated with check (public.is_approved());
create policy person_update on person for update to authenticated using (public.is_approved()) with check (public.is_approved());
create policy person_delete on person for delete to authenticated using (public.is_approved());
