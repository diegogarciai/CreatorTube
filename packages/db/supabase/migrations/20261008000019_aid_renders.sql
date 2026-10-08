-- Render de las ayudas visuales (Fase 3 · paso 4): cada ayuda aprobada se
-- renderiza con Remotion en Trigger.dev. M en horizontal (y vertical si es la
-- más fuerte); C y L en fondo verde (croma, para CapCut) y transparente.

-- El bucket acepta también video. 50 MB es el máximo por archivo del plan
-- gratis de Supabase; las piezas pesan unos pocos MB.
update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = array[
    'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/webm'
  ]
where id = 'channel-media';

create table public.aid_renders (
  id uuid primary key default gen_random_uuid(),
  visual_aid_id uuid not null references public.visual_aids (id) on delete cascade,
  episode_id uuid not null references public.episodes (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  format text not null check (format in ('horizontal', 'vertical', 'green', 'alpha')),
  status text not null default 'queued'
    check (status in ('queued', 'rendering', 'ready', 'failed')),
  path text,
  bytes bigint,
  duration_s numeric,
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un render vigente por ayuda y formato.
  unique (visual_aid_id, format),
  check (path is null or (public.media_path_channel(path) = channel_id
    and split_part(path, '/', 2) = 'episodes' and split_part(path, '/', 3) = episode_id::text))
);
create index aid_renders_episode on public.aid_renders (episode_id);
create index aid_renders_task on public.aid_renders (task_id);
create trigger aid_renders_updated_at before update on public.aid_renders
  for each row execute function public.set_updated_at();
create trigger aid_renders_workspace before insert or update on public.aid_renders
  for each row execute function public.set_workspace_from_channel();
alter table public.aid_renders enable row level security;
create policy aid_renders_select on public.aid_renders for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
