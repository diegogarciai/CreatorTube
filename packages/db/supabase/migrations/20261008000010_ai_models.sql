-- Fase 2: modelos de IA configurables desde Administración.

-- Catálogo de la plataforma: los modelos que la API de Anthropic ofrece a la
-- cuenta (se actualiza con una tarea) y lo que cuesta cada uno, para los
-- créditos. Los precios los escribe el administrador de la plataforma.
create table public.ai_models (
  id text primary key,
  display_name text not null default '',
  created_at_api timestamptz,
  input_price_usd numeric check (input_price_usd >= 0),
  output_price_usd numeric check (output_price_usd >= 0),
  available boolean not null default true,
  fetched_at timestamptz not null default now()
);

-- El modelo de cada espacio: uno por defecto y, si se quiere, uno por etapa.
-- Sin fila (o sin modelo), se usa la variable AI_MODEL del motor de tareas.
create table public.workspace_ai_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  default_model text references public.ai_models (id) on delete set null,
  stage_models jsonb not null default '{}'::jsonb check (jsonb_typeof(stage_models) = 'object'),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Solo el servidor: las lee y escribe con la service role tras revisar que
-- quien pide es administrador de la plataforma.
alter table public.ai_models enable row level security;
alter table public.workspace_ai_settings enable row level security;
