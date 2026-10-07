-- Row Level Security. La matriz de permisos replica packages/core/src/permissions.ts
-- (una prueba verifica que coincidan).

create or replace function public.role_has_permission(r public.workspace_role, perm text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case r
    when 'owner' then perm in ('read', 'comment', 'write_script', 'manage_episodes', 'edit_video',
      'publish', 'configure_channel', 'manage_members', 'manage_workspace')
    when 'admin' then perm in ('read', 'comment', 'write_script', 'manage_episodes', 'edit_video',
      'publish', 'configure_channel', 'manage_members')
    when 'producer' then perm in ('read', 'comment', 'write_script', 'manage_episodes', 'edit_video',
      'publish')
    when 'writer' then perm in ('read', 'comment', 'write_script')
    when 'video_editor' then perm in ('read', 'comment', 'edit_video')
    when 'viewer' then perm in ('read', 'comment')
    else false
  end
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins a
    join public.profiles p on p.email = a.email
    where p.id = auth.uid()
  )
$$;

create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m where m.workspace_id = ws and m.user_id = auth.uid()
  )
$$;

create or replace function public.has_workspace_permission(ws uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = ws and m.user_id = auth.uid()
      and public.role_has_permission(m.role, perm)
  )
$$;

create or replace function public.has_channel_permission(ch uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.channels c
    join public.memberships m on m.workspace_id = c.workspace_id
    where c.id = ch and m.user_id = auth.uid()
      and (m.channel_ids is null or ch = any (m.channel_ids))
      and public.role_has_permission(m.role, perm)
  )
$$;

-- Igual que has_channel_permission pero sin leer la tabla de canales: sirve
-- para las políticas de la propia tabla channels (incluido insert ... returning).
create or replace function public.has_channel_permission_in(ws uuid, ch uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = ws and m.user_id = auth.uid()
      and (m.channel_ids is null or ch = any (m.channel_ids))
      and public.role_has_permission(m.role, perm)
  )
$$;

-- ¿Comparte espacio con esa persona? (para ver nombres de compañeros)
create or replace function public.shares_workspace_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships a
    join public.memberships b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = other
  )
$$;

alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.devices enable row level security;
alter table public.channels enable row level security;
alter table public.channel_connections enable row level security;
alter table public.writer_guides enable row level security;
alter table public.writer_guide_versions enable row level security;
alter table public.brand_kits enable row level security;
alter table public.distribution_settings enable row level security;
alter table public.pillars enable row level security;
alter table public.checklist_steps enable row level security;
alter table public.ideas enable row level security;
alter table public.episodes enable row level security;
alter table public.episode_checklist_items enable row level security;
alter table public.episode_evaluations enable row level security;
alter table public.youtube_videos enable row level security;
alter table public.youtube_video_daily_stats enable row level security;
alter table public.tasks enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.activity_log enable row level security;

-- Perfiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_workspace_with(id) or public.is_platform_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Administradores de plataforma: solo ellos ven la lista.
create policy platform_admins_select on public.platform_admins for select to authenticated
  using (public.is_platform_admin());

-- Espacios: se crean con accept_invitation()/create_workspace().
create policy workspaces_select on public.workspaces for select to authenticated
  using (public.is_workspace_member(id) or public.is_platform_admin());
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.has_workspace_permission(id, 'manage_workspace'))
  with check (public.has_workspace_permission(id, 'manage_workspace'));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (public.has_workspace_permission(id, 'manage_workspace'));

-- Membresías: se ven entre miembros; los cambios pasan por el servidor.
create policy memberships_select on public.memberships for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
create policy memberships_leave on public.memberships for delete to authenticated
  using (user_id = auth.uid() and role <> 'owner');

-- Invitaciones
create policy invitations_select on public.invitations for select to authenticated
  using (
    (kind = 'workspace' and public.has_workspace_permission(workspace_id, 'manage_members'))
    or public.is_platform_admin()
  );
create policy invitations_insert on public.invitations for insert to authenticated
  with check (
    invited_by = auth.uid() and (
      (kind = 'workspace' and role <> 'owner'
        and public.has_workspace_permission(workspace_id, 'manage_members'))
      or (kind = 'platform' and public.is_platform_admin())
    )
  );
create policy invitations_delete on public.invitations for delete to authenticated
  using (
    accepted_at is null and (
      (kind = 'workspace' and public.has_workspace_permission(workspace_id, 'manage_members'))
      or public.is_platform_admin()
    )
  );

-- Dispositivos propios
create policy devices_own on public.devices for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Canales
create policy channels_select on public.channels for select to authenticated
  using (public.has_channel_permission_in(workspace_id, id, 'read'));
create policy channels_insert on public.channels for insert to authenticated
  with check (public.has_workspace_permission(workspace_id, 'configure_channel'));
