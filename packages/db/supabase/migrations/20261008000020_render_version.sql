-- Recursos del episodio (Fase 3 · paso 5): las ayudas llevan efectos de sonido
-- en el MP4. Cada render guarda la versión con que se hizo; los anteriores
-- (1, sin sonido) se muestran desactualizados para rehacerlos.
alter table public.aid_renders
  add column render_version int not null default 1;
