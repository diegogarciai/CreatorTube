-- Un paso que no hace falta (la corrección cuando el control de calidad no
-- encontró nada) queda como «Sin cambios»: no se llama a Claude ni se cobra.
alter type public.stage_run_status add value if not exists 'skipped';
