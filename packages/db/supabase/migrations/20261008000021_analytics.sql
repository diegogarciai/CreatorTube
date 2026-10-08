-- Analítica de canal y episodio (Fase 4 · paso 1): métricas por día del canal
-- y de cada video, y la curva de retención, desde la YouTube Analytics API. Las
-- escribe el servidor (cron diario); se leen con permiso de lectura del canal.

create table public.youtube_channel_daily_stats (
  channel_id uuid not null references public.channels (id) on delete cascade,
  day date not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  views bigint not null default 0,
  watch_minutes numeric not null default 0,
  average_view_duration_seconds numeric not null default 0,
  average_view_percentage numeric not null default 0,
  subscribers_gained bigint not null default 0,
  subscribers_lost bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (channel_id, day)
);

create trigger youtube_channel_daily_stats_workspace
  before insert or update on public.youtube_channel_daily_stats
  for each row execute function public.set_workspace_from_channel();

alter table public.youtube_video_daily_stats
  add column average_view_percentage numeric,
  add column subscribers_lost bigint,
  add column shares bigint;

-- La curva de retención de cada video: 100 puntos [{r, watch, relative}].
create table public.youtube_video_retention (
  channel_id uuid not null references public.channels (id) on delete cascade,
  video_id text not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  points jsonb not null default '[]'::jsonb check (jsonb_typeof(points) = 'array'),
  fetched_at timestamptz not null default now(),
  primary key (channel_id, video_id)
);

create trigger youtube_video_retention_workspace
  before insert or update on public.youtube_video_retention
  for each row execute function public.set_workspace_from_channel();

alter table public.youtube_channel_daily_stats enable row level security;
alter table public.youtube_video_retention enable row level security;

create policy youtube_channel_daily_stats_select on public.youtube_channel_daily_stats
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));
create policy youtube_video_retention_select on public.youtube_video_retention
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));

-- La purga también borra la analítica de los canales desconectados.
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
  set title = null, description = null, tags = null
  where fetched_at < now() - interval '30 days'
    and (title is not null or description is not null or tags is not null);
  get diagnostics stale = row_count;

  with gone as (
    select id from public.channels where disconnected_at is not null
  ), d1 as (
    delete from public.youtube_videos v using gone where v.channel_id = gone.id returning 1
  ), d2 as (
    delete from public.youtube_video_daily_stats s using gone where s.channel_id = gone.id returning 1
  ), d3 as (
    delete from public.youtube_channel_daily_stats s using gone where s.channel_id = gone.id returning 1
  ), d4 as (
    delete from public.youtube_video_retention r using gone where r.channel_id = gone.id returning 1
  )
  select (select count(*) from d1) + (select count(*) from d2) + (select count(*) from d3)
    + (select count(*) from d4)
  into disconnected;

  return jsonb_build_object('stale_cleared', stale, 'disconnected_deleted', disconnected);
end;
$$;
