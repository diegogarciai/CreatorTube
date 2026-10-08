# Configurar Supabase

## 1. Base de datos

1. En Supabase: **Connect → Session pooler** → copia la URI y pon la contraseña de la base. La conexión directa es solo IPv6 y GitHub Actions no la alcanza.
2. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**, nombre `SUPABASE_DB_URL`, con la URI como valor.
3. En **Actions → Supabase migrations → Run workflow**, escribe en `admin_email` el correo con el que vas a entrar. El workflow aplica las migraciones y te registra como administrador de la plataforma. Cuando llegan migraciones nuevas a `main`, corre solo.

## 2. Registro solo por invitación

**Authentication → Hooks → Add hook → Before User Created → Postgres** → esquema `public`, función `hook_before_user_created`. La función aparece después de aplicar las migraciones. Sin este hook, cualquiera podría registrarse.

## 3. Direcciones

En **Authentication → URL Configuration**:

- **Site URL:** `https://app.gartechs.com`
- **Redirect URLs:** `https://app.gartechs.com/auth/callback` y, para desarrollo, `http://localhost:3000/auth/callback`

## 4. Entrar con Google

En **Authentication → Sign In / Providers → Google**: actívalo y pega el ID de cliente y el secreto del cliente OAuth. Ver [`configurar-google.md`](configurar-google.md).

## 5. Plantillas de correo (enlace y código)

El enlace que trae Supabase por defecto solo funciona en el mismo navegador donde se pidió, y algunos correos lo gastan al revisarlo antes de entregarlo. Las plantillas de abajo traen dos cosas:

- un **enlace con token**, que funciona en cualquier navegador;
- un **código de 6 dígitos**, que se escribe en la página de entrar y no lo gastan los escáneres.

En **Authentication → Email Templates**, reemplaza estas dos plantillas.

**Magic Link** (asunto: `Tu acceso a Planificador`):

<!-- prettier-ignore -->
```html
<h2>Entrar a Planificador</h2>
<p>Tu código de acceso es:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>Escríbelo en la página de entrar, o usa este enlace:</p>
<p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/app">Entrar a Planificador</a></p>
<p>El código y el enlace vencen en una hora y sirven una sola vez.</p>
```

**Confirm signup** es el que reciben las personas la primera vez que entran. Asunto: `Confirma tu acceso a Planificador`; el cuerpo es el mismo de arriba.

Si cambias la duración del código en _Authentication → Providers → Email → Email OTP Expiration_, ajusta el texto "vencen en una hora".
