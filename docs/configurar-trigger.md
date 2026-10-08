# Configurar Trigger.dev (motor de tareas)

Las tareas largas (preguntas de dirección, etapas del guion, verificación) corren en Trigger.dev, no en Vercel. El código está en `apps/jobs`. Cada corrida actualiza su fila en la tabla `tasks`, y la barra lateral de la app la muestra en vivo con Supabase Realtime.

## 1. Proyecto y despliegue desde GitHub

1. En https://cloud.trigger.dev, crea el proyecto, por ejemplo `planificador`, y copia su **Project ref** (`proj_…`) desde **Project settings**. No es secreto: va en `apps/jobs/trigger.config.ts`.
2. En **Project settings → Git**:
   - **Install GitHub app** y conecta `diegogarciai/CreatorTube`.
   - **Production branch:** `main`.
   - **Trigger config file:** `apps/jobs/trigger.config.ts`.
   - Deja las vistas previas de PR apagadas por ahora.

   Cada push a `main` despliega las tareas.

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
