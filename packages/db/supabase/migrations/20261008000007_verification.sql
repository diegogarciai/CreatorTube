-- Fase 2 · paso 5: Verificación con búsqueda (sección 10).

-- La corrida se detiene antes de los reels si quedan datos por confirmar y
-- espera la decisión del presentador.
alter type public.stage_run_status add value if not exists 'paused';

-- Una fila por afirmación extraída del guion. La verificación avanza de 4 en 4
-- y guarda cada grupo: si el buscador se cae, se sigue donde quedó.
create table public.verification_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.script_runs (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  idx integer not null,
  kind text not null check (kind in ('fact', 'opinion', 'dato')),
  claim text not null,
  line text not null default '',
  occurrences integer not null default 1,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'nuanced', 'unverifiable', 'contradicted')),
  nature text check (nature in ('brand', 'independent', 'own', 'press', 'estimate')),
  url text,
  source_title text,
  quote text,
  data_date text,
  value text,
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique (run_id, idx)
);
create index verification_items_run_idx on public.verification_items (run_id, idx);

create trigger verification_items_workspace before insert or update on public.verification_items
  for each row execute function public.set_workspace_from_channel();

alter table public.verification_items enable row level security;

-- Las ve quien ve el canal. Sin políticas de escritura: las escribe el servidor.
create policy verification_items_select on public.verification_items for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
