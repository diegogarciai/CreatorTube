-- Fase 3 · paso 1: archivos del canal, kit de marca y fotos del presentador.

-- Bucket privado. Las rutas empiezan por el canal:
--   {canal}/brand/…                 logo y piezas del kit
--   {canal}/presenter/…             fotos de referencia del presentador
--   {canal}/episodes/{episodio}/…   recursos del episodio (los escribe el servidor)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'channel-media',
  'channel-media',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;

-- El canal de una ruta del bucket (primer segmento), o null si no es un uuid.
create or replace function public.media_path_channel(path text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(path, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- Lee quien ve el canal; sube, reemplaza y borra quien lo configura, y solo en
-- las carpetas de marca y presentador. Los recursos de episodios los escribe
-- el servidor.
create policy channel_media_select on storage.objects for select to authenticated
  using (
    bucket_id = 'channel-media'
    and public.has_channel_permission(public.media_path_channel(name), 'read')
  );
create policy channel_media_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'channel-media'
    and split_part(name, '/', 2) in ('brand', 'presenter')
    and public.has_channel_permission(public.media_path_channel(name), 'configure_channel')
  );
create policy channel_media_update on storage.objects for update to authenticated
  using (
    bucket_id = 'channel-media'
    and split_part(name, '/', 2) in ('brand', 'presenter')
    and public.has_channel_permission(public.media_path_channel(name), 'configure_channel')
  )
  with check (
    bucket_id = 'channel-media'
    and split_part(name, '/', 2) in ('brand', 'presenter')
    and public.has_channel_permission(public.media_path_channel(name), 'configure_channel')
  );
create policy channel_media_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'channel-media'
    and split_part(name, '/', 2) in ('brand', 'presenter')
    and public.has_channel_permission(public.media_path_channel(name), 'configure_channel')
  );

-- Kit de marca: la retícula, el halo, el movimiento y las zonas seguras.
alter table public.brand_kits add column style jsonb not null default '{}'::jsonb;
alter table public.brand_kits add constraint brand_kits_logo_path check (
  logo_path is null
  or (public.media_path_channel(logo_path) = channel_id and split_part(logo_path, '/', 2) = 'brand')
);

-- Fotos de referencia del presentador (para las miniaturas). Son datos
-- personales: solo las ve quien ve el canal y se borran con el archivo.
create table public.presenter_photos (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  path text not null unique,
  label text check (char_length(label) <= 80),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (public.media_path_channel(path) = channel_id and split_part(path, '/', 2) = 'presenter')
);
create index presenter_photos_channel on public.presenter_photos (channel_id, created_at);
create trigger presenter_photos_workspace before insert or update on public.presenter_photos
  for each row execute function public.set_workspace_from_channel();
alter table public.presenter_photos enable row level security;

create policy presenter_photos_select on public.presenter_photos for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
create policy presenter_photos_insert on public.presenter_photos for insert to authenticated
  with check (public.has_channel_permission(channel_id, 'configure_channel'));
create policy presenter_photos_update on public.presenter_photos for update to authenticated
  using (public.has_channel_permission(channel_id, 'configure_channel'))
  with check (public.has_channel_permission(channel_id, 'configure_channel'));
create policy presenter_photos_delete on public.presenter_photos for delete to authenticated
  using (public.has_channel_permission(channel_id, 'configure_channel'));
