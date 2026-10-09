-- Comentarios y dolores de la audiencia (Fase 4 · paso 4, sección 20 de las
-- reglas): los comentarios de los episodios se leen a pedido, Claude los
-- clasifica y sugiere la respuesta como Diego, y la respuesta se publica solo
-- con la confirmación de una persona con permiso de publicar. Los escribe el
-- servidor; se leen con permiso de lectura del canal.

create table public.youtube_comments (
  channel_id uuid not null references public.channels (id) on delete cascade,
  comment_id text not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  episode_id uuid references public.episodes (id) on delete set null,
  video_id text not null,
  author_name text not null default '',
  author_channel_id text,
  text text not null default '',
  like_count integer not null default 0,
  reply_count integer not null default 0,
  published_at timestamptz not null,
  -- El canal ya le respondió en YouTube (no hace falta sugerir).
  channel_replied boolean not null default false,
  -- Clasificación (20.1 y 20.3); null mientras no se clasifica.
  kind text check (
    kind in (
      'pregunta_tecnica', 'correccion', 'desacuerdo', 'experiencia',
      'pedido_tema', 'elogio', 'troll_spam'
    )
  ),
  -- Marcas sin respuesta sugerida: datos personales, enlace sospechoso, riesgo legal.
  flags text[] not null default '{}',
  -- Corrección: {said, correct, source, minute, valid}.
  correction jsonb,
  reply text not null default '' check (char_length(reply) <= 1500),
  reply_status text not null default 'suggested'
    check (reply_status in ('suggested', 'edited', 'published', 'dismissed')),
  reply_id text,
  replied_at timestamptz,
  replied_by uuid references auth.users (id) on delete set null,
  classified_at timestamptz,
  fetched_at timestamptz not null default now(),
  primary key (channel_id, comment_id)
);

create index youtube_comments_episode_idx on public.youtube_comments (episode_id, published_at desc);

create trigger youtube_comments_workspace
  before insert or update on public.youtube_comments
  for each row execute function public.set_workspace_from_channel();

alter table public.youtube_comments enable row level security;

create policy youtube_comments_select on public.youtube_comments
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));

-- Lectura del lote (20.4) de cada episodio, acumulada entre lecturas:
-- {themes:[{theme,count}], pains:[{pain,count,quote}], topPain, questions:[{question,trend}],
--  corrections:[...], ideas:[...]}.
create table public.comment_readings (
  episode_id uuid primary key references public.episodes (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  reading jsonb not null default '{}'::jsonb check (jsonb_typeof(reading) = 'object'),
  comments integer not null default 0,
  updated_at timestamptz not null default now()
);

create trigger comment_readings_workspace
  before insert or update on public.comment_readings
  for each row execute function public.set_workspace_from_channel();

alter table public.comment_readings enable row level security;

create policy comment_readings_select on public.comment_readings
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));

-- La purga borra los comentarios leídos hace más de 30 días y los de canales
-- desconectados (las lecturas de canales desconectados también).
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
  )
  select (select count(*) from d1) + (select count(*) from d2) + (select count(*) from d3)
    + (select count(*) from d4) + (select count(*) from d5) + (select count(*) from d6)
    + (select count(*) from d7) + (select count(*) from d8) + (select count(*) from d9)
  into disconnected;

  return jsonb_build_object(
    'stale_cleared', stale,
    'disconnected_deleted', disconnected,
    'old_snapshots_deleted', old_snapshots,
    'old_comments_deleted', old_comments
  );
end;
$$;
