-- Semilla local: reemplaza el correo por el tuyo para ser administrador de la plataforma.
insert into public.platform_admins (email) values ('admin@example.com') on conflict do nothing;
