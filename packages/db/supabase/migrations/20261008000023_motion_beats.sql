-- Motion graphics frase por frase (12.5 y 12.6): cada M guarda el segmento del
-- guion que explica, su caso de 12.1 y su guion de animación (un momento por
-- frase). La duración sale del segmento dicho al ritmo de lectura del canal.
alter table public.visual_aids
  add column segment text check (char_length(segment) <= 2000),
  add column aid_case text check (
    aid_case in ('comparison', 'mechanism', 'calculation', 'anchor_figure', 'myth', 'timeline')
  ),
  add column beats jsonb not null default '[]' check (jsonb_typeof(beats) = 'array');

-- Tres piezas nuevas: flujo de pasos (mecanismo), la cuenta y mito y realidad.
alter table public.visual_aids drop constraint visual_aids_piece_check;
alter table public.visual_aids add constraint visual_aids_piece_check check (
  piece in (
    'bars', 'ring', 'counter', 'timeline', 'dot_matrix', 'curve',
    'before_after', 'comparison', 'network', 'zoom', 'flow', 'equation', 'myth'
  )
);

-- Palabras por minuto con que el presentador lee el guion.
alter table public.channels
  add column speech_wpm smallint not null default 150 check (speech_wpm between 100 and 200);
