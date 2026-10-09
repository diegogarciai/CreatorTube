-- «Mi equipo»: los dispositivos del canal (dron, portátil, cámara, gadgets…),
-- propios o de marcas (prestados con fecha de devolución, regalados o
-- patrocinados). Alimentan las ideas de episodios y, más adelante, los
-- episodios y su descripción. Lo lee quien ve el canal; lo escribe el servidor
-- tras revisar `manage_episodes`. La foto va en `{canal}/gear/…` del bucket.

create table public.gear (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  brand text not null default '' check (char_length(brand) <= 80),
  model text not null default '' check (char_length(model) <= 120),
  category text not null default 'other' check (
    category in (
      'drone', 'laptop', 'computer', 'phone', 'tablet', 'camera', 'audio', 'lighting',
      'wearable', 'gaming', 'smart_home', 'accessory', 'other'
    )
  ),
  -- own: propio · loan: prestado por una marca · gift: regalado · sponsored: patrocinado.
  ownership text not null default 'own' check (ownership in ('own', 'loan', 'gift', 'sponsored')),
  acquired_on date,
  return_by date,
  -- review: lo ordenó Claude desde una lista pegada y espera que alguien lo confirme.
  status text not null default 'active' check (status in ('active', 'retired', 'returned', 'review')),
  notes text not null default '' check (char_length(notes) <= 2000),
  affiliate_url text check (affiliate_url is null or char_length(affiliate_url) <= 500),
  photo_path text check (
    photo_path is null
    or (public.media_path_channel(photo_path) = channel_id and split_part(photo_path, '/', 2) = 'gear')
  ),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (return_by is null or ownership = 'loan')
);

create index gear_channel_idx on public.gear (channel_id, status);

create trigger gear_workspace
  before insert or update on public.gear
  for each row execute function public.set_workspace_from_channel();

create trigger gear_updated_at
  before update on public.gear
  for each row execute function public.set_updated_at();

alter table public.gear enable row level security;

create policy gear_select on public.gear
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));

-- Las fotos del equipo las sube y las borra quien maneja los episodios.
create policy channel_media_gear_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'channel-media'
    and split_part(name, '/', 2) = 'gear'
    and public.has_channel_permission(public.media_path_channel(name), 'manage_episodes')
  );
create policy channel_media_gear_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'channel-media'
    and split_part(name, '/', 2) = 'gear'
    and public.has_channel_permission(public.media_path_channel(name), 'manage_episodes')
  );

-- Una lista pegada para que Claude la ordene (tarea gear_parse). Solo la usa el
-- servidor; la tarea deja los equipos «por revisar» y borra la fila.
create table public.gear_imports (
  task_id uuid primary key references public.tasks (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 8000),
  created_at timestamptz not null default now()
);

create trigger gear_imports_workspace
  before insert or update on public.gear_imports
  for each row execute function public.set_workspace_from_channel();

alter table public.gear_imports enable row level security;
