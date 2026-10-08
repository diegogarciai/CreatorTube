-- Miniaturas: el presentador puede generar cada una sin texto, sin persona o
-- sin producto (manda sobre la guía de miniaturas).
alter table public.episode_assets
  add column no_text boolean not null default false,
  add column no_person boolean not null default false,
  add column no_product boolean not null default false;

-- Cada texto propuesto trae un título para el video que lo completa.
alter table public.thumbnail_ideas
  add column title text not null default '' check (char_length(title) <= 100);
