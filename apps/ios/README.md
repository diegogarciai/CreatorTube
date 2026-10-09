# Planificador para iOS

App nativa en SwiftUI que habla directo con la misma base de Supabase que la web. Usa la clave anon y la sesión del usuario, así que las políticas de RLS aplican igual que en la web: cada persona ve solo sus canales y su rol decide qué puede mover.

## Qué hace (v0.1)

- **Entrar** con el código de 6 a 10 dígitos que llega por correo (el mismo correo del enlace mágico de la web). El registro sigue siendo solo por invitación.
- **Canal**: recuerda el último canal usado o abre el primero por nombre, igual que `/app` en la web. Si no tienes canales, lista tus invitaciones pendientes.
- **Inicio**: meta de la semana, racha, cobertura de las próximas 2 semanas, alertas, próximas fechas (14 días) y señales del canal.
- **Episodios**: agrupados por estado, con búsqueda. En la ficha del episodio puedes cambiar el estado si tu rol lo permite.
- **Calendario**: el mes con puntos por día (relleno = publicar, contorno = grabar). Al tocar un día ves sus episodios; debajo aparecen los que no tienen fecha.

## Estructura

```
apps/ios
├── project.yml            Proyecto para XcodeGen (el .xcodeproj se genera, no se versiona)
├── Config/                App.xcconfig + Secrets.xcconfig (local, con URL y clave anon)
├── Planificador/          App SwiftUI: datos (Supabase), diseño y pantallas
└── PlanificadorCore/      Paquete Swift con la lógica pura, port 1:1 de packages/core
```

`PlanificadorCore` replica `packages/core/src/{time,planning,signals,thresholds,permissions}.ts` y sus pruebas. **Si cambia una regla en la web (umbrales, alertas, permisos), hay que cambiarla también aquí.** El flujo de CI `iOS` corre esas pruebas en cada cambio de `apps/ios`.

## Cómo abrirla en tu Mac

Requisitos: Xcode 16 o posterior y [Homebrew](https://brew.sh).

```bash
cd apps/ios
brew install xcodegen
cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig   # pon la URL y la clave anon
xcodegen generate
open Planificador.xcodeproj
```

En Xcode elige un simulador de iPhone y pulsa ▶. Para probar en tu iPhone, pon tu Team ID en `DEVELOPMENT_TEAM` dentro de `Config/Secrets.xcconfig` (así no se pierde al regenerar el proyecto) y vuelve a correr `xcodegen generate`. Si Xcode muestra "PLA Update available", acepta el nuevo acuerdo en [developer.apple.com/account](https://developer.apple.com/account).

Las pruebas de la lógica se corren sin Xcode:

```bash
cd apps/ios/PlanificadorCore && swift test
```

Cada vez que agregues o borres archivos `.swift`, vuelve a correr `xcodegen generate`.

## Supabase

- Usa `SUPABASE_URL` y `SUPABASE_ANON_KEY`, los mismos valores que `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` de la web. **Nunca** la clave `service_role`.
- La plantilla del correo de acceso (Supabase → Authentication → Email Templates → Magic Link) debe incluir el código `{{ .Token }}`. La web ya lo usa, así que no hay que cambiar nada.
- Entrar con Google todavía no está en la app. Para agregarlo hay que registrar una URL de retorno propia de la app (por ejemplo `planificador://auth-callback`) en Supabase → Authentication → URL Configuration.

## Publicar en TestFlight

Necesitas una cuenta de Apple Developer (99 USD al año). En Xcode: **Product → Archive** y luego **Distribute App → TestFlight**. El identificador de la app es `com.gartechs.planificador`; cámbialo en `project.yml` si usas otro.
