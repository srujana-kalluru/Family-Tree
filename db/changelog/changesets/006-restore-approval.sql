create or replace function public.send_email(p_to text, p_subject text, p_html text) returns void
  language plpgsql security definer set search_path = public as
$fn$
declare
  v_key text;
  v_from text;
begin
  begin
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'email_api_key';
    if v_key is null or p_to is null then
      return;
    end if;
    select coalesce(from_email, owner_email) into v_from from app_settings where id = 1;
    if v_from is null then
      return;
    end if;
    perform net.http_post(
      url := 'https://api.sendgrid.com/v3/mail/send',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'personalizations', jsonb_build_array(jsonb_build_object('to', jsonb_build_array(jsonb_build_object('email', p_to)))),
        'from', jsonb_build_object('email', v_from, 'name', 'Family Tree'),
        'subject', p_subject,
        'content', jsonb_build_array(jsonb_build_object('type', 'text/html', 'value', p_html))
      )
    );
  exception when others then
    null;
  end;
end;
$fn$;

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

drop trigger if exists notify_new_user_trg on app_user;
drop trigger if exists bootstrap_owner_trg on app_user;
create trigger bootstrap_owner_trg before insert on app_user for each row execute function public.bootstrap_owner();
drop trigger if exists guard_user_flags_trg on app_user;
create trigger guard_user_flags_trg before update on app_user for each row execute function public.guard_user_flags();
drop trigger if exists notify_access_request_trg on app_user;
create trigger notify_access_request_trg after insert on app_user for each row execute function public.notify_access_request();
drop trigger if exists notify_access_granted_trg on app_user;
create trigger notify_access_granted_trg after update on app_user for each row execute function public.notify_access_granted();

drop policy if exists person_select on person;
drop policy if exists person_insert on person;
drop policy if exists person_update on person;
drop policy if exists person_delete on person;
create policy person_select on person for select using (public.is_approved());
create policy person_insert on person for insert to authenticated with check (public.is_approved());
create policy person_update on person for update to authenticated using (public.is_approved()) with check (public.is_approved());
create policy person_delete on person for delete to authenticated using (public.is_approved());

drop policy if exists marriage_select on marriage;
drop policy if exists marriage_write on marriage;
drop policy if exists marriage_rw on marriage;
create policy marriage_rw on marriage for all to authenticated using (public.is_approved()) with check (public.is_approved());

drop policy if exists parent_child_select on parent_child;
drop policy if exists parent_child_write on parent_child;
drop policy if exists parent_child_rw on parent_child;
create policy parent_child_rw on parent_child for all to authenticated using (public.is_approved()) with check (public.is_approved());

drop policy if exists app_settings_select on app_settings;
drop policy if exists app_settings_write on app_settings;
create policy app_settings_select on app_settings for select to authenticated using (public.is_approved());
create policy app_settings_write on app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists app_user_select on app_user;
drop policy if exists app_user_insert on app_user;
drop policy if exists app_user_update on app_user;
create policy app_user_select on app_user for select to authenticated using (id = auth.uid() or public.is_admin());
create policy app_user_insert on app_user for insert to authenticated with check (id = auth.uid());
create policy app_user_update on app_user for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop function if exists public.can_edit();
drop function if exists public.can_view();
drop function if exists public.notify_new_user() cascade;

update app_settings set from_email = null where id = 1;

alter table app_user disable trigger guard_user_flags_trg;
update app_user set approved = false where coalesce(is_admin, false) = false;
alter table app_user enable trigger guard_user_flags_trg;
