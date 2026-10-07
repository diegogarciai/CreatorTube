-- Canales: cada uno con su perfil, ritmo, conexión a YouTube, guía del
-- guionista por versiones, kit de marca y difusión.

create type public.connection_status as enum ('active', 'needs_reauth', 'revoked');

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  youtube_channel_id text unique,
  youtube_handle text,
  thumbnail_url text,
  language text not null default 'es',
  timezone text not null default 'America/Bogota',
  code_prefix text not null default 'EP' check (code_prefix ~ '^[A-Z0-9]{1,6}$'),
  weekly_goal smallint not null default 1 check (weekly_goal between 0 and 21),
  -- Días ISO (1 = lunes … 7 = domingo).
  publish_weekdays smallint[] not null default '{}',
  record_weekdays smallint[] not null default '{}',
  formats text[] not null default '{long}',
  -- Perfil: presentadores, audiencia, tono.
  profile jsonb not null default '{}'::jsonb,
  -- Enlace secreto del calendario ICS.
  ics_token text not null unique
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  onboarding_completed_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index channels_workspace_idx on public.channels (workspace_id);
create trigger channels_updated_at before update on public.channels
  for each row execute function public.set_updated_at();

-- Credenciales OAuth de Google por canal, cifradas en la app con una clave
-- guardada fuera de la base (TOKEN_ENCRYPTION_KEY). Sin políticas de RLS:
-- ningún cliente puede leerlas; solo el servidor con la service role.
create table public.channel_connections (
  channel_id uuid primary key references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null default 'google',
  google_subject text,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status public.connection_status not null default 'active',
  last_verified_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  -- Unidades de cuota de la YouTube Data API usadas hoy (UTC) por este canal.
  quota_day date,
  quota_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger channel_connections_updated_at before update on public.channel_connections
  for each row execute function public.set_updated_at();

create table public.writer_guides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null unique references public.channels (id) on delete cascade,
  current_version_id uuid,
  created_at timestamptz not null default now()
);

create table public.writer_guide_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  guide_id uuid not null references public.writer_guides (id) on delete cascade,
  version integer not null check (version > 0),
  content text not null,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (guide_id, version)
);

alter table public.writer_guides
  add constraint writer_guides_current_version_fk
  foreign key (current_version_id) references public.writer_guide_versions (id) on delete set null;

create table public.brand_kits (
  channel_id uuid primary key references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  colors jsonb not null default '{}'::jsonb,
  fonts jsonb not null default '{}'::jsonb,
  logo_path text,
  thumbnail_style text,
  updated_at timestamptz not null default now()
);
create trigger brand_kits_updated_at before update on public.brand_kits
  for each row execute function public.set_updated_at();

create table public.distribution_settings (
  channel_id uuid primary key references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  newsletter_name text,
  sender_name text,
  sender_email text,
  socials jsonb not null default '{}'::jsonb,
  podcast_name text,
  updated_at timestamptz not null default now()
);
create trigger distribution_settings_updated_at before update on public.distribution_settings
  for each row execute function public.set_updated_at();

-- El espacio de una fila con canal siempre sale del canal: el cliente no puede
-- colocar datos en un espacio ajeno, y una fila no se puede mudar de canal.
create or replace function public.set_workspace_from_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.channel_id is distinct from old.channel_id then
    raise exception 'No se puede mover una fila a otro canal' using errcode = '42501';
  end if;
  select c.workspace_id into new.workspace_id from public.channels c where c.id = new.channel_id;
  if new.workspace_id is null then
    raise exception 'Canal inexistente' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger channel_connections_workspace before insert or update on public.channel_connections
  for each row execute function public.set_workspace_from_channel();
create trigger writer_guides_workspace before insert or update on public.writer_guides
  for each row execute function public.set_workspace_from_channel();
create trigger writer_guide_versions_workspace before insert or update on public.writer_guide_versions
  for each row execute function public.set_workspace_from_channel();
create trigger brand_kits_workspace before insert or update on public.brand_kits
  for each row execute function public.set_workspace_from_channel();
create trigger distribution_settings_workspace before insert or update on public.distribution_settings
  for each row execute function public.set_workspace_from_channel();

-- Un canal no cambia de espacio.
create or replace function public.prevent_channel_workspace_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'Un canal no puede cambiar de espacio' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger channels_workspace_fixed before update on public.channels
  for each row execute function public.prevent_channel_workspace_change();
