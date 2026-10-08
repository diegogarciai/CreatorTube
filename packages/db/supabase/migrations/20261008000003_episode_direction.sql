-- Fase 2 · preguntas de dirección: antes de escribir el guion, la IA lee el
-- tema y le pregunta al creador de 6 a 9 cosas. Una fila por episodio.

create type public.direction_status as enum ('generating', 'ready', 'answered', 'skipped');

create table public.episode_direction (
  episode_id uuid primary key references public.episodes (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  status public.direction_status not null default 'generating',
  -- Lectura del tema y preguntas: [{id, topic, question, why, multiple, options[]}].
  reading text not null default '',
  questions jsonb not null default '[]'::jsonb,
  -- Respuestas por id de pregunta: {q1: {selected: [], text: ""}}.
  answers jsonb not null default '{}'::jsonb,
  extra text not null default '' check (char_length(extra) <= 5000),
  guide_version_id uuid references public.writer_guide_versions (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  generated_at timestamptz,
  answered_at timestamptz,
  answered_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index episode_direction_channel_idx on public.episode_direction (channel_id);

create trigger episode_direction_workspace before insert or update on public.episode_direction
  for each row execute function public.set_workspace_from_channel();
create trigger episode_direction_updated_at before update on public.episode_direction
  for each row execute function public.set_updated_at();

-- El canal de la fila sale del episodio: no se puede colgar de otro canal.
create or replace function public.check_direction_episode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.episodes e where e.id = new.episode_id and e.channel_id = new.channel_id
  ) then
    raise exception 'El episodio no es de ese canal' using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger episode_direction_check before insert or update on public.episode_direction
  for each row execute function public.check_direction_episode();

alter table public.episode_direction enable row level security;

-- La ven quienes ven el canal; la responden guionistas y productores. Las
-- preguntas las escribe el servidor (service role) desde el motor de tareas.
create policy episode_direction_select on public.episode_direction for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
create policy episode_direction_update on public.episode_direction for update to authenticated
  using (public.has_channel_permission(channel_id, 'write_script'))
  with check (public.has_channel_permission(channel_id, 'write_script'));
