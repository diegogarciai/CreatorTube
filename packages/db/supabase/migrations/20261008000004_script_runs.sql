-- Fase 2 · guion en etapas: cada corrida genera, en orden, Estudio, Guion,
-- Verificación, Publicación y Podcast. Las filas las escribe el servidor.

create type public.script_stage as enum ('study', 'script', 'verification', 'publication', 'podcast');
create type public.stage_run_status as enum ('queued', 'running', 'succeeded', 'failed', 'incomplete');

create table public.script_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  episode_id uuid not null references public.episodes (id) on delete cascade,
  guide_version_id uuid references public.writer_guide_versions (id) on delete set null,
  model text not null default '',
  from_stage public.script_stage not null default 'study',
  status public.stage_run_status not null default 'queued',
  -- Copia fija de la Dirección al arrancar: si después cambian las respuestas,
  -- esta corrida sigue siendo coherente.
  direction_block text not null default '',
  task_id uuid references public.tasks (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index script_runs_episode_idx on public.script_runs (episode_id, created_at desc);

create table public.script_stage_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.script_runs (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  stage public.script_stage not null,
  status public.stage_run_status not null default 'queued',
  -- [{title, body}] en el orden en que llegaron.
  blocks jsonb not null default '[]'::jsonb,
  raw text not null default '',
  usage jsonb not null default '{}'::jsonb,
  credits numeric not null default 0,
  error text,
  progress_message text,
  started_at timestamptz,
  finished_at timestamptz,
  unique (run_id, stage)
);

create trigger script_runs_workspace before insert or update on public.script_runs
  for each row execute function public.set_workspace_from_channel();
create trigger script_stage_runs_workspace before insert or update on public.script_stage_runs
  for each row execute function public.set_workspace_from_channel();

alter table public.episodes
  add column current_script_run_id uuid references public.script_runs (id) on delete set null;

alter table public.script_runs enable row level security;
alter table public.script_stage_runs enable row level security;

-- Las ve quien ve el canal. Sin políticas de escritura: las escribe el servidor.
create policy script_runs_select on public.script_runs for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
create policy script_stage_runs_select on public.script_stage_runs for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
