# Planificador de episodios

Aplicación web multi-canal para planificar, producir y publicar episodios de YouTube. Reemplaza el panel-artefacto de una sola persona por una app con cuentas, espacios de trabajo, roles, canales conectados por OAuth y datos aislados por equipo.

> "Planificador" es un nombre provisional y neutral. La marca vive en un solo lugar: `packages/config/src/brand.ts`. Google no acepta nombres con "YouTube" ni "YT".

## Estado

| Fase                      | Contenido                                                                                                                                                                                                                                                           | Estado    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 0 · Preparación (técnica) | Monorepo, modelo de datos con RLS, despliegue, páginas públicas y políticas (borrador)                                                                                                                                                                              | ✅        |
| 1 · Fundaciones           | Registro por invitación, espacios, canales y roles; conexión de YouTube y sincronización diaria; episodios en tablero, lista y tabla; calendario con enlace ICS; Inicio con meta, racha, cobertura y alertas; checklists con identificador; configuración del canal | ✅        |
| 2 · IA y guion            | Motor de tareas, créditos, preguntas de dirección, guion en 5 etapas, verificación, guía del guionista ([diseño](docs/fase-2-diseno.md))                                                                                                                            | Diseño    |
| 3 – 7                     | Producción, difusión, beta, cobros, móvil                                                                                                                                                                                                                           | Pendiente |

Los trámites de la Fase 0 con Google (verificación, cuota, dominio) están en [`docs/fase-0-tramites.md`](docs/fase-0-tramites.md). Los supuestos tomados al no tener el código del panel anterior están en [`docs/decisiones.md`](docs/decisiones.md).

## Arquitectura

```
apps/web             Next.js 16 (App Router) + React 19 + Tailwind v4 + next-intl (es)
packages/core        Lógica de negocio pura en TypeScript (la reutilizará la app móvil)
packages/youtube     OAuth de Google, cifrado de tokens, cliente de la Data API y sincronización
packages/db          Migraciones de Supabase, tipos generados y pruebas de RLS
packages/config      tsconfig compartido, marca y tokens de diseño
```

- **El navegador solo habla con la app.** YouTube se llama desde el servidor con las credenciales de cada canal, cifradas con AES-256-GCM (`TOKEN_ENCRYPTION_KEY`, fuera de la base). La tabla `channel_connections` no tiene políticas de RLS: ningún cliente puede leerla.
- **Aislamiento en la base.** Toda fila lleva `workspace_id` (y `channel_id` cuando aplica), que los triggers toman del canal para que no se pueda falsear. Las políticas de RLS usan la misma matriz de permisos que `packages/core/src/permissions.ts`; una prueba verifica que coincidan.
- **Registro solo por invitación** con el Auth Hook `before_user_created` de Supabase (`public.hook_before_user_created`).
- **Sincronización diaria** en `/api/cron/youtube-sync` (Vercel Cron, 11:05 UTC). El plan Hobby de Vercel solo permite crons diarios; con Pro se puede volver a horaria cambiando `apps/web/vercel.json` (`"5 * * * *"`), y la lógica ya sincroniza cada hora los canales con algo por publicar cerca y cada 6 horas los quietos. Mientras tanto, **Sincronizar ahora** en la configuración del canal actualiza al momento. Siempre con tope de cuota diaria. Avanza los episodios vinculados a Programado y Publicado. La lógica vive en `packages/youtube` para moverla a Trigger.dev en la Fase 2.
- **Retención:** `/api/cron/purge` borra títulos y descripciones de YouTube con más de 30 días sin refrescar y los datos de canales desconectados.
- **Calendario ICS** público por canal con enlace secreto (`/api/ics/<token>.ics`), sin permisos de Google Calendar.

## Desarrollo local

Requisitos: Node 22, pnpm 10 y, para la base local, Docker + [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
pnpm install
cd packages/db && npx supabase start      # Postgres, Auth y API locales; aplica migraciones y seed
cp apps/web/.env.example apps/web/.env.local   # pega las claves que imprime `supabase start`
pnpm dev                                   # http://localhost:3000
```

Para ser administrador de la plataforma, registra tu correo antes de entrar (el seed trae `admin@example.com`):

```sql
insert into public.platform_admins (email) values ('tu-correo@dominio.com');
```

Desde **Administración** invitas a creadores; cada invitación de plataforma crea un espacio propio. Desde **Espacio y equipo** se invita a miembros con rol y, opcionalmente, limitados a ciertos canales.

### Variables de entorno

Ver [`apps/web/.env.example`](apps/web/.env.example). Sin Supabase configurado la app sirve solo las páginas públicas; sin las variables de Google se puede crear un canal sin conectarlo y conectarlo después.

### Scripts

| Comando                                    | Qué hace                                                  |
| ------------------------------------------ | --------------------------------------------------------- |
| `pnpm dev`                                 | Servidor de desarrollo de la web                          |
| `pnpm build`                               | Compila todo                                              |
| `pnpm lint` / `pnpm typecheck`             | ESLint y TypeScript en todos los paquetes                 |
| `pnpm test`                                | Pruebas de `core`, `youtube` y RLS de `db`                |
| `pnpm --filter @planificador/db gen:types` | Regenera `packages/db/src/types.ts` desde las migraciones |

Las pruebas de `packages/db` necesitan Postgres: usan `DATABASE_URL` si existe (así corre en CI) o levantan un clúster temporal con los binarios locales de Postgres (`initdb`/`pg_ctl`), sin Docker. Aplican un entorno mínimo de Supabase (`packages/db/test/supabase-shim.sql`) y todas las migraciones.

## Despliegue

1. **Supabase:** sigue [`docs/configurar-supabase.md`](docs/configurar-supabase.md): secreto `SUPABASE_DB_URL` y workflow **Supabase migrations**, hook **Before User Created**, URL Configuration, proveedor Google, SMTP con Resend y plantillas de correo con enlace y código.
2. **Google Cloud:** crea el cliente OAuth web con la redirección `https://tu-dominio/api/youtube/callback` y habilita YouTube Data API v3 y YouTube Analytics API (paso a paso en [`docs/configurar-google.md`](docs/configurar-google.md)).
3. **Vercel:** importa el repo con raíz `apps/web`, configura las variables de `.env.example` y despliega. `apps/web/vercel.json` registra los cron jobs; Vercel envía `CRON_SECRET` automáticamente.

## Calidad

- `packages/core`: 34 pruebas (estados, etapas, cobertura, racha, alertas, señales, ICS, enlaces de YouTube, validaciones).
- `packages/youtube`: 10 pruebas (cifrado, state de OAuth, sincronización con API simulada).
- `packages/db`: 25 pruebas de RLS e invariantes contra Postgres real.
- La web se probó de punta a punta con Postgres + GoTrue + PostgREST reales: invitación, registro bloqueado sin invitación, puesta en marcha, episodios, tablero con arrastre, calendario e ICS, ideas, roles y vista móvil.
