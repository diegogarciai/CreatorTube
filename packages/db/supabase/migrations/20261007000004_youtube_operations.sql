-- Datos de YouTube (con fecha de lectura para las reglas de retención) y
-- operación: tareas, consumo y actividad.

create table public.youtube_videos (
  channel_id uuid not null references public.channels (id) on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Título y descripción se borran si pasan 30 días sin refrescarse.
  title text,
  description text,
  thumbnail_url text,
  privacy_status text check (privacy_status in ('public', 'private', 'unlisted')),
  publish_at timestamptz,
  published_at timestamptz,
  duration_seconds integer,
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  fetched_at timestamptz not null default now(),
  primary key (channel_id, video_id)
);
create index youtube_videos_published_idx on public.youtube_videos (channel_id, published_at desc);

create table public.youtube_video_daily_stats (
  channel_id uuid not null references public.channels (id) on delete cascade,
  video_id text not null,
  day date not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  views bigint,
  watch_minutes numeric,
  average_view_duration_seconds numeric,
  likes bigint,
  comments bigint,
  subscribers_gained bigint,
  fetched_at timestamptz not null default now(),
  primary key (channel_id, video_id, day)
);

create trigger youtube_videos_workspace before insert or update on public.youtube_videos
  for each row execute function public.set_workspace_from_channel();
create trigger youtube_video_daily_stats_workspace before insert or update on public.youtube_video_daily_stats
  for each row execute function public.set_workspace_from_channel();

create type public.task_status as enum ('queued', 'running', 'succeeded', 'failed', 'canceled');

-- Tareas largas (motor de tareas en Fase 2). El navegador ve el progreso por Realtime.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid references public.channels (id) on delete cascade,
  episode_id uuid references public.episodes (id) on delete cascade,
  kind text not null,
  status public.task_status not null default 'queued',
  progress real not null default 0 check (progress between 0 and 1),
  message text,
  credits_estimated numeric,
  credits_used numeric,
  external_run_id text,
  error text,
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index tasks_workspace_idx on public.tasks (workspace_id, created_at desc);

create table public.usage_ledger (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid references public.channels (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  kind text not null,
  credits numeric not null default 0,
  cost_usd numeric not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index usage_ledger_workspace_idx on public.usage_ledger (workspace_id, created_at desc);

create table public.activity_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid references public.channels (id) on delete cascade,
  episode_id uuid references public.episodes (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_episode_idx on public.activity_log (episode_id, created_at desc);
create index activity_log_workspace_idx on public.activity_log (workspace_id, created_at desc);

-- Registro de quién cambió qué en los episodios.
create or replace function public.log_episode_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (workspace_id, channel_id, episode_id, actor_id, action, details)
    values (new.workspace_id, new.channel_id, new.id, auth.uid(), 'episode.created',
      jsonb_build_object('title', new.title));
  elsif new.status is distinct from old.status then
    insert into public.activity_log (workspace_id, channel_id, episode_id, actor_id, action, details)
    values (new.workspace_id, new.channel_id, new.id, auth.uid(), 'episode.status_changed',
      jsonb_build_object('from', old.status, 'to', new.status, 'stage', new.stage));
  elsif new.stage is distinct from old.stage then
    insert into public.activity_log (workspace_id, channel_id, episode_id, actor_id, action, details)
    values (new.workspace_id, new.channel_id, new.id, auth.uid(), 'episode.stage_changed',
      jsonb_build_object('from', old.stage, 'to', new.stage));
  end if;
  return null;
end;
$$;
create trigger episodes_activity after insert or update on public.episodes
  for each row execute function public.log_episode_activity();
