-- «Mi equipo» en cada episodio: qué equipo protagoniza el video (protagonist)
-- y con qué se grabó (tool). De aquí salen el bloque de la descripción y la
-- aclaración del guion si algo vino de una marca. Lo lee quien ve el canal; lo
-- escribe el servidor. El equipo y el episodio tienen que ser del mismo canal.

create table public.episode_gear (
  episode_id uuid not null references public.episodes (id) on delete cascade,
  gear_id uuid not null references public.gear (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  role text not null default 'protagonist' check (role in ('protagonist', 'tool')),
  created_at timestamptz not null default now(),
  primary key (episode_id, gear_id)
);

create index episode_gear_gear_idx on public.episode_gear (gear_id);

create or replace function public.episode_gear_same_channel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.episodes e join public.gear g on g.channel_id = e.channel_id
    where e.id = new.episode_id and g.id = new.gear_id and e.channel_id = new.channel_id
  ) then
    raise exception 'El equipo y el episodio son de canales distintos' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger episode_gear_channel
  before insert or update on public.episode_gear
  for each row execute function public.episode_gear_same_channel();

create trigger episode_gear_workspace
  before insert or update on public.episode_gear
  for each row execute function public.set_workspace_from_channel();

alter table public.episode_gear enable row level security;

create policy episode_gear_select on public.episode_gear
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));
