-- Búsquedas que traen gente (banco de ideas): las búsquedas de YouTube que
-- trajeron vistas al canal en los últimos 28 días, de la YouTube Analytics API
-- (insightTrafficSourceDetail con insightTrafficSourceType==YT_SEARCH). Cada
-- sincronización reemplaza las del canal. Son datos de YouTube: la purga las
-- borra a los 30 días sin refrescar y las de canales desconectados.

create table public.youtube_search_terms (
  channel_id uuid not null references public.channels (id) on delete cascade,
  term text not null check (char_length(term) between 1 and 300),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  views integer not null default 0,
  watch_minutes numeric not null default 0,
  -- El último día del período de 28 días.
  period_end date not null,
  fetched_at timestamptz not null default now(),
  primary key (channel_id, term)
);

create trigger youtube_search_terms_workspace
  before insert or update on public.youtube_search_terms
  for each row execute function public.set_workspace_from_channel();

alter table public.youtube_search_terms enable row level security;

create policy youtube_search_terms_select on public.youtube_search_terms
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));

-- Una idea puede salir de una búsqueda.
alter type public.idea_origin add value if not exists 'search';

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
  old_comments integer;
  old_terms integer;
begin
  update public.youtube_videos
  set title = null, description = null, tags = null
  where fetched_at < now() - interval '30 days'
    and (title is not null or description is not null or tags is not null);
  get diagnostics stale = row_count;

  delete from public.youtube_video_snapshots where day < current_date - 35;
  get diagnostics old_snapshots = row_count;

  -- Regla de 30 días de YouTube: los comentarios se vuelven a leer o se borran.
  delete from public.youtube_comments where fetched_at < now() - interval '30 days';
  get diagnostics old_comments = row_count;

  delete from public.youtube_search_terms where fetched_at < now() - interval '30 days';
  get diagnostics old_terms = row_count;

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
  ), d8 as (
    delete from public.youtube_comments c using gone where c.channel_id = gone.id returning 1
  ), d9 as (
    delete from public.comment_readings c using gone where c.channel_id = gone.id returning 1
  ), d10 as (
    delete from public.youtube_search_terms t using gone where t.channel_id = gone.id returning 1
  )
  select (select count(*) from d1) + (select count(*) from d2) + (select count(*) from d3)
    + (select count(*) from d4) + (select count(*) from d5) + (select count(*) from d6)
    + (select count(*) from d7) + (select count(*) from d8) + (select count(*) from d9)
    + (select count(*) from d10)
  into disconnected;

  return jsonb_build_object(
    'stale_cleared', stale,
    'disconnected_deleted', disconnected,
    'old_snapshots_deleted', old_snapshots,
    'old_comments_deleted', old_comments,
    'old_search_terms_deleted', old_terms
  );
end;
$$;
