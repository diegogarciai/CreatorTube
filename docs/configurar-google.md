# Configurar los servicios de Google

Google se usa en dos lugares:

1. **Conectar el canal de YouTube.** Lo hace la app con su propio OAuth (`/api/youtube/connect` → `/api/youtube/callback`), con los permisos `youtube.readonly` y `yt-analytics.readonly`.
2. **Entrar con Google.** Lo hace Supabase Auth, con su redirección `https://<proyecto>.supabase.co/auth/v1/callback`.

Recomendación: **un solo proyecto de Google Cloud y un solo cliente OAuth** con las redirecciones de los dos usos. Así hay una sola pantalla de consentimiento y una sola verificación.

## 0. Antes de empezar

- Ten el **nombre y el dominio definitivos**. Cambiarlos después obliga a verificar de nuevo, y el nombre no puede contener "YouTube" ni "YT". Actualiza `packages/config/src/brand.ts`.
- Usa una **cuenta de Google de la empresa** como dueña del proyecto, no una personal.
- Despliega la web en el dominio con `/`, `/privacidad` y `/terminos` públicos (Vercel). Google los revisa.

## 1. Crear el proyecto

1. Entra a https://console.cloud.google.com → selector de proyectos → **Nuevo proyecto** (por ejemplo `planificador-prod`).
2. Opcional: crea otro proyecto `planificador-dev` para desarrollo, con sus propias credenciales. La cuota de YouTube es por proyecto, y está prohibido repartir la carga de producción entre varios proyectos.

## 2. Habilitar las APIs

En **APIs y servicios → Biblioteca**, habilita:

- **YouTube Data API v3**
- **YouTube Analytics API**
- (Fase 4) **YouTube Reporting API**: todavía no hace falta.

## 3. Configurar Google Auth Platform (pantalla de consentimiento)

Menú **Google Auth Platform** (antes "Pantalla de consentimiento de OAuth") → **Comenzar**:

1. **Branding:**
   - Nombre de la app y correo de soporte.
   - Logo de 120×120 px (si lo subes, Google lo revisa).
   - Página principal `https://tu-dominio`, política de privacidad `https://tu-dominio/privacidad` y términos `https://tu-dominio/terminos`.
   - **Dominios autorizados:** `tu-dominio` y `supabase.co`. Si usas un dominio propio para Supabase Auth, agrega ese en lugar de `supabase.co`.
   - Correo de contacto del desarrollador.
2. **Público (Audience):**
   - Tipo **Externo**.
   - Estado inicial **Prueba**. En **Usuarios de prueba** agrega tu correo y el de la cuenta dueña del canal Gartechs (máximo 100).
3. **Acceso a datos (Data access) → Agregar permisos:**
   - `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` (no sensibles)
   - `https://www.googleapis.com/auth/youtube.readonly` (sensible)
   - `https://www.googleapis.com/auth/yt-analytics.readonly` (sensible)
   - No agregues `youtube.force-ssl` todavía. Se pide en la Fase 4 con autorización incremental.

## 4. Verificar el dominio

1. En https://search.google.com/search-console agrega la propiedad de **dominio** `tu-dominio` y verifícala con el registro TXT de DNS.
2. La cuenta que verifica debe ser propietaria o editora del proyecto de Cloud. Si no, Google no reconoce el dominio en la verificación.

## 5. Crear el cliente OAuth

**Google Auth Platform → Clientes → Crear cliente**, tipo **Aplicación web**, nombre `planificador-web`:

- **Orígenes de JavaScript autorizados:** `https://tu-dominio` y `http://localhost:3000`
- **URIs de redirección autorizados:**
  - `https://tu-dominio/api/youtube/callback` (conexión de YouTube, la hace la app)
  - `https://<ref>.supabase.co/auth/v1/callback` (entrar con Google, lo hace Supabase)
  - `http://localhost:3000/api/youtube/callback` y `http://127.0.0.1:54321/auth/v1/callback` (desarrollo local)

Copia el **ID de cliente** y el **secreto** y guárdalos en un gestor de contraseñas. El secreto solo se muestra completo al crearlo.

## 6. Variables de entorno de la app

Para Vercel (Settings → Environment Variables) y para `apps/web/.env.local` en desarrollo:

```
GOOGLE_CLIENT_ID=<id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<secreto>
TOKEN_ENCRYPTION_KEY=<node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
APP_URL=https://tu-dominio
NEXT_PUBLIC_APP_URL=https://tu-dominio
```

