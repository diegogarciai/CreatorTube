-- «Mi equipo» en las ideas: los equipos que protagoniza o usa cada idea
-- (los marca Claude al proponerla). Se guardan los ids; si un equipo se borra,
-- la web simplemente no lo encuentra.
alter table public.ideas add column gear_ids uuid[] not null default '{}';
