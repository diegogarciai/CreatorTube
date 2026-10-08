-- Fase 2 · paso 7: importar los videos publicados desde YouTube.

-- Etiquetas del video: ayudan a proponer las keywords al importar. Se borran
-- con el título y la descripción si pasan 30 días sin refrescarse.
alter table public.youtube_videos add column tags text[];

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
  )
  select (select count(*) from d1) + (select count(*) from d2) into disconnected;

  return jsonb_build_object('stale_cleared', stale, 'disconnected_deleted', disconnected);
end;
$$;

-- Un episodio importado lleva el código de su fecha de publicación
-- (PREFIJO-AAMMDD-HHMM). Solo se respeta un código con el prefijo del canal y
-- ese formato; si no, se genera con la hora actual, como siempre.
create or replace function public.assign_episode_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch record;
begin
  select c.code_prefix, c.timezone into ch from public.channels c where c.id = new.channel_id;
  perform pg_advisory_xact_lock(hashtextextended(new.channel_id::text, 0));
  select coalesce(max(e.number), 0) + 1 into new.number
  from public.episodes e where e.channel_id = new.channel_id;
  if new.code is null
    or left(new.code, length(ch.code_prefix) + 1) <> ch.code_prefix || '-'
    or substr(new.code, length(ch.code_prefix) + 2) !~ '^[0-9]{6}-[0-9]{4}$' then
    new.code := ch.code_prefix || '-' || to_char(now() at time zone ch.timezone, 'YYMMDD-HH24MI');
  end if;
  new.status_changed_at := now();
  return new;
end;
$$;

-- Los episodios de una importación que esperan su pilar, keywords y postura
-- propuestos por Claude. Si la tarea se cae, se sigue con los pendientes.
create table public.youtube_import_items (
  task_id uuid not null references public.tasks (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  episode_id uuid not null references public.episodes (id) on delete cascade,
  video_id text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  updated_at timestamptz not null default now(),
  primary key (task_id, episode_id)
);

create trigger youtube_import_items_workspace before insert or update on public.youtube_import_items
  for each row execute function public.set_workspace_from_channel();

alter table public.youtube_import_items enable row level security;

-- Las ve quien ve el canal. Sin políticas de escritura: las escribe el servidor.
create policy youtube_import_items_select on public.youtube_import_items for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
