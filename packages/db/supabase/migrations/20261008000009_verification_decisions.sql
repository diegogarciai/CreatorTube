-- Fase 2: decisiones del presentador sobre la verificación (regla 10.4).
-- Por cada afirmación No verificable o Contradicha, o dato sin confirmar, el
-- presentador elige la salida: reescribir con lo confirmado, eliminar la
-- línea, dejar ___DATO POR CONFIRMAR___ o dar el valor. Sin decisión, decide
-- Claude con la regla 10.4. Las escribe el servidor tras revisar el permiso.
alter table public.verification_items
  add column decision text check (decision in ('rewrite', 'remove', 'mark', 'value')),
  add column decision_value text check (char_length(decision_value) <= 300),
  add column decided_by uuid references public.profiles (id) on delete set null,
  add column decided_at timestamptz,
  add constraint verification_items_value_check
    check (decision is distinct from 'value' or coalesce(trim(decision_value), '') <> '');
