# Planificador para iOS

App nativa en SwiftUI que habla directo con la misma base de Supabase que la web. Usa la clave anon y la sesión del usuario, así que las políticas de RLS aplican igual que en la web: cada persona ve solo sus canales y su rol decide qué puede mover.

## Qué hace

Está a la par con la web en todo lo del día a día. Pestañas: **Inicio**, **Ideas**, **Producción**, **Calendario** y **Más**.

- **Entrar** con Google o con el código del correo. El registro sigue siendo solo por invitación; también se acepta una invitación pegando su enlace.
- **Inicio**: meta de la semana, racha, cobertura, alertas, próximas fechas, señales del canal, aviso de banco de ideas bajo y de préstamos de marcas por devolver.
- **Ideas**: banco con filtros y puntaje; crear, editar, descartar y «Arrancar episodio». Sugeridas por IA («Proponer ideas» y «Aceptar»), con por qué, riesgo, pilar y el equipo que usan, y los videos atípicos de la competencia.
- **Producción**: lista o tablero por estado, búsqueda y archivados. Crear, editar y archivar episodios y moverlos de estado según el rol.
- **Ficha del episodio**:
  - etapas y siguiente paso (lleva a Guion, Producción, Difusión o Métricas), todos los campos y la ficha de entrada;
  - equipo del episodio (protagonista o herramienta, su foto a las miniaturas) y el bloque para la descripción;
  - vincular el video, checklist y actividad;
  - **Guion**: dirección, etapas, verificación y corridas, con las acciones de IA;
  - **Producción**: ayudas visuales (aprobar, corregir sus textos y renderizar), miniaturas, recursos y títulos, con las acciones de IA;
  - **Difusión**: posts para redes (generar, editar, copiar con el enlace, marcar publicado) y comentarios con respuesta sugerida (publicar en YouTube, pasar a Ideas), y el boletín del episodio;
  - **Métricas**: retención por párrafo, alcance (impresiones, CTR, fuentes) y evaluación a 7 días.
- **Calendario**: el mes con puntos por día, crear en un día, cambiar fechas y suscribirse al ICS.
- **Más**:
  - todos mis canales y búsqueda;
  - analítica y «Así te fue ayer», con alcance, búsquedas que traen gente y auditoría mensual;
  - audiencia (dolores, por responder, temas, correcciones) y boletín semanal (redactar, probar, enviar o programar);
  - Mi equipo: inventario de dispositivos con foto, pegar una lista para que Claude la ordene, por revisar, devolver o retirar;
  - tareas en curso;
  - configuración del canal: perfil, ritmo, pilares, checklist, guía del guionista, kit de marca, redes, competencia, boletín, fotos del presentador, ICS, YouTube (conectar, sincronizar, desconectar, importar videos, activar respuestas a comentarios);
  - espacio y equipo: créditos, miembros, invitar, roles;
  - avisos diarios y nuevo canal.

**Sigue solo en la web**: el panel de administración y el guion de animación (los momentos) de un motion graphic.

**Lo que usa IA o YouTube** pasa por `POST /api/mobile/<acción>` en la web, con la sesión de la app en `Authorization: Bearer`. Son las mismas acciones del servidor, con los mismos permisos y costos. Si la web todavía no tiene esa ruta, la app avisa que la función no está disponible.

## Estructura

```
apps/ios
├── project.yml            Proyecto para XcodeGen (el .xcodeproj se genera, no se versiona)
├── Config/                App.xcconfig + Secrets.xcconfig (local, con URL y clave anon)
├── Planificador/          App SwiftUI: datos (Supabase), diseño y pantallas
└── PlanificadorCore/      Paquete Swift con la lógica pura, port 1:1 de packages/core
```

`PlanificadorCore` replica la lógica pura de la web con sus pruebas: `packages/core/src/{time,planning,signals,thresholds,permissions,episodes,ideas,retention,guide,socials,comments,evaluation,newsletter,gear}.ts` y `apps/web/lib/daily-report.ts`. **Si cambia una regla en la web (umbrales, alertas, permisos), hay que cambiarla también aquí.** El flujo de CI `iOS` corre esas pruebas en cada cambio de `apps/ios`.

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
- **Entrar con Google** necesita que `planificador://auth-callback` esté en Supabase → Authentication → URL Configuration → **Redirect URLs**. Sin eso, Google devuelve a la web en lugar de a la app.

## Publicar en TestFlight

Necesitas una cuenta de Apple Developer (99 USD al año). El paso a paso, con los errores comunes, está en [TESTFLIGHT.md](TESTFLIGHT.md). En corto: en Xcode elige **Any iOS Device (arm64)**, luego **Product → Archive** y **Distribute App → App Store Connect**. El identificador de la app es `com.gartechs.planificador`.
