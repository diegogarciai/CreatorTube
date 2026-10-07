-- Cuentas: perfiles, espacios de trabajo, membresías e invitaciones.
-- Toda fila de la app pertenece a un espacio; las reglas de RLS (migración 5)
-- solo dejan leer o escribir a miembros con el rol adecuado.

create type public.workspace_role as enum (
  'owner', 'admin', 'producer', 'writer', 'video_editor', 'viewer'
);

create type public.invitation_kind as enum ('platform', 'workspace');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  locale text not null default 'es',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Administradores de la plataforma, por correo para poder sembrar el primero
-- antes de que se registre.
create table public.platform_admins (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  -- Créditos mensuales de IA del espacio (Fase 2). 0 = sin IA.
  monthly_credit_limit integer not null default 0 check (monthly_credit_limit >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.workspace_role not null,
  -- null = acceso a todos los canales del espacio.
  channel_ids uuid[],
  -- Límite de créditos por persona dentro del espacio (null = sin límite propio).
  credit_limit integer check (credit_limit is null or credit_limit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);
create trigger memberships_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  kind public.invitation_kind not null,
  -- Invitación de plataforma: crea su propio espacio (workspace_id null).
  -- Invitación de espacio: se une a uno existente con un rol.
  workspace_id uuid references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email)),
  role public.workspace_role not null default 'owner',
  channel_ids uuid[],
  -- sha256 hex del token del enlace; el token en claro nunca se guarda.
  token_hash text not null unique,
  invited_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'platform') = (workspace_id is null)),
  check (kind = 'workspace' or role = 'owner')
);
create index invitations_email_idx on public.invitations (email) where accepted_at is null;

-- Dispositivos para notificaciones de la app móvil (Fase 7); el modelo se fija desde ya.
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  push_token text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Perfil automático al registrarse.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
