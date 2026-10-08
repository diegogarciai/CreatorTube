-- Plan de ayudas visuales (reglas v4.1, sección 12): motion graphics (M,
-- fichas 12.5), etiquetas de concepto (C) y listas (L) (12.8). Las escribe el
-- servidor; el presentador aprueba, descarta o corrige cada una.
create table public.visual_aids (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  script_run_id uuid references public.script_runs (id) on delete set null,
  kind text not null check (kind in ('M', 'C', 'L')),
  code text not null check (code ~ '^[MCL][0-9]{1,2}$'),
  position smallint not null default 0,
  paragraph smallint not null default 0,
  anchor text not null check (char_length(anchor) between 1 and 300),
  idea text check (char_length(idea) <= 400),
  title text not null check (char_length(title) between 1 and 120),
  definition text check (char_length(definition) <= 200),
  elements jsonb not null default '[]'::jsonb,
  -- Filas de la tabla de verificación de donde salen las cifras (12.3).
  claim_rows integer[] not null default '{}',
  footer text check (char_length(footer) <= 200),
  duration_s smallint check (duration_s between 1 and 60),
  piece text check (
    piece in (
      'bars', 'ring', 'counter', 'timeline', 'dot_matrix', 'curve',
      'before_after', 'comparison', 'network', 'zoom'
    )
  ),
  scores jsonb,
  vertical boolean not null default false,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'discarded')),
  edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index visual_aids_episode on public.visual_aids (episode_id, position);
create trigger visual_aids_updated_at before update on public.visual_aids
  for each row execute function public.set_updated_at();
create trigger visual_aids_workspace before insert or update on public.visual_aids
  for each row execute function public.set_workspace_from_channel();
alter table public.visual_aids enable row level security;
create policy visual_aids_select on public.visual_aids for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
