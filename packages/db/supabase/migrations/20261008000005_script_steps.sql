-- Fase 2 · cada etapa del guion se genera por pasos: una llamada por bloque,
-- en orden, y cada paso espera a que termine el anterior.

create table public.script_step_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.script_runs (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  stage public.script_stage not null,
  -- Clave del paso (outline, teleprompter…); el orden lo da la app.
  step text not null,
  status public.stage_run_status not null default 'queued',
  body text not null default '',
  raw text not null default '',
  usage jsonb not null default '{}'::jsonb,
  credits numeric not null default 0,
  error text,
  progress_message text,
  -- Vista previa en vivo: las últimas líneas que va escribiendo.
  preview text,
  started_at timestamptz,
  finished_at timestamptz,
  unique (run_id, step)
);

create trigger script_step_runs_workspace before insert or update on public.script_step_runs
  for each row execute function public.set_workspace_from_channel();

-- Regenerar desde un paso: los anteriores se copian de la corrida vigente.
alter table public.script_runs add column from_step text;

alter table public.script_step_runs enable row level security;

-- Las ve quien ve el canal. Sin políticas de escritura: las escribe el servidor.
create policy script_step_runs_select on public.script_step_runs for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
