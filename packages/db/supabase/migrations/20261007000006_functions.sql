-- Funciones que la app llama por RPC y el hook de registro por invitación.

-- Registro solo por invitación (Auth Hook "Before User Created").
-- Se activa en supabase/config.toml o en el panel de Supabase.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if user_email <> '' and (
    exists (select 1 from public.platform_admins a where a.email = user_email)
    or exists (
      select 1 from public.invitations i
      where i.email = user_email and i.accepted_at is null and i.expires_at > now()
    )
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'El registro es solo por invitación. Pide un enlace de invitación.'
    )
  );
end;
$$;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

create or replace function public.hash_invitation_token(token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(token, 'UTF8')), 'hex')
$$;

-- Vista previa de una invitación para la página /invite/[token] (sin sesión).
create or replace function public.invitation_preview(token text)
returns table (
  kind public.invitation_kind,
  workspace_name text,
  role public.workspace_role,
  email_hint text,
  expired boolean,
  accepted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.kind, w.name, i.role,
    left(i.email, 2) || '***@' || split_part(i.email, '@', 2),
    i.expires_at <= now(), i.accepted_at is not null
  from public.invitations i
  left join public.workspaces w on w.id = i.workspace_id
  where i.token_hash = public.hash_invitation_token(token)
$$;
grant execute on function public.invitation_preview(text) to anon, authenticated;

create or replace function public.create_workspace_for(owner uuid, workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  insert into public.workspaces (name, created_by)
  values (coalesce(nullif(trim(workspace_name), ''), 'Mi espacio'), owner)
  returning id into ws;
  insert into public.memberships (workspace_id, user_id, role) values (ws, owner, 'owner');
  return ws;
end;
$$;
revoke execute on function public.create_workspace_for(uuid, text) from public, anon, authenticated;

-- Acepta una invitación con el correo de la sesión. Devuelve el espacio.
create or replace function public.accept_invitation(token text, workspace_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invitations;
  me uuid := auth.uid();
  my_email text;
  ws uuid;
begin
  if me is null then
    raise exception 'Inicia sesión para aceptar la invitación' using errcode = '42501';
  end if;
  select p.email into my_email from public.profiles p where p.id = me;

  select * into inv from public.invitations i
  where i.token_hash = public.hash_invitation_token(token)
  for update;

  if inv.id is null then
    raise exception 'Invitación no encontrada' using errcode = 'P0002';
  end if;
  if inv.accepted_at is not null then
    raise exception 'Esta invitación ya fue usada' using errcode = '23505';
  end if;
  if inv.expires_at <= now() then
    raise exception 'La invitación venció' using errcode = '22023';
  end if;
  if inv.email <> my_email then
    raise exception 'La invitación es para otro correo' using errcode = '42501';
  end if;

  if inv.kind = 'platform' then
    ws := public.create_workspace_for(me, workspace_name);
  else
    ws := inv.workspace_id;
    insert into public.memberships (workspace_id, user_id, role, channel_ids)
    values (ws, me, inv.role, inv.channel_ids)
    on conflict (workspace_id, user_id)
      do update set role = excluded.role, channel_ids = excluded.channel_ids;
  end if;

  update public.invitations set accepted_at = now(), accepted_by = me where id = inv.id;
  return ws;
end;
$$;
revoke execute on function public.accept_invitation(text, text) from public, anon;
grant execute on function public.accept_invitation(text, text) to authenticated;

-- Un administrador de la plataforma puede crear espacios propios sin invitación.
create or replace function public.create_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo con invitación' using errcode = '42501';
  end if;
  return public.create_workspace_for(auth.uid(), workspace_name);
end;
$$;
revoke execute on function public.create_workspace(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;

-- Estado de la conexión de YouTube sin exponer los tokens.
create or replace function public.channel_connection_info(ch uuid)
returns table (
  status public.connection_status,
  scopes text[],
  last_verified_at timestamptz,
  last_synced_at timestamptz,
  last_error text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.status, c.scopes, c.last_verified_at, c.last_synced_at, c.last_error
  from public.channel_connections c
  where c.channel_id = ch and public.has_channel_permission(ch, 'read')
$$;
revoke execute on function public.channel_connection_info(uuid) from public, anon;
grant execute on function public.channel_connection_info(uuid) to authenticated;

create or replace function public.regenerate_ics_token(ch uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.has_channel_permission(ch, 'configure_channel') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  update public.channels set ics_token = new_token where id = ch;
  return new_token;
end;
$$;
revoke execute on function public.regenerate_ics_token(uuid) from public, anon;
grant execute on function public.regenerate_ics_token(uuid) to authenticated;

-- Reglas de retención de datos de YouTube:
--  * títulos y descripciones sin refrescar en 30 días se borran;
--  * canales desconectados pierden sus datos de YouTube (máximo 7 días).
create or replace function public.purge_youtube_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale integer;
  disconnected integer;
begin
  update public.youtube_videos
  set title = null, description = null
  where fetched_at < now() - interval '30 days' and (title is not null or description is not null);
  get diagnostics stale = row_count;

  with gone as (
    select id from public.channels where disconnected_at is not null
  ), d1 as (
    delete from public.youtube_videos v using gone where v.channel_id = gone.id returning 1
  ), d2 as (
    delete from public.youtube_video_daily_stats s using gone where s.channel_id = gone.id returning 1
  )
  select (select count(*) from d1) + (select count(*) from d2) into disconnected;

  return jsonb_build_object('stale_cleared', stale, 'disconnected_deleted', disconnected);
end;
$$;
revoke execute on function public.purge_youtube_data() from public, anon, authenticated;
grant execute on function public.purge_youtube_data() to service_role;

-- Progreso en vivo de episodios y tareas.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.episodes, public.tasks;
  end if;
end;
$$;
