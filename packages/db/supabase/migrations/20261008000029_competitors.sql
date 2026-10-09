-- Competencia y videos atípicos (banco de ideas): los canales que sigue el
-- presentador y sus subidas recientes con las vistas, de la YouTube Data API
-- (datos públicos). El cron diario los refresca; un video es atípico cuando
-- supera varias veces la mediana de su canal. Los escribe el servidor; se leen
-- con permiso de lectura. Son datos de YouTube: la purga borra lo que no se
-- refrescó en 30 días y lo de canales desconectados.

create table public.competitor_channels (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  youtube_channel_id text not null check (youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  title text,
  handle text,
  thumbnail_url text,
  uploads_playlist_id text not null,
  -- Mediana de vistas de sus subidas recientes (las de al menos 3 días).
  median_views numeric,
  synced_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (channel_id, youtube_channel_id)
);

create trigger competitor_channels_workspace
  before insert or update on public.competitor_channels
  for each row execute function public.set_workspace_from_channel();

alter table public.competitor_channels enable row level security;

create policy competitor_channels_select on public.competitor_channels
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));

create table public.competitor_videos (
  competitor_id uuid not null references public.competitor_channels (id) on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null default '',
  thumbnail_url text,
  published_at timestamptz not null,
  views bigint not null default 0,
  -- Vistas sobre la mediana del canal (null si el video es muy nuevo).
  ratio numeric,
  fetched_at timestamptz not null default now(),
  primary key (competitor_id, video_id)
);

create index competitor_videos_channel_idx on public.competitor_videos (channel_id, ratio desc);

create trigger competitor_videos_workspace
  before insert or update on public.competitor_videos
  for each row execute function public.set_workspace_from_channel();

alter table public.competitor_videos enable row level security;

create policy competitor_videos_select on public.competitor_videos
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));

-- Una idea puede salir de un video de la competencia.
alter type public.idea_origin add value if not exists 'competitor';

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
  old_competitor_videos integer;
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

  -- Competencia: los videos que no se refrescaron en 30 días se borran, y los
  -- datos del canal se limpian hasta la próxima sincronización.
  delete from public.competitor_videos where fetched_at < now() - interval '30 days';
  get diagnostics old_competitor_videos = row_count;
  update public.competitor_channels
  set title = null, handle = null, thumbnail_url = null
  where synced_at < now() - interval '30 days' and title is not null;

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
  ), d11 as (
    delete from public.competitor_channels c using gone where c.channel_id = gone.id returning 1
  )
  select (select count(*) from d1) + (select count(*) from d2) + (select count(*) from d3)
    + (select count(*) from d4) + (select count(*) from d5) + (select count(*) from d6)
    + (select count(*) from d7) + (select count(*) from d8) + (select count(*) from d9)
    + (select count(*) from d10) + (select count(*) from d11)
  into disconnected;

  return jsonb_build_object(
    'stale_cleared', stale,
    'disconnected_deleted', disconnected,
    'old_snapshots_deleted', old_snapshots,
    'old_comments_deleted', old_comments,
    'old_search_terms_deleted', old_terms,
    'old_competitor_videos_deleted', old_competitor_videos
  );
end;
$$;
