-- Evaluación a 7 días y auditoría mensual (Fase 4 · paso 3).
--
-- Evaluación: una por episodio. La web arma los números (la primera semana
-- contra la mediana de los episodios anteriores y los párrafos con más caída)
-- y deja la fila pendiente; la tarea `evaluation` agrega el veredicto y los
-- aprendizajes de Claude y marca `episodes.evaluated_at`.
--
-- Auditoría: una por canal y mes, a pedido. Junta las evaluaciones del mes y
-- propone ajustes a la guía del guionista y a los temas, para que una persona
-- los revise. La escribe el servidor; se lee con permiso de lectura.

-- Si hubiera más de una evaluación por episodio, queda la más reciente.
delete from public.episode_evaluations e
using public.episode_evaluations newer
where newer.episode_id = e.episode_id
  and (newer.created_at, newer.id) > (e.created_at, e.id);

alter table public.episode_evaluations
  add column status text not null default 'done'
    check (status in ('pending', 'done', 'failed')),
  add column verdict text check (verdict in ('above', 'inline', 'below')),
  add column updated_at timestamptz not null default now(),
  add constraint episode_evaluations_episode_key unique (episode_id);

create trigger episode_evaluations_updated_at
  before update on public.episode_evaluations
  for each row execute function public.set_updated_at();

-- Las escribe el servidor (con los números de YouTube y lo de Claude).
drop policy if exists episode_evaluations_insert on public.episode_evaluations;

create table public.channel_audits (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- El primer día del mes auditado.
  month date not null check (extract(day from month) = 1),
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  -- Lo que se le pasó a Claude: las evaluaciones del mes, resumidas.
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  -- {summary, guide:[{section, change, evidence}], topics:[{topic, action, evidence}]}.
  proposals jsonb not null default '{}'::jsonb check (jsonb_typeof(proposals) = 'object'),
  evaluations integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, month)
);

create trigger channel_audits_workspace
  before insert or update on public.channel_audits
  for each row execute function public.set_workspace_from_channel();

create trigger channel_audits_updated_at
  before update on public.channel_audits
  for each row execute function public.set_updated_at();

alter table public.channel_audits enable row level security;

create policy channel_audits_select on public.channel_audits
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));