`TOKEN_ENCRYPTION_KEY` debe ser **distinta en cada entorno y no puede cambiar**: si cambia, cada canal tiene que reconectarse. `APP_URL` tiene que coincidir exactamente con la redirección registrada, o Google responde `redirect_uri_mismatch`.

## 7. Entrar con Google en Supabase

1. En Supabase: **Authentication → Sign In / Providers → Google** → activar → pega el mismo ID y secreto → guardar.
2. En **Authentication → URL Configuration:** Site URL `https://tu-dominio` y Redirect URLs `https://tu-dominio/auth/callback`.
3. En **Authentication → Hooks:** activa **Before User Created** → función `public.hook_before_user_created`. Sin este paso, cualquiera con cuenta de Google podría registrarse.
4. En local, `supabase start` toma `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` del entorno: expórtalas antes de arrancar.

## 8. Probar en modo de prueba

1. Entra a la app con tu correo de usuario de prueba (debe estar en `platform_admins` o tener invitación).
2. Ve a **Configuración del canal → Conectar YouTube**. En Google, **elige la cuenta o cuenta de marca dueña del canal**: muchos canales viven en una cuenta de marca y no en la personal.
3. Acepta la advertencia "Google no verificó esta app", que es normal en modo de prueba.
4. Al volver, el canal aparece **Conectado**. **Sincronizar ahora** debe leer videos, que aparecen en **Analítica**.
5. Pega el enlace de un video programado en un episodio: debe quedar **Programado**.

**Límite del modo de prueba:** el acceso vence cada 7 días y hay que reconectar.

## 9. Pasar a producción (puente para la beta)

- En **Público → Publicar app**. La app sigue sin verificar: muestra advertencia y admite 100 usuarios en toda su vida, pero el acceso ya no vence semanalmente.
- Úsalo para Gartechs y los primeros invitados mientras llega la verificación.

## 10. Pedir la verificación (permisos sensibles)

En **Google Auth Platform → Centro de verificación → Preparar para la verificación**:

1. **Justificación por permiso:**
   - `youtube.readonly`: "leer la lista de subidas, el estado de privacidad y la fecha programada para mover los episodios del creador a Programado y Publicado".
   - `yt-analytics.readonly`: "mostrar al creador las métricas de sus propios videos".
2. **Video demo en inglés** (no listado en YouTube). Debe mostrar:
   - la pantalla de consentimiento con la URL del navegador visible, incluido el `client_id`;
   - el flujo completo de conectar el canal;
   - dónde se usa cada permiso en la app;
   - cómo desconectar.
3. Confirma que la política de privacidad cumple la **Política de datos de usuario de los servicios de API de Google** (uso limitado) y enlaza https://myaccount.google.com/connections. El borrador en `/privacidad` ya lo menciona, pero revísalo con asesoría legal.
4. Envía y responde los correos de Google. Los plazos varían: de días a semanas.

No hace falta la auditoría de seguridad CASA, porque esos permisos son sensibles y no restringidos.

## 11. Cuota de YouTube

- La cuota por defecto es de 10.000 unidades al día por proyecto. La app usa unas 3 unidades por canal en cada sincronización y se frena sola al llegar a 9.000 (`apps/web/app/api/cron/youtube-sync/route.ts`).
- Revisa el consumo en **APIs y servicios → YouTube Data API v3 → Cuotas**.
- Antes de pasar de unos 20 canales, llena el **YouTube API Services – Audit and Quota Extension Form**. En el mismo formulario pide el permiso de **métricas derivadas** (señales y comparaciones calculadas por la app).

## 12. Problemas comunes

| Síntoma                                                | Causa                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `redirect_uri_mismatch`                                | La URI no coincide exactamente con `APP_URL` (http/https, barra final, puerto) |
| `access_denied`                                        | El correo no está en usuarios de prueba                                        |
| La app vuelve a `/onboarding?error=youtube_no_channel` | Se eligió una cuenta sin canal: elige la cuenta de marca                       |
| Error `youtube_state`                                  | La cookie de inicio venció (10 min) o se abrió en otro navegador               |
| El canal pasa a "Hay que reconectar"                   | El acceso se revocó o venció (los 7 días del modo de prueba)                   |
| `quotaExceeded` en "Última sincronización"             | Se agotó la cuota diaria; se reinicia a medianoche, hora del Pacífico          |
