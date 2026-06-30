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
      url := 'https://send.api.mailtrap.io/api/send',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', jsonb_build_object('email', v_from, 'name', 'Family Tree'),
        'to', jsonb_build_array(jsonb_build_object('email', p_to)),
        'subject', p_subject,
        'html', p_html
      )
    );
  exception when others then
    null;
  end;
end;
$fn$;
