-- Miniaturas: el texto va en la zona más libre de la imagen. text_side y text_v
-- en null quieren decir automático; al editar el texto se pueden fijar.
alter table public.episode_assets
  add column text_v text check (text_v in ('top', 'middle', 'bottom'));
