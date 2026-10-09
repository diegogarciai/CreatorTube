-- Boletín semanal (Fase 4 · paso 5, §21): uno por canal y semana. Claude lo
-- redacta a pedido con los episodios publicados en la semana; se edita, se
-- prueba y se envía (o se programa) con Resend Broadcasts al segmento del
-- canal. Lo escribe el servidor; se lee con permiso de lectura del canal.

alter table public.distribution_settings
  add column newsletter_segment_id text
    check (newsletter_segment_id is null or char_length(newsletter_segment_id) between 1 and 100);

create table public.newsletters (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- El lunes de la semana (fecha local del canal).
  week_start date not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sent')),
  subject text not null default '' check (char_length(subject) <= 200),
  preheader text not null default '' check (char_length(preheader) <= 300),
  -- Markdown sencillo.
  body text not null default '' check (char_length(body) <= 20000),
  cta_text text not null default '' check (char_length(cta_text) <= 60),
  cta_url text check (cta_url is null or char_length(cta_url) <= 500),
  point text not null default '' check (char_length(point) <= 400),
  episode_ids uuid[] not null default '{}',
  broadcast_id text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  sent_by uuid references auth.users (id) on delete set null,
  test_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, week_start)
);

create trigger newsletters_workspace
  before insert or update on public.newsletters
  for each row execute function public.set_workspace_from_channel();

create trigger newsletters_updated_at
  before update on public.newsletters
  for each row execute function public.set_updated_at();

alter table public.newsletters enable row level security;

create policy newsletters_select on public.newsletters
  for select to authenticated using (public.has_channel_permission(channel_id, 'read'));
