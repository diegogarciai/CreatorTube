# Configurar Trigger.dev (motor de tareas)

Las tareas largas (preguntas de dirección, etapas del guion, verificación) corren en Trigger.dev, no en Vercel. El código está en `apps/jobs`. Cada corrida actualiza su fila en la tabla `tasks`, y la barra lateral de la app la muestra en vivo con Supabase Realtime.

## 1. Proyecto y despliegue

1. En https://cloud.trigger.dev, crea el proyecto y copia su **Project ref** (`proj_…`) desde **Project settings**. No es secreto: va en `apps/jobs/trigger.config.ts`. El de producción es `proj_rrnleywnvctyyhakvffy`.
2. El despliegue lo hace GitHub Actions (`.github/workflows/trigger-deploy.yml`) en cada push a `main` que toque `apps/jobs`, `packages/core`, `packages/db/src` o el lockfile. También se puede correr a mano desde **Actions → Trigger.dev deploy → Run workflow**.
3. **Clave de despliegue:**
   1. En Trigger.dev, cambia el selector de entorno (arriba a la izquierda) a **Production**.
   2. Ve a **API keys → New API key**, con el nombre `github-actions` y acceso **Deploy only**.
   3. Cópiala en GitHub como secreto del repositorio: **Settings → Secrets and variables → Actions → New repository secret**, con el nombre `TRIGGER_ACCESS_TOKEN`.

No hace falta la integración de GitHub dentro de Trigger.dev. Si más adelante la conectas desde **Project settings → Git**, apaga este workflow para no desplegar dos veces.

## 2. Variables de entorno

**En Trigger.dev**, en **Environment variables**, entorno **Production**:

| Variable                    | Valor                                                                 |
| --------------------------- | --------------------------------------------------------------------- |
| `SUPABASE_URL`              | La URL del proyecto de Supabase (`https://TU-PROJECT-ID.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | La misma service role key que está en Vercel                          |
| `ANTHROPIC_API_KEY`         | Clave de la API de Anthropic (se usa desde el paso 3)                 |
| `PARALLEL_API_KEY`          | Clave de Parallel (se usa en la verificación)                         |

**En Vercel** (Settings → Environment Variables, Production):

| Variable             | Valor                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------- |
| `TRIGGER_SECRET_KEY` | En Trigger.dev: **API keys** → clave secreta del entorno **Production** (`tr_prod_…`) |

Las claves de Anthropic y Parallel solo van en Trigger.dev, que es donde corren las llamadas. Ninguna clave se pega en el chat ni se sube al repositorio.

## 3. Probar

1. Después de desplegar, en la app: **Administración → Motor de tareas → Probar el motor**.
2. En la barra lateral aparece **Tareas en curso** con "Prueba del motor de tareas" avanzando de 1 a 5 pasos. Al terminar dice **Lista**.
3. Si queda **En cola** y no avanza, revisa en Trigger.dev que el despliegue de `main` haya terminado y que la corrida aparezca en **Runs**.
4. Si dice **Falló**, el motivo aparece debajo: por ejemplo, faltan `SUPABASE_URL` o `SUPABASE_SERVICE_ROLE_KEY` en Trigger.dev.

## Desarrollo local

```bash
cd apps/jobs
npx trigger.dev@4.6.4 login
pnpm dev        # trigger dev: corre las tareas en tu equipo contra el entorno Development
```

En `apps/web/.env.local` pon la clave del entorno **Development** (`tr_dev_…`) como `TRIGGER_SECRET_KEY`.
