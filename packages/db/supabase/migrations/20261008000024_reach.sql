-- Alcance de los videos (Fase 4 · paso 2): impresiones de la miniatura y su
-- CTR por video y por día, y por fuente de tráfico, desde la YouTube Reporting
-- API (reportes channel_reach_basic_a1 y channel_reach_combined_a1). YouTube
-- guarda los reportes unos 60 días; aquí quedan archivados. Los escribe el
-- servidor; se leen con permiso de lectura del canal.

create table public.youtube_video_reach_daily (
  channel_id uuid not null references public.channels (id) on delete cascade,
  video_id text not null,
  day date not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  impressions bigint not null default 0,
  -- De 0 a 1: clics en la miniatura sobre impresiones.
  ctr numeric not null default 0 check (ctr between 0 and 1),
  fetched_at timestamptz not null default now(),
  primary key (channel_id, video_id, day)
);

create index youtube_video_reach_daily_day_idx on public.youtube_video_reach_daily (channel_id, day);

create trigger youtube_video_reach_daily_workspace
  before insert or update on public.youtube_video_reach_daily
  for each row execute function public.set_workspace_from_channel();

alter table public.youtube_video_reach_daily enable row level security;

create policy youtube_video_reach_daily_select on public.youtube_video_reach_daily
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));

-- Por fuente de tráfico (código traffic_source_type), sumando los dispositivos.
create table public.youtube_video_reach_sources (
  channel_id uuid not null references public.channels (id) on delete cascade,
  video_id text not null,
  day date not null,
  traffic_source text not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  impressions bigint not null default 0,
  -- Impresiones × CTR: se suman entre días y fuentes sin perder el promedio.
  clicks numeric not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (channel_id, video_id, day, traffic_source)
);

create index youtube_video_reach_sources_day_idx on public.youtube_video_reach_sources (channel_id, day);

create trigger youtube_video_reach_sources_workspace
  before insert or update on public.youtube_video_reach_sources
  for each row execute function public.set_workspace_from_channel();

alter table public.youtube_video_reach_sources enable row level security;

create policy youtube_video_reach_sources_select on public.youtube_video_reach_sources
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));

-- Los trabajos de la Reporting API del canal y el último reporte leído de cada
-- uno: {"channel_reach_basic_a1": {"jobId": "...", "after": "2026-10-08T…"}}.
alter table public.channel_connections
  add column reporting jsonb not null default '{}'::jsonb check (jsonb_typeof(reporting) = 'object');

-- Sumas para las pantallas (security invoker: se aplican las políticas de lectura).
-- El CTR de varios días o videos es clics ÷ impresiones (clics = impresiones × CTR).
create function public.reach_by_day(p_channel uuid, p_from date)
returns table (day date, impressions bigint, clicks numeric)
language sql stable security invoker set search_path = ''
as $$
  select r.day, sum(r.impressions)::bigint, sum(r.impressions * r.ctr)
  from public.youtube_video_reach_daily r
  where r.channel_id = p_channel and r.day >= p_from
  group by r.day
  order by r.day;
$$;

create function public.reach_by_video(p_channel uuid, p_videos text[])
returns table (
  video_id text,
  impressions bigint,
  clicks numeric,
  week_impressions bigint,
  week_clicks numeric
)
language sql stable security invoker set search_path = ''
as $$
  select r.video_id,
    sum(r.impressions)::bigint,
    sum(r.impressions * r.ctr),
    (sum(r.impressions) filter (where r.day <= v.published_at::date + 6))::bigint,
    sum(r.impressions * r.ctr) filter (where r.day <= v.published_at::date + 6)
  from public.youtube_video_reach_daily r
  left join public.youtube_videos v on v.channel_id = r.channel_id and v.video_id = r.video_id
  where r.channel_id = p_channel and r.video_id = any (p_videos)
  group by r.video_id;
$$;

create function public.reach_by_source(
  p_channel uuid,
  p_from date,
  p_to date,
  p_video text default null
)
returns table (traffic_source text, impressions bigint, clicks numeric)
language sql stable security invoker set search_path = ''
as $$
  select s.traffic_source, sum(s.impressions)::bigint, sum(s.clicks)
  from public.youtube_video_reach_sources s
  where s.channel_id = p_channel
    and s.day between p_from and p_to
    and (p_video is null or s.video_id = p_video)
  group by s.traffic_source
  order by 2 desc;
$$;

-- La purga también borra el alcance de los canales desconectados.
create or replace function public.purge_youtube_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale integer;
  disconnected integer;
  old_snapshots integer;
begin
  update public.youtube_videos
  set title = null, description = null, tags = null
  where fetched_at < now() - interval '30 days'
    and (title is not null or description is not null or tags is not null);
  get diagnostics stale = row_count;

  delete from public.youtube_video_snapshots where day < current_date - 35;
  get diagnostics old_snapshots = row_count;

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
  ), d5 as (
    delete from public.youtube_video_snapshots s using gone where s.channel_id = gone.id returning 1
  ), d6 as (
    delete from public.youtube_video_reach_daily r using gone where r.channel_id = gone.id returning 1
  ), d7 as (
    delete from public.youtube_video_reach_sources r using gone where r.channel_id = gone.id returning 1
  )
  select (select count(*) from d1) + (select count(*) from d2) + (select count(*) from d3)
    + (select count(*) from d4) + (select count(*) from d5) + (select count(*) from d6)
    + (select count(*) from d7)
  into disconnected;

  return jsonb_build_object(
    'stale_cleared', stale,
    'disconnected_deleted', disconnected,
    'old_snapshots_deleted', old_snapshots
  );
end;
$$;
