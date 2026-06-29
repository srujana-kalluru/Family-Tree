create or replace function public.is_approved() returns boolean
  language sql security definer set search_path = public stable as
$fn$ select exists (select 1 from person where uuid = auth.uid() and approved) $fn$;

create or replace function public.is_admin() returns boolean
  language sql security definer set search_path = public stable as
$fn$ select exists (select 1 from person where uuid = auth.uid() and is_admin) $fn$;

create or replace function public.bootstrap_owner() returns trigger
  language plpgsql security definer set search_path = public as
$fn$
begin
  if new.uuid is not null then
    new.email := auth.jwt() ->> 'email';
    if new.uuid = auth.uid() and new.email = (select owner_email from app_settings where id = 1) then
      new.approved := true;
      new.is_admin := true;
    else
      new.approved := false;
      new.is_admin := false;
    end if;
  end if;
  return new;
end;
$fn$;

create or replace function public.guard_person_flags() returns trigger
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
