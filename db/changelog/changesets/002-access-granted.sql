alter table app_settings add column if not exists from_email   text;
alter table app_settings add column if not exists notify_email text;

insert into app_settings (id, notify_email) values (1, 'srujana.kalluru@outlook.com')
  on conflict (id) do update set notify_email = excluded.notify_email;

create or replace function public.send_email(p_to text, p_subject text, p_html text) returns void
  language plpgsql security definer set search_path = public as
$fn$
declare
  v_key text;
  v_from text;
begin
  begin
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key';
    if v_key is null or p_to is null then
      return;
    end if;
    select coalesce(from_email, 'Family Tree <onboarding@resend.dev>') into v_from from app_settings where id = 1;
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object('from', coalesce(v_from, 'Family Tree <onboarding@resend.dev>'), 'to', p_to, 'subject', p_subject, 'html', p_html)
    );
  exception when others then
    null;
  end;
end;
$fn$;

create or replace function public.send_access_email(p_first text, p_last text, p_email text) returns void
  language plpgsql security definer set search_path = public as
$fn$
declare
  v_owner text;
  v_app text;
  v_name text;
begin
  select coalesce(notify_email, owner_email), app_url into v_owner, v_app from app_settings where id = 1;
  if v_owner is null then
    return;
  end if;
  v_name := coalesce(nullif(btrim(coalesce(p_first, '') || ' ' || coalesce(p_last, '')), ''), 'Someone');
  perform public.send_email(
    v_owner,
    v_name || ' is requesting access to your family tree',
    '<p><strong>' || v_name || '</strong>' ||
    case when p_email is not null then ' (' || p_email || ')' else '' end ||
    ' is waiting for your approval. Open ' ||
    case when v_app is not null then '<a href="' || v_app || '">your family tree</a>' else 'your family tree app' end ||
    ', tap Members, and Approve.</p>'
  );
end;
$fn$;

create or replace function public.notify_access_granted() returns trigger
  language plpgsql security definer set search_path = public as
$fn$
declare
  v_app text;
begin
  if new.uuid is not null and new.email is not null and new.approved is true and old.approved is distinct from true then
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

drop trigger if exists notify_access_granted_trg on person;
create trigger notify_access_granted_trg after update on person for each row execute function public.notify_access_granted();
