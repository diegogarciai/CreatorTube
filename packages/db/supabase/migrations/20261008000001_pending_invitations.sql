-- Invitaciones pendientes sin el enlace: quien entra con el correo invitado las ve
-- en la app y las acepta ahí, aunque no haya pasado por /invite/[token].

-- Lógica común de aceptar. Solo la llaman las funciones de abajo.
create or replace function public.accept_invitation_row(inv_id uuid, workspace_name text)
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

  select * into inv from public.invitations i where i.id = inv_id for update;

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
revoke execute on function public.accept_invitation_row(uuid, text) from public, anon, authenticated;

-- Acepta con el token del enlace (misma firma y comportamiento de antes).
create or replace function public.accept_invitation(token text, workspace_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión para aceptar la invitación' using errcode = '42501';
  end if;
  select i.id into inv_id from public.invitations i
  where i.token_hash = public.hash_invitation_token(token);
  if inv_id is null then
    raise exception 'Invitación no encontrada' using errcode = 'P0002';
  end if;
  return public.accept_invitation_row(inv_id, workspace_name);
end;
$$;

-- Acepta una invitación pendiente del propio correo, sin el token.
create or replace function public.accept_invitation_by_id(invitation uuid, workspace_name text default null)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.accept_invitation_row(invitation, workspace_name)
$$;
revoke execute on function public.accept_invitation_by_id(uuid, text) from public, anon;
grant execute on function public.accept_invitation_by_id(uuid, text) to authenticated;

-- Invitaciones vigentes para el correo de la sesión.
create or replace function public.my_pending_invitations()
returns table (
  id uuid,
  kind public.invitation_kind,
  workspace_name text,
  role public.workspace_role,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.kind, w.name, i.role, i.expires_at
  from public.invitations i
  join public.profiles p on p.id = auth.uid() and p.email = i.email
  left join public.workspaces w on w.id = i.workspace_id
  where i.accepted_at is null and i.expires_at > now()
  order by i.created_at
$$;
revoke execute on function public.my_pending_invitations() from public, anon;
grant execute on function public.my_pending_invitations() to authenticated;
