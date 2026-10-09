-- Resumen semanal por correo (Fase 4 · paso 5): el lunes, a los dueños del
-- espacio, la meta de la semana, la agenda, lo atrasado y lo que está en
-- riesgo. Esta tabla evita mandarlo dos veces por canal y semana; la escribe y
-- la lee solo el servidor (sin políticas: nadie más la ve).

create table public.weekly_digests (
  channel_id uuid not null references public.channels (id) on delete cascade,
  -- El lunes de la semana del resumen (fecha local del canal).
  week_start date not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  recipients integer not null default 0,
  sent_at timestamptz not null default now(),
  primary key (channel_id, week_start)
);

create trigger weekly_digests_workspace
  before insert or update on public.weekly_digests
  for each row execute function public.set_workspace_from_channel();

alter table public.weekly_digests enable row level security;
