-- Configuración del canal, ideas y episodios.

create type public.checklist_phase as enum ('before_publish', 'after_publish');
create type public.idea_origin as enum ('recommendation', 'own', 'pain_point');
create type public.idea_status as enum ('new', 'in_progress', 'discarded');
create type public.episode_status as enum (
  'planned', 'script', 'to_record', 'editing', 'scheduled', 'published'
);
create type public.episode_stage as enum (
  'planning', 'direction', 'script', 'verification', 'preparation',
  'recording', 'publication', 'distribution', 'evaluation'
);

create table public.pillars (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  color text not null default '#ea580c' check (color ~ '^#[0-9a-fA-F]{6}$'),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index pillars_channel_idx on public.pillars (channel_id);

-- Pasos con identificador estable: el progreso se guarda por id, no por texto.
create table public.checklist_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  phase public.checklist_phase not null,
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index checklist_steps_channel_idx on public.checklist_steps (channel_id, phase, position);
create trigger checklist_steps_updated_at before update on public.checklist_steps
  for each row execute function public.set_updated_at();

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  notes text not null default '',
  origin public.idea_origin not null default 'own',
  status public.idea_status not null default 'new',
  -- Cinco señales 1..5: demand, fit, novelty, effort, timing.
  signals jsonb not null default '{}'::jsonb,
  reasons text,
  risk text,
  pillar_id uuid references public.pillars (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ideas_channel_idx on public.ideas (channel_id, status);
create trigger ideas_updated_at before update on public.ideas
  for each row execute function public.set_updated_at();

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  number integer not null,
  code text not null,
  title text not null check (char_length(title) between 1 and 200),
  status public.episode_status not null default 'planned',
  stage public.episode_stage not null default 'planning',
  status_changed_at timestamptz not null default now(),
  format text not null default 'long' check (format in ('long', 'short', 'live', 'podcast')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  stance text not null default '',
  keywords text[] not null default '{}',
  notes text not null default '',
  pillar_id uuid references public.pillars (id) on delete set null,
  idea_id uuid references public.ideas (id) on delete set null,
  -- Fechas locales en la zona del canal.
  publish_date date,
  record_date date,
  youtube_video_id text check (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  scheduled_at timestamptz,
  published_at timestamptz,
  writer_guide_version_id uuid references public.writer_guide_versions (id) on delete set null,
  evaluated_at timestamptz,
  archived_at timestamptz,
  -- Orden dentro de la columna del tablero.
  board_position double precision not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, number)
);
create index episodes_channel_status_idx on public.episodes (channel_id, status) where archived_at is null;
create index episodes_channel_publish_idx on public.episodes (channel_id, publish_date);
create unique index episodes_video_idx on public.episodes (channel_id, youtube_video_id)
  where youtube_video_id is not null;
create trigger episodes_updated_at before update on public.episodes
  for each row execute function public.set_updated_at();

create table public.episode_checklist_items (
  episode_id uuid not null references public.episodes (id) on delete cascade,
  step_id uuid not null references public.checklist_steps (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  done_at timestamptz not null default now(),
  done_by uuid references public.profiles (id) on delete set null,
  primary key (episode_id, step_id)
);

create table public.episode_evaluations (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  notes text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create trigger pillars_workspace before insert or update on public.pillars
  for each row execute function public.set_workspace_from_channel();
create trigger checklist_steps_workspace before insert or update on public.checklist_steps
  for each row execute function public.set_workspace_from_channel();
create trigger ideas_workspace before insert or update on public.ideas
  for each row execute function public.set_workspace_from_channel();
create trigger episodes_workspace before insert or update on public.episodes
  for each row execute function public.set_workspace_from_channel();

-- Filas que cuelgan de un episodio heredan su canal y su espacio.
create or replace function public.set_scope_from_episode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select e.channel_id, e.workspace_id into new.channel_id, new.workspace_id
  from public.episodes e where e.id = new.episode_id;
  if new.channel_id is null then
    raise exception 'Episodio inexistente' using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger episode_checklist_items_scope before insert or update on public.episode_checklist_items
  for each row execute function public.set_scope_from_episode();
create trigger episode_evaluations_scope before insert or update on public.episode_evaluations
  for each row execute function public.set_scope_from_episode();

-- Un paso de checklist solo se puede marcar en episodios de su mismo canal.
create or replace function public.check_checklist_step_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.checklist_steps s where s.id = new.step_id and s.channel_id = new.channel_id
  ) then
    raise exception 'El paso no pertenece al canal del episodio' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger episode_checklist_items_step_channel before insert or update on public.episode_checklist_items
  for each row execute function public.check_checklist_step_channel();

-- Número consecutivo por canal y código PREFIJO-AAMMDD-HHMM en la zona del canal.
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
  new.code := ch.code_prefix || '-' || to_char(now() at time zone ch.timezone, 'YYMMDD-HH24MI');
  new.status_changed_at := now();
  return new;
end;
$$;
create trigger episodes_number before insert on public.episodes
  for each row execute function public.assign_episode_number();

-- Número y código son inmutables; un cambio de estado registra su fecha.
create or replace function public.track_episode_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.number := old.number;
  new.code := old.code;
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;
create trigger episodes_track before update on public.episodes
  for each row execute function public.track_episode_changes();
