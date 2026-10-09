# Subir la app a TestFlight

Guía para mandar una versión de Planificador a TestFlight desde tu Mac. La primera vez toma unos 30 minutos; después, unos 10.

## Lo que ya está listo en el proyecto

- Ícono de 1024 px sin transparencia y pantalla de inicio.
- `ITSAppUsesNonExemptEncryption = NO`: App Store Connect no pregunta por cifrado en cada build.
- Manifiesto de privacidad (`Planificador/Resources/PrivacyInfo.xcprivacy`): sin rastreo; declara UserDefaults y los datos de la cuenta y del canal.
- Permiso para guardar en Fotos lo que descargas en Producción.
- Versión `1.0.0`, build `1` (en `project.yml`).
- El CI compila en Release, que es lo mismo que se sube.

## 1. Una sola vez: crear la app en App Store Connect

1. Entra a [developer.apple.com/account](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles** → **Identifiers**. Si `com.gartechs.planificador` no está, créalo con **+** → **App IDs** → **App**. No hace falta marcar ninguna capacidad.
2. Entra a [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Apps** → **+** → **New App**:
   - **Platforms**: iOS
   - **Name**: Planificador. El nombre tiene que ser único en la App Store; si está ocupado, usa por ejemplo «Planificador Gartechs». Solo es el nombre de la tienda: en el iPhone se sigue viendo «Planificador».
   - **Primary Language**: Spanish (Mexico) o el español que prefieras
   - **Bundle ID**: `com.gartechs.planificador`
   - **SKU**: `planificador-ios` (cualquier texto; no se muestra)
   - **User Access**: Full Access

## 2. Cada vez: generar el archivo y subirlo

1. En GitHub Desktop, ponte en `main` y haz **Pull**.
2. Revisa que `apps/ios/Config/Secrets.xcconfig` tenga la URL y la clave anon de producción y tu `DEVELOPMENT_TEAM`. Esos valores van dentro de la app que subes.
3. En la Terminal:
   ```bash
   cd apps/ios
   xcodegen generate
   open Planificador.xcodeproj
   ```
4. En Xcode, arriba en el selector de dispositivo, elige **Any iOS Device (arm64)**, no un simulador.
5. **Product → Archive**. Al terminar se abre el **Organizer** con el archivo nuevo.
6. **Distribute App** → **App Store Connect** → **Distribute**. Deja marcadas las opciones por omisión:
   - **Upload your app's symbols**
   - **Manage Version and Build Number**: si el build ya existe, Xcode sube el número solo.
   - **Automatically manage signing**: Xcode crea el certificado de distribución la primera vez.
7. Cuando diga **Upload Successful**, espera el correo «has completed processing». Suele tardar de 5 a 30 minutos.

Si prefieres llevar el número de build a mano, súbelo en `CURRENT_PROJECT_VERSION` de `project.yml` antes de archivar. Cada build que subas a la misma versión necesita un número mayor.

## 3. Probarla

**Pruebas internas** (tu equipo, sin revisión de Apple, hasta 100 personas):

1. Si alguien no está en tu cuenta, agrégalo en App Store Connect → **Users and Access** con el rol que quieras (por ejemplo, Marketing o Developer).
2. En la app → **TestFlight** → **Internal Testing** → **+**, crea un grupo (por ejemplo, «Equipo») y agrega a las personas.
3. Agrega el build al grupo. Les llega un correo; instalan **TestFlight** desde la App Store y desde ahí la app.

**Pruebas externas** (cualquier correo o un enlace público, hasta 10 000 personas): el primer build pasa por la revisión de Apple, que tarda de unas horas a un día. Hay que llenar **Test Information** (descripción, correo para comentarios) y darle a Apple **una cuenta para entrar**. Como la app entra con un código por correo o con Google, Apple no puede usarla tal cual. Antes de abrir pruebas externas hay que preparar un acceso de revisión; pídemelo y lo armamos.

Cada build vence a los 90 días en TestFlight.

## 4. Automático con Xcode Cloud

Con Xcode Cloud, Apple compila y sube a TestFlight cada vez que unes algo a `main` que toque `apps/ios`. Tú no archivas nada; el equipo recibe la versión nueva en unos 20 o 30 minutos. La membresía de Apple Developer incluye 25 horas de compilación al mes, y cada build toma unos 10 o 15 minutos.

El proyecto ya trae `ci_scripts/ci_post_clone.sh`. Xcode Cloud lo corre al clonar el repo:

- escribe `Secrets.xcconfig` con las variables del workflow;
- genera el `.xcodeproj` con XcodeGen;
- copia `apps/ios/Package.resolved`, con las versiones exactas de los paquetes, y los resuelve. Xcode Cloud no descarga paquetes sin ese archivo.

El CI de GitHub corre el mismo script en cada cambio, así que si se rompe se ve ahí primero.

### Configurarlo (una sola vez)

1. Ten `main` al día y el proyecto abierto en Xcode, con `xcodegen generate` corrido.
2. **Product → Xcode Cloud → Create Workflow**, elige **Planificador** y pulsa **Next**. Luego **Edit Workflow**.
3. **General**: nombre `TestFlight`.
4. **Environment**:
   - Xcode: **Latest Release**.
   - En **Environment Variables**, agrega:
     - `SUPABASE_URL`: la URL completa, con `https://`.
     - `SUPABASE_ANON_KEY`: la clave anon. Marca **Secret**.
     - `DEVELOPMENT_TEAM`: tu Team ID, el mismo de `Secrets.xcconfig`.
5. **Start Conditions**:
   - Borra la que trae.
   - Agrega **Branch Changes**: rama `main`.
   - En **Files and Folders** elige **Start a build if any changes are in…** y pon `apps/ios`.
6. **Actions**:
   - Borra las que trae.
   - Agrega **Archive**, plataforma **iOS**.
   - En **Deployment Preparation**, elige **TestFlight (Internal Testing Only)**.
7. **Post-Actions**: agrega **TestFlight Internal Testing** y elige tu grupo, por ejemplo «Equipo».
8. **Save**. Xcode pide dar acceso a GitHub: **Grant Access**, instala la app de Xcode Cloud en `diegogarciai/CreatorTube` y vuelve a Xcode.
9. Para la primera build: **Product → Xcode Cloud → Start Build**, workflow `TestFlight`, rama `main`. El avance se ve en Xcode, en el **Report navigator** (⌘9) → **Cloud**, o en App Store Connect → tu app → **Xcode Cloud**.

### Número de build

Xcode Cloud pone el número de build solo. Si choca con uno que subiste a mano, ve a App Store Connect → tu app → **Xcode Cloud** → **Settings** → **Build Number** y pon como siguiente número uno mayor que el último que subiste.

## Si algo falla

| Mensaje | Qué hacer |
| --- | --- |
| «No profiles for 'com.gartechs.planificador' were found» | Xcode → Settings → Accounts: entra con tu Apple ID y vuelve a archivar. Revisa `DEVELOPMENT_TEAM` en `Secrets.xcconfig`. |
| «The bundle version must be higher than the previously uploaded version» | Sube `CURRENT_PROJECT_VERSION` en `project.yml`, corre `xcodegen generate` y archiva de nuevo. |
| «No suitable application records were found» | Falta el paso 1: la app en App Store Connect con ese Bundle ID. |
| Correo «ITMS-91053: Missing API declaration» | La app usa una API nueva con motivo declarado. Agrégala a `PrivacyInfo.xcprivacy`. |
| Archive aparece gris en el menú | El destino es un simulador. Elige **Any iOS Device (arm64)**. |
| La app instalada muestra «Falta configurar Supabase» | `Secrets.xcconfig` estaba vacío al archivar. Rellénalo, regenera y vuelve a subir. |
| Xcode Cloud: «faltan SUPABASE_URL o SUPABASE_ANON_KEY» | Agrega las variables en **Environment** del workflow. |
| Xcode Cloud: «a resolved file is required» o «project not found» | Revisa que `apps/ios/ci_scripts/ci_post_clone.sh` y `apps/ios/Package.resolved` estén en `main`. Si cambiaste la versión de un paquete en `project.yml`, el CI de GitHub falla y muestra el `Package.resolved` nuevo: cópialo a `apps/ios/Package.resolved`. |
| Xcode Cloud: «Signing requires a development team» | Falta la variable `DEVELOPMENT_TEAM` en el workflow. |

## Antes de publicar en la App Store

TestFlight no lo pide, pero la App Store sí:

- **App Privacy** en App Store Connect, con los mismos datos del manifiesto: correo, nombre, ID de usuario, fotos y contenido, todo para que la app funcione, sin rastreo.
- **Política de privacidad**: una URL pública.
- **Borrar la cuenta desde la app**, obligatorio para apps con registro.
- Capturas de pantalla, descripción y la cuenta de revisión.
