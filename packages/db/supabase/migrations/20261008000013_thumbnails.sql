-- Fase 3 · paso 2: miniaturas con Gemini.

-- Recursos generados del episodio. Cada generación es una fila (las versiones
-- se conservan); los archivos viven en {canal}/episodes/{episodio}/thumbnails/.
-- Los escribe solo el servidor.
create table public.episode_assets (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null default 'thumbnail' check (kind in ('thumbnail')),
  design_idx smallint not null check (design_idx between 0 and 9),
  status text not null default 'queued'
    check (status in ('queued', 'generating', 'composing', 'scoring', 'ready', 'failed')),
  -- La versión de la que sale (al editar el texto se reutiliza su imagen).
  source_id uuid references public.episode_assets (id) on delete set null,
  base_path text,
  path text,
  text jsonb,
  text_side text check (text_side in ('left', 'right')),
  prompt text,
  note text check (char_length(note) <= 500),
  score jsonb,
  chosen boolean not null default false,
  model text,
  credits numeric not null default 0,
  error text,
  task_id uuid references public.tasks (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (base_path is null or (
    public.media_path_channel(base_path) = channel_id
    and split_part(base_path, '/', 2) = 'episodes'
    and split_part(base_path, '/', 3) = episode_id::text
  )),
  check (path is null or (
    public.media_path_channel(path) = channel_id
    and split_part(path, '/', 2) = 'episodes'
    and split_part(path, '/', 3) = episode_id::text
  ))
);
create index episode_assets_episode on public.episode_assets (episode_id, kind, design_idx, created_at desc);
create index episode_assets_task on public.episode_assets (task_id);
-- Una sola miniatura elegida por episodio.
create unique index episode_assets_one_chosen on public.episode_assets (episode_id)
  where chosen and kind = 'thumbnail';
create trigger episode_assets_workspace before insert or update on public.episode_assets
  for each row execute function public.set_workspace_from_channel();
create trigger episode_assets_updated_at before update on public.episode_assets
  for each row execute function public.set_updated_at();
alter table public.episode_assets enable row level security;
create policy episode_assets_select on public.episode_assets for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));

-- Fotos del producto del episodio: referencia para que salga idéntico.
create table public.episode_refs (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  path text not null unique,
  label text check (char_length(label) <= 80),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (
    public.media_path_channel(path) = channel_id
    and split_part(path, '/', 2) = 'episodes'
    and split_part(path, '/', 3) = episode_id::text
    and split_part(path, '/', 4) = 'refs'
  )
);
create index episode_refs_episode on public.episode_refs (episode_id, created_at);
create trigger episode_refs_workspace before insert or update on public.episode_refs
  for each row execute function public.set_workspace_from_channel();
alter table public.episode_refs enable row level security;
create policy episode_refs_select on public.episode_refs for select to authenticated
  using (public.has_channel_permission(channel_id, 'read'));
create policy episode_refs_insert on public.episode_refs for insert to authenticated
  with check (
    public.has_channel_permission(channel_id, 'write_script')
    and exists (
      select 1 from public.episodes e where e.id = episode_id and e.channel_id = episode_refs.channel_id
    )
  );
create policy episode_refs_delete on public.episode_refs for delete to authenticated
  using (public.has_channel_permission(channel_id, 'write_script'));

-- Quien escribe guiones sube y borra las fotos del producto en
-- {canal}/episodes/{episodio}/refs/. El resto de episodes/ es del servidor.
create policy channel_media_refs_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'channel-media'
    and split_part(name, '/', 2) = 'episodes'
    and split_part(name, '/', 4) = 'refs'
    and public.has_channel_permission(public.media_path_channel(name), 'write_script')
  );
create policy channel_media_refs_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'channel-media'
    and split_part(name, '/', 2) = 'episodes'
    and split_part(name, '/', 4) = 'refs'
    and public.has_channel_permission(public.media_path_channel(name), 'write_script')
  );

-- Panel de consumo: Gemini como servicio, con su presupuesto y su gasto aparte.
alter table public.service_budgets drop constraint service_budgets_service_check;
alter table public.service_budgets add constraint service_budgets_service_check
  check (service in ('ai', 'parallel', 'youtube', 'gemini'));

drop function public.usage_breakdown(timestamptz, timestamptz);
create function public.usage_breakdown(since timestamptz, until timestamptz)
returns table (
  workspace_id uuid,
  kind text,
  model text,
  calls bigint,
  credits numeric,
  cost_usd numeric,
  input_tokens numeric,
  output_tokens numeric,
  cache_tokens numeric,
  searches numeric,
  search_usd numeric,
  legacy_searches numeric,
  images numeric,
  image_usd numeric
)
language sql
stable
set search_path = ''
as $$
  select
    l.workspace_id,
    l.kind,
    coalesce(l.meta->>'model', '') as model,
    count(*) as calls,
    sum(l.credits) as credits,
    sum(l.cost_usd) as cost_usd,
    sum(coalesce((l.meta->>'input_tokens')::numeric, 0)) as input_tokens,
    sum(coalesce((l.meta->>'output_tokens')::numeric, 0)) as output_tokens,
    sum(
      coalesce((l.meta->>'cache_creation_input_tokens')::numeric, 0)
      + coalesce((l.meta->>'cache_read_input_tokens')::numeric, 0)
    ) as cache_tokens,
    sum(coalesce((l.meta->>'searches')::numeric, 0)) as searches,
    sum(coalesce((l.meta->>'search_usd')::numeric, 0)) as search_usd,
    sum(
      case when l.meta ? 'search_usd' then 0
      else coalesce((l.meta->>'searches')::numeric, 0) end
    ) as legacy_searches,
    sum(coalesce((l.meta->>'images')::numeric, 0)) as images,
    sum(coalesce((l.meta->>'image_usd')::numeric, 0)) as image_usd
  from public.usage_ledger l
  where l.created_at >= since and l.created_at < until
  group by 1, 2, 3
$$;

drop function public.usage_monthly(integer);
create function public.usage_monthly(months integer)
returns table (
  month date,
  calls bigint,
  cost_usd numeric,
  searches numeric,
  search_usd numeric,
  legacy_searches numeric,
  image_usd numeric
)
language sql
stable
set search_path = ''
as $$
  select
    (date_trunc('month', l.created_at at time zone 'America/Bogota'))::date as month,
    count(*) as calls,
    sum(l.cost_usd) as cost_usd,
    sum(coalesce((l.meta->>'searches')::numeric, 0)) as searches,
    sum(coalesce((l.meta->>'search_usd')::numeric, 0)) as search_usd,
    sum(
      case when l.meta ? 'search_usd' then 0
      else coalesce((l.meta->>'searches')::numeric, 0) end
    ) as legacy_searches,
    sum(coalesce((l.meta->>'image_usd')::numeric, 0)) as image_usd
  from public.usage_ledger l
  where l.created_at >= (
    date_trunc('month', now() at time zone 'America/Bogota')
    - make_interval(months => greatest(months, 1) - 1)
  ) at time zone 'America/Bogota'
  group by 1
  order by 1
$$;

revoke execute on function public.usage_breakdown(timestamptz, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.usage_monthly(integer) from public, anon, authenticated;
grant execute on function public.usage_breakdown(timestamptz, timestamptz) to service_role;
grant execute on function public.usage_monthly(integer) to service_role;
