-- «Así te fue ayer» (Fase 4): la Analytics API llega con 2 o 3 días de atraso,
-- así que «ayer» se aproxima con los contadores públicos de cada video. La
-- primera sincronización de cada día (el cron de la mañana) deja una foto; la
-- resta entre dos fotos seguidas da lo que pasó en esas ~24 horas.

create table public.youtube_video_snapshots (
  channel_id uuid not null references public.channels (id) on delete cascade,
  video_id text not null,
  -- Fecha local del canal en que se tomó la foto.
  day date not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  taken_at timestamptz not null default now(),
  primary key (channel_id, video_id, day)
);

create index youtube_video_snapshots_day_idx on public.youtube_video_snapshots (channel_id, day desc);

create trigger youtube_video_snapshots_workspace
  before insert or update on public.youtube_video_snapshots
  for each row execute function public.set_workspace_from_channel();

alter table public.youtube_video_snapshots enable row level security;

create policy youtube_video_snapshots_select on public.youtube_video_snapshots
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));

-- La purga borra las fotos de más de 35 días y las de canales desconectados.
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
  )
  select (select count(*) from d1) + (select count(*) from d2) + (select count(*) from d3)
    + (select count(*) from d4) + (select count(*) from d5)
  into disconnected;

  return jsonb_build_object(
    'stale_cleared', stale,
    'disconnected_deleted', disconnected,
    'old_snapshots_deleted', old_snapshots
  );
end;
$$;
