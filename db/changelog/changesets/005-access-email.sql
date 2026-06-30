alter table app_settings add column if not exists app_url text;

create or replace function public.notify_access_request() returns trigger
  language plpgsql security definer set search_path = public as
$fn$
declare
  v_key text;
  v_owner text;
  v_app text;
  v_name text;
begin
  if new.uuid is null or new.approved is true then
    return new;
  end if;
  begin
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key';
    select owner_email, app_url into v_owner, v_app from app_settings where id = 1;
    if v_key is null or v_owner is null then
      return new;
    end if;
    v_name := coalesce(nullif(btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), ''), 'Someone');
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', 'Family Tree <onboarding@resend.dev>',
        'to', v_owner,
        'subject', v_name || ' is requesting access to your family tree',
        'html', '<p><strong>' || v_name || '</strong>' ||
                case when new.email is not null then ' (' || new.email || ')' else '' end ||
                ' just signed in and is waiting for your approval. Open ' ||
                case when v_app is not null then '<a href="' || v_app || '">your family tree</a>' else 'your family tree app' end ||
                ', tap Members, and Approve.</p>'
      )
    );
  exception when others then
    null;
  end;
  return new;
end;
$fn$;

drop trigger if exists notify_access_request_trg on person;
create trigger notify_access_request_trg after insert on person for each row execute function public.notify_access_request();
