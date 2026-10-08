-- Miniaturas: 30 textos de ángulos distintos del tema central para elegir los
-- 3 de las tarjetas. Los escribe el servidor; slot dice en qué tarjeta está.
create table public.thumbnail_ideas (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  position smallint not null default 0,
  angle text not null check (char_length(angle) <= 60),
  text text not null check (char_length(text) <= 80),
  accent text not null default '' check (char_length(accent) <= 40),
  scene text not null default '' check (char_length(scene) <= 400),
  emotion text not null default '' check (char_length(emotion) <= 80),
  slot smallint check (slot between 0 and 2),
  created_at timestamptz not null default now(),
  unique (episode_id, slot)
);
create index thumbnail_ideas_episode on public.thumbnail_ideas (episode_id, position);
create trigger thumbnail_ideas_workspace before insert or update on public.thumbnail_ideas
  for each row execute function public.set_workspace_from_channel();
alter table public.thumbnail_ideas enable row level security;
create policy thumbnail_ideas_select on public.thumbnail_ideas for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));

-- De qué texto salió cada versión de una miniatura.
alter table public.episode_assets
  add column idea_id uuid references public.thumbnail_ideas (id) on delete set null;
