insert into app_settings (id, owner_email)
  values (1, 'creation.k.91@gmail.com')
  on conflict (id) do update set owner_email = excluded.owner_email;

create or replace function public.send_access_email(p_first text, p_last text, p_email text) returns void
  language plpgsql security definer set search_path = public as
$fn$
declare
  v_to text;
  v_app text;
  v_name text;
begin
  select owner_email, app_url into v_to, v_app from app_settings where id = 1;
  if v_to is null then
    return;
  end if;
  v_name := coalesce(nullif(btrim(coalesce(p_first, '') || ' ' || coalesce(p_last, '')), ''), 'Someone');
  perform public.send_email(
    v_to,
    v_name || ' is requesting access to your family tree',
    '<p><strong>' || v_name || '</strong>' ||
    case when p_email is not null then ' (' || p_email || ')' else '' end ||
    ' is waiting for your approval. Open ' ||
    case when v_app is not null then '<a href="' || v_app || '">your family tree</a>' else 'your family tree app' end ||
    ', tap Members, and Approve.</p>'
  );
end;
$fn$;

alter table app_settings drop column if exists notify_email;
