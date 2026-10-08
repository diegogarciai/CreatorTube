-- Fase 2 · bases: ficha de entrada del episodio, guía del guionista por
-- secciones y versiones inmutables, y cupo mensual de créditos de IA.

-- Ficha de entrada (reglas, sección 3): lo que cambia el guion y solo el creador puede dar.
create type public.episode_type as enum ('product', 'explainer', 'news', 'opinion');
-- Sin valor (null) = patrocinio sin confirmar.
create type public.sponsorship as enum ('none', 'sponsor', 'affiliate');

alter table public.episodes
  add column episode_type public.episode_type,
  add column target_minutes smallint not null default 10 check (target_minutes between 3 and 30),
  add column sponsorship public.sponsorship,
  add column own_measurements text not null default ''
    check (char_length(own_measurements) <= 5000),
  add column stance_confirmed boolean not null default false;

-- Guía del guionista: el texto se guarda cortado por secciones y con la tabla
-- de qué secciones recibe cada etapa del guion.
alter table public.writer_guide_versions
  add column sections jsonb not null default '[]'::jsonb,
  add column stage_sections jsonb not null default '{}'::jsonb;

-- Las versiones no se editan ni se borran: cada guion guarda con cuál se
-- escribió. Se publican solo con la función de abajo.
drop policy writer_guide_versions_insert on public.writer_guide_versions;
drop policy writer_guide_versions_update on public.writer_guide_versions;
drop policy writer_guide_versions_delete on public.writer_guide_versions;

create or replace function public.publish_writer_guide_version(
  ch uuid,
  content text,
  notes text,
  sections jsonb,
  stage_sections jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  guide uuid;
  next_version integer;
  version_id uuid;
begin
  if not public.has_channel_permission(ch, 'configure_channel') then
    raise exception 'Tu rol no permite cambiar la guía del guionista' using errcode = '42501';
  end if;
  if char_length(coalesce(content, '')) = 0 or jsonb_array_length(sections) = 0 then
    raise exception 'La guía no tiene secciones' using errcode = '22023';
  end if;

  insert into public.writer_guides (channel_id) values (ch)
  on conflict (channel_id) do nothing;
  select g.id into guide from public.writer_guides g where g.channel_id = ch for update;

  select coalesce(max(v.version), 0) + 1 into next_version
  from public.writer_guide_versions v where v.guide_id = guide;

  insert into public.writer_guide_versions
    (channel_id, guide_id, version, content, notes, sections, stage_sections, created_by)
  values
    (ch, guide, next_version, content, nullif(trim(notes), ''), sections, stage_sections, auth.uid())
  returning id into version_id;

  update public.writer_guides set current_version_id = version_id where id = guide;
  return version_id;
end;
$$;
revoke execute on function public.publish_writer_guide_version(uuid, text, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.publish_writer_guide_version(uuid, text, text, jsonb, jsonb)
  to authenticated;

-- Créditos de IA: 1 crédito = US$0,01 de costo real. Cupo mensual por espacio;
-- el consumo sale de usage_ledger.
alter table public.workspaces
  add column monthly_credits integer not null default 2000 check (monthly_credits >= 0);

-- Solo un administrador de la plataforma (o el servidor) cambia el cupo.
create or replace function public.protect_workspace_credits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.monthly_credits is distinct from old.monthly_credits
     and auth.uid() is not null and not public.is_platform_admin() then
    raise exception 'Solo la administración de la plataforma cambia el cupo de créditos'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger workspaces_protect_credits before update on public.workspaces
  for each row execute function public.protect_workspace_credits();

-- Saldo del mes en curso (hora de Colombia), visible para los miembros del espacio.
create or replace function public.workspace_credits(ws uuid)
returns table (monthly integer, used numeric, remaining numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with month_start as (
    select date_trunc('month', now() at time zone 'America/Bogota') at time zone 'America/Bogota' as t
  ),
  spent as (
    select coalesce(sum(l.credits), 0) as used
    from public.usage_ledger l, month_start m
    where l.workspace_id = ws and l.created_at >= m.t
  )
  select w.monthly_credits, s.used, w.monthly_credits - s.used
  from public.workspaces w, spent s
  where w.id = ws and (public.is_workspace_member(ws) or public.is_platform_admin())
$$;
revoke execute on function public.workspace_credits(uuid) from public, anon;
grant execute on function public.workspace_credits(uuid) to authenticated;
