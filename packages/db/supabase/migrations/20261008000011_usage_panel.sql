-- Panel de consumo en Administración: lo que gasta cada servicio conectado.

-- Presupuesto mensual por servicio (en dólares; para YouTube, porcentaje de la
-- cuota diaria). El panel avisa al 80 % y marca en rojo al superarlo.
create table public.service_budgets (
  service text primary key check (service in ('ai', 'parallel', 'youtube')),
  monthly_usd numeric not null check (monthly_usd >= 0),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.service_budgets enable row level security;

-- Consumo agrupado por espacio, tipo y modelo en un periodo. Solo lo llama el
-- servidor (service role) después de revisar que es el administrador de la
-- plataforma.
create or replace function public.usage_breakdown(since timestamptz, until timestamptz)
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
  legacy_searches numeric
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
    ) as legacy_searches
  from public.usage_ledger l
  where l.created_at >= since and l.created_at < until
  group by 1, 2, 3
$$;

-- Búsquedas sin search_usd (registros de antes del panel): se estiman a
-- US$0,005. Lo mismo por mes (hora de Colombia), para la gráfica de los últimos meses.
create or replace function public.usage_monthly(months integer)
returns table (
  month date,
  calls bigint,
  cost_usd numeric,
  searches numeric,
  search_usd numeric,
  legacy_searches numeric
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
    ) as legacy_searches
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