create policy channels_update on public.channels for update to authenticated
  using (public.has_channel_permission_in(workspace_id, id, 'configure_channel'))
  with check (public.has_channel_permission_in(workspace_id, id, 'configure_channel'));
create policy channels_delete on public.channels for delete to authenticated
  using (public.has_workspace_permission(workspace_id, 'manage_workspace'));

-- channel_connections: RLS activo y sin políticas = cerrado para clientes.

-- Configuración del canal: lectura para el equipo, cambios para quien configura.
do $$
declare t text;
begin
  foreach t in array array[
    'writer_guides', 'writer_guide_versions', 'brand_kits', 'distribution_settings',
    'pillars', 'checklist_steps'
  ] loop
    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated
         using (public.has_channel_permission(channel_id, ''read''))', t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert to authenticated
         with check (public.has_channel_permission(channel_id, ''configure_channel''))', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update to authenticated
         using (public.has_channel_permission(channel_id, ''configure_channel''))
         with check (public.has_channel_permission(channel_id, ''configure_channel''))', t);
    execute format(
      'create policy %1$s_delete on public.%1$s for delete to authenticated
         using (public.has_channel_permission(channel_id, ''configure_channel''))', t);
  end loop;
end;
$$;

-- Ideas: las trabajan guionistas y productores.
create policy ideas_select on public.ideas for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
create policy ideas_insert on public.ideas for insert to authenticated
  with check (public.has_channel_permission(channel_id, 'write_script'));
create policy ideas_update on public.ideas for update to authenticated
  using (public.has_channel_permission(channel_id, 'write_script'))
  with check (public.has_channel_permission(channel_id, 'write_script'));
create policy ideas_delete on public.ideas for delete to authenticated
  using (public.has_channel_permission(channel_id, 'manage_episodes'));

-- Episodios
create policy episodes_select on public.episodes for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
create policy episodes_insert on public.episodes for insert to authenticated
  with check (public.has_channel_permission(channel_id, 'manage_episodes'));
create policy episodes_update on public.episodes for update to authenticated
  using (
    public.has_channel_permission(channel_id, 'manage_episodes')
    or public.has_channel_permission(channel_id, 'edit_video')
  )
  with check (
    public.has_channel_permission(channel_id, 'manage_episodes')
    or public.has_channel_permission(channel_id, 'edit_video')
  );
create policy episodes_delete on public.episodes for delete to authenticated
  using (public.has_channel_permission(channel_id, 'manage_episodes'));

-- El editor de video solo puede pasar un episodio entre "Por grabar" y
-- "En edición"; no cambia nada más.
create or replace function public.enforce_episode_update_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.has_channel_permission(new.channel_id, 'manage_episodes') then
    return new;
  end if;
  if (to_jsonb(new) - array['status', 'stage', 'status_changed_at', 'updated_at'])
     is distinct from (to_jsonb(old) - array['status', 'stage', 'status_changed_at', 'updated_at']) then
    raise exception 'Tu rol solo puede cambiar el estado del episodio' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'to_record' and new.status = 'editing')
    or (old.status = 'editing' and new.status = 'to_record')
  ) then
    raise exception 'Tu rol no puede mover el episodio a ese estado' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger episodes_enforce_rules before update on public.episodes
  for each row execute function public.enforce_episode_update_rules();

-- Checklist del episodio
create policy episode_checklist_items_select on public.episode_checklist_items for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
create policy episode_checklist_items_insert on public.episode_checklist_items for insert to authenticated
  with check (
    public.has_channel_permission(channel_id, 'manage_episodes')
    or public.has_channel_permission(channel_id, 'edit_video')
  );
create policy episode_checklist_items_delete on public.episode_checklist_items for delete to authenticated
  using (
    public.has_channel_permission(channel_id, 'manage_episodes')
    or public.has_channel_permission(channel_id, 'edit_video')
  );

-- Evaluaciones
create policy episode_evaluations_select on public.episode_evaluations for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
create policy episode_evaluations_insert on public.episode_evaluations for insert to authenticated
  with check (public.has_channel_permission(channel_id, 'manage_episodes'));

-- Datos de YouTube: solo lectura; los escribe el servidor.
create policy youtube_videos_select on public.youtube_videos for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
create policy youtube_video_daily_stats_select on public.youtube_video_daily_stats for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));

-- Operación
create policy tasks_select on public.tasks for select to authenticated
  using (
    case when channel_id is null then public.is_workspace_member(workspace_id)
    else public.has_channel_permission(channel_id, 'read') end
  );
create policy usage_ledger_select on public.usage_ledger for select to authenticated
  using (public.has_workspace_permission(workspace_id, 'manage_members') or public.is_platform_admin());
create policy activity_log_select on public.activity_log for select to authenticated
  using (
    case when channel_id is null then public.is_workspace_member(workspace_id)
    else public.has_channel_permission(channel_id, 'read') end
  );

-- Los visitantes sin sesión no ven nada.
revoke all on all tables in schema public from anon;
