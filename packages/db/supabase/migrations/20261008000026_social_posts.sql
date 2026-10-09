-- Redes y cápsulas (Fase 4 · paso 6): de cada episodio salen 3 posts de texto
-- por red del canal (el dato, el mito y la postura). Se editan, se copian y se
-- marcan publicados; el estado queda por red. Los escribe el servidor; se leen
-- con permiso de lectura del canal.

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  episode_id uuid not null references public.episodes (id) on delete cascade,
  -- La clave de la red (x, linkedin, instagram…) o el nombre de una red fuera del catálogo.
  network text not null check (char_length(network) between 1 and 60),
  kind text not null check (kind in ('dato', 'mito', 'postura')),
  text text not null default '' check (char_length(text) <= 4000),
  status text not null default 'suggested'
    check (status in ('suggested', 'edited', 'published', 'dismissed')),
  post_url text check (post_url is null or char_length(post_url) <= 500),
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (episode_id, network, kind)
);

create index social_posts_channel_idx on public.social_posts (channel_id);

create trigger social_posts_workspace
  before insert or update on public.social_posts
  for each row execute function public.set_workspace_from_channel();

create trigger social_posts_updated_at
  before update on public.social_posts
  for each row execute function public.set_updated_at();

alter table public.social_posts enable row level security;

create policy social_posts_select on public.social_posts
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));
