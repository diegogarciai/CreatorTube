-- Boletín por episodio (Fase 4 · paso 5): además del semanal, cada episodio
-- puede tener su boletín, con las apreciaciones del presentador (sus notas,
-- desarrolladas por Claude con su voz) y los comentarios importantes que él
-- elige. El semanal pasa a resumir los videos que se eligen al redactarlo.
-- `task_id` une el borrador con la tarea que lo redacta.

alter table public.newsletters
  add column kind text not null default 'weekly' check (kind in ('weekly', 'episode')),
  add column episode_id uuid references public.episodes (id) on delete cascade,
  add column notes text not null default '' check (char_length(notes) <= 4000),
  add column comment_ids text[] not null default '{}',
  add column task_id uuid references public.tasks (id) on delete set null,
  alter column week_start drop not null,
  add constraint newsletters_kind_scope check (
    (kind = 'weekly' and week_start is not null and episode_id is null)
    or (kind = 'episode' and episode_id is not null)
  );

create unique index newsletters_episode_idx on public.newsletters (episode_id)
  where episode_id is not null;
