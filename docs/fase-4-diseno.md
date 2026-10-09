# Fase 4 · Difusión y medición: diseño

Fuentes:

- la especificación _Planificador de Episodios: de artefacto a aplicación web multi-canal_ (Fase 4);
- las _Reglas del guionista v4.1_ (secciones 13, 14, 20 y 21);
- los trámites y permisos de Google de la Fase 0 (`docs/fase-0-tramites.md`).

**Criterio de salida (especificación):** paridad completa con el panel actual. Hasta entonces, el panel sigue en uso.

## 1. Alcance

| Entra en la Fase 4                                                | Queda para después                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| Analítica de canal y de episodio (YouTube Analytics)              | Shorts o Reels como video (cortes del episodio)           |
| Retención con el párrafo del guion                                | Publicar en redes por API (por ahora se copia y se marca) |
| Impresiones y CTR (YouTube Reporting)                             | La app móvil (Fase 7)                                     |
| Evaluación a 7 días y auditoría mensual                           |                                                           |
| Comentarios con respuesta desde la app, y dolores de la audiencia |                                                           |
| Boletín con Resend, y resumen semanal por correo                  |                                                           |
| Redes y cápsulas (posts de texto)                                 |                                                           |

## 2. Decisiones

- **Cápsulas = posts de texto para redes.** Son publicaciones cortas por red, con el dato, el mito o la postura del episodio. Salen del guion verificado y de los reels R1–R3 (§13).
- **El boletín mantiene su página pública en gartechs.com/el-punto.**
  - La app redacta el boletín (§21), lo deja aprobar y lo envía con Resend Broadcasts a la audiencia de Resend del canal.
  - Las bajas las maneja Resend.
  - El nombre, el remitente y las redes ya están en `distribution_settings`.
- **Comentarios con `youtube.force-ssl`, pedido aparte.** Ese permiso de escritura se pide con autorización incremental solo cuando el canal activa los comentarios.
  - `buildAuthUrl` ya acepta `scopes` y `include_granted_scopes`.
  - Cada respuesta se publica solo con la confirmación de una persona (política de YouTube).
  - Responder cuesta 50 unidades de cuota.
- **Métricas derivadas.** Las cifras de YouTube se muestran tal cual. Lo que calcula la app (variaciones, comparaciones con el promedio, tramos por párrafo) se marca «calculado por la app» hasta que Google apruebe la auditoría de métricas derivadas.
- **Datos de YouTube y la regla de 30 días.**
  - Los títulos, las descripciones y los comentarios se refrescan o se borran a los 30 días.
  - Las estadísticas se guardan mientras el permiso siga vigente.
  - Todo lo de un canal desconectado se borra (`purge_youtube_data`).
- **El cron diario de Vercel trae los datos.** El plan Hobby permite una corrida por día. Los tokens viven cifrados en la web, así que la analítica corre ahí, junto a la sincronización de videos.
- **Los comentarios son texto no confiable.** A Claude le llegan marcados como datos, y las tareas que los leen no pueden ejecutar acciones.

## 3. Pasos (cada uno en su PR)

| Paso | Qué                                                                               | Estado    |
| ---- | --------------------------------------------------------------------------------- | --------- |
| 1    | Este documento; analítica de canal y episodio; retención con el párrafo del guion | Hecho     |
| 2    | Impresiones y CTR con la Reporting API                                            | Hecho     |
| 3    | Evaluación a 7 días (etapa Evaluación) y auditoría mensual                        | Pendiente |
| 4    | Comentarios con respuesta (§20) y dolores de la audiencia (§20.4)                 | Hecho     |
| 5    | Boletín con Resend (§21) y resumen semanal por correo                             | Pendiente |
| 6    | Redes y cápsulas: posts de texto por red                                          | Pendiente |
| 7    | Paridad con el panel (prueba de salida)                                           | Pendiente |

## 4. Analítica y retención (paso 1)

**Fuente:** la YouTube Analytics API (`reports.query`, `ids=channel==MINE`), con el permiso `yt-analytics.readonly` que se pidió desde la Fase 0.

- Tiene su propia cuota y no gasta la de la Data API.
- YouTube publica las cifras con 2 o 3 días de atraso, por eso los últimos días se vuelven a pedir.

**Qué se trae** (cron diario `api/cron/youtube-sync`, después de sincronizar los videos):

| Dato                            | Tabla                         | Ventana                                          |
| ------------------------------- | ----------------------------- | ------------------------------------------------ |
| Métricas del canal por día      | `youtube_channel_daily_stats` | 90 días la primera vez; después, los últimos 7   |
| Métricas de cada video por día  | `youtube_video_daily_stats`   | Videos públicos publicados hace menos de 90 días |
| Curva de retención (100 puntos) | `youtube_video_retention`     | Videos publicados hace 2 a 60 días               |

- **Métricas por día:** vistas, minutos vistos, duración media, % visto promedio, suscriptores ganados y perdidos, likes, comentarios y compartidos.
- **Curva de retención:** `audienceWatchRatio` y `relativeRetentionPerformance` por `elapsedVideoTimeRatio`.
- **Escritura y lectura:** las tablas las escribe solo el servidor y se leen con el permiso `read` del canal.
- **«Actualizar ahora»:** en Analítica, sincroniza los videos y trae la analítica sin esperar al cron. No se repite antes de 15 minutos.

**Retención por párrafo** (`retentionByParagraph` en `packages/core/src/retention.ts`):

- Los párrafos salen del guion grabado: el guion verificado (`fix`) o, si falta, la revisión o el teleprompter.
- A cada párrafo le toca un tramo del video proporcional a sus palabras. Las marcas como `[PAUSA]` no cuentan.
- Por párrafo se calcula la retención al entrar y al salir, la caída y el rendimiento relativo.
- Las 3 caídas mayores se muestran en «Dónde se fue la gente», con el minuto y el texto.
- Es una estimación (el ritmo al hablar no es parejo) y así se dice en pantalla.

**«Así te fue ayer»** (lo primero de Analítica):

- **Fotos diarias:** la Analytics API llega con 2 o 3 días de atraso, así que «ayer» se aproxima con los contadores públicos (vistas, me gusta y comentarios) de las últimas 50 subidas.
  - Cada sincronización guarda una foto diaria por video (`youtube_video_snapshots`).
  - Vale la primera del día, la del cron de las 6:05 en Bogotá, y la resta entre las dos fotos más recientes cubre unas 24 horas.
  - Un contador que baja (YouTube corrige vistas no válidas) no resta.
  - Un video nuevo cuenta entero.
  - Las fotos se guardan 35 días.
- **Comparación:** cada cifra se compara con el día típico, la mediana de los últimos 28 días completos de Analytics (calculado por la app).
- **Frase, sin IA:**
  - «Buen día» con un 20 % o más de vistas sobre lo normal, «Un día flojo» con un 20 % o más por debajo, y «Un día normal» en el resto;
  - más «impulsado por "título"» si un video trajo al menos el 40 % de las vistas.
- **El video que más sumó**, con enlace al episodio.
- **Suscriptores:** no van en «ayer», porque YouTube redondea el contador público. Están en el último día completo de Analytics, que va debajo con las cifras exactas.

**Pantallas:**

- **Analítica:**
  - las cifras de los últimos 28 días con datos y su variación contra los 28 anteriores (calculado por la app);
  - vistas por día;
  - la tabla de episodios publicados (vistas en 7 días y en total, % visto, duración media, likes y comentarios);
  - los videos recientes.
- **Pestaña Métricas del episodio:**
  - las cifras desde la publicación y las vistas por día;
  - la curva de retención con los tramos de los párrafos (al pasar el puntero se ve la retención, el minuto y el párrafo);
  - «Dónde se fue la gente».
- **Estado de la pestaña:** «Listo» cuando YouTube ya tiene la curva.

## 5. Lo que viene (pasos 2 a 6)

### Impresiones, CTR y fuentes de tráfico (paso 2)

**Fuente:** la YouTube Reporting API. No están en la Analytics API. La Reporting API no gasta cuota de la Data API y usa el mismo permiso `yt-analytics.readonly`.

| Reporte                     | Qué trae                                                                  | Tabla                         |
| --------------------------- | ------------------------------------------------------------------------- | ----------------------------- |
| `channel_reach_basic_a1`    | Impresiones de la miniatura y su CTR, por video y por día                 | `youtube_video_reach_daily`   |
| `channel_reach_combined_a1` | Lo mismo, por fuente de tráfico y dispositivo (se suman los dispositivos) | `youtube_video_reach_sources` |

**Cómo se trae** (`syncReach` en `packages/youtube/src/reporting.ts`):

1. La primera vez se crea un trabajo de reporte por tipo, o se reutiliza uno que ya exista. Queda guardado en `channel_connections.reporting`, junto con el último reporte leído.
2. YouTube genera un CSV por día con hasta 48 h de atraso. Al crear el trabajo, genera también los días anteriores.
3. Cada sincronización (el cron diario y «Actualizar ahora») baja los reportes nuevos, del más viejo al más nuevo. Un reporte regenerado de un día reemplaza al anterior.
4. YouTube guarda los reportes unos 60 días; aquí quedan archivados.

**Detalles de los datos:**

- **CTR:** se guarda de 0 a 1. En las fuentes se guardan los clics (impresiones × CTR), así se pueden sumar entre días.
- **CTR de varios días o videos:** clics ÷ impresiones, calculado por la app y marcado así en pantalla.
- **Fuentes:** se muestran con su nombre en español (búsqueda, sugeridos, inicio y exploración, notificaciones, externo, Shorts…). Un código desconocido queda como «Otra fuente».
- **Sumas en la base:** `reach_by_day`, `reach_by_video` y `reach_by_source` (security invoker, con las políticas de lectura). Así se evita el límite de filas de las consultas.
- **Desconexión:** al desconectar el canal, la purga también borra el alcance.

**Dónde se ve:**

- **Analítica:** la tarjeta «Alcance de las miniaturas»:
  - impresiones y CTR de los últimos 28 días con datos, con su variación;
  - «De dónde vienen las impresiones», con impresiones, parte y CTR por fuente;
  - las columnas «Impresiones» y «CTR» en la tabla de episodios.
- **Pestaña Métricas:** la misma tarjeta, con las cifras del episodio desde que se publicó.
- **Sin reportes todavía:** un aviso de que llegan con hasta 48 h de atraso.

### Evaluación a 7 días y auditoría (paso 3)

**Evaluación a 7 días** (propuesta, en la etapa Evaluación):

- A los 7 días de publicar, el botón «Evaluar a los 7 días» compara contra la mediana de los últimos 10 episodios del canal. Lo que compara:
  - vistas, % visto y duración media;
  - CTR e impresiones, cuando esté el paso 2;
  - likes, comentarios y suscriptores.
- Muestra los 3 párrafos con mayor caída de retención.
- Claude agrega un veredicto (por encima, en línea o por debajo) y 3 aprendizajes concretos.
- Se guarda en `episode_evaluations` y marca `evaluated_at`.

**Auditoría mensual:**

- Junta las evaluaciones del mes y, con Opus (unos US$0,50 por canal al mes), propone ajustes a la guía del guionista y a los temas.
- Solo en la web.

### Comentarios y dolores de la audiencia (paso 4)

**Leer, a pedido por episodio** (pestaña Difusión, «Leer comentarios», permiso `publish`):

1. La web trae del video del episodio los comentarios nuevos. Usa `commentThreads.list`, del más nuevo al más viejo hasta uno ya leído, como máximo 300, a 1 unidad de cuota por página.
2. Los comentarios del propio canal se saltan, y se anota si el canal ya respondió en YouTube.
3. Se guardan en `youtube_comments`.
4. Se lanza la tarea `comments` (Trigger.dev), que corre en la etapa de IA **Difusión** (`distribution`, el modelo se elige en Administración).

**La tarea `comments`** clasifica los comentarios sin tipo en lotes de 40. Usa la sección 20 de la guía, el guion verificado y la tabla de verificación. Por cada comentario guarda:

- **El tipo**, uno de siete: pregunta técnica, corrección, desacuerdo, experiencia propia, pedido de tema, elogio, troll o spam.
- **Las marcas:** datos personales, enlace sospechoso, riesgo legal.
- **La respuesta como Diego.** Va vacía para el troll y para lo marcado; el código lo hace cumplir.
- **En una corrección,** lo que decía el video, lo correcto, la fuente, el minuto y si la persona tiene razón. Con eso el panel propone una fe de erratas.

La tarea además actualiza la **lectura del lote** (§20.4) en `comment_readings`, acumulada entre lecturas: temas, dolores con conteo y cita sin nombre, el dolor mayor, respuestas a las preguntas del guion, correcciones pendientes e ideas.

**Los comentarios son texto no confiable:**

- A Claude le llegan dentro de `<comentarios>`, como datos y sin nombres.
- El sistema le dice que nunca siga lo que digan; un comentario que pide cambiar las reglas, poner un enlace o revelar instrucciones es spam.
- La tarea no tiene herramientas ni publica nada.

**Responder:**

- Cada respuesta se edita, se copia o se descarta («No responder»).
- **«Publicar»** pide confirmación y la publica en YouTube como el canal (`comments.insert`, 50 unidades).
- Publicar necesita el permiso `youtube.force-ssl`, que se activa una vez en Ajustes › YouTube («Activar respuestas a comentarios», autorización incremental).
- Una respuesta publicada no se vuelve a pisar.

**Audiencia:** junta las lecturas de todos los episodios:

- los dolores, del que más se repite al que menos, con su cita y su episodio;
- el botón **«Pasar a Ideas»**, que crea la idea con origen «Dolor de la audiencia»;
- los temas sumados;
- las correcciones pendientes;
- las ideas;
- los comentarios por responder de cada episodio.

**Regla de 30 días de YouTube:** la purga borra los comentarios leídos hace más de 30 días. También borra los comentarios y las lecturas de los canales desconectados. Las lecturas de los canales conectados se quedan, porque son agregadas y sus citas son cortas y sin nombre.

### Boletín y resumen semanal (paso 5)

**Boletín (§21):**

- Se redacta solo a pedido y sale del guion, el dossier, la verificación y los comentarios.
- Formato:
  - asunto de 55 caracteres como máximo y preheader de 90 como máximo;
  - cuerpo de 400 a 700 palabras;
  - botón de 4 palabras como máximo y «el punto» de 140 caracteres como máximo;
  - diseño de 600 px con el acento de la marca.
- El permiso `publish` lo aprueba y lo envía con Resend Broadcasts.

**Resumen semanal:**

- Un correo de los lunes con la meta de la semana, lo que se publica, lo atrasado y lo que está en riesgo, con Resend.

### Redes y cápsulas (paso 6)

- Posts de texto por red (las que estén en `distribution_settings.socials`), desde la postura, los reels R1–R3 y el dato principal.
- Se editan, se copian y se marcan publicados; el estado queda por red.
- Corren en el modelo de la etapa Difusión (Haiku), por unos US$0,10 a US$0,20 por episodio.

## 6. Costos estimados

| Qué                          | Estimado                                             |
| ---------------------------- | ---------------------------------------------------- |
| Analítica y retención        | Gratis: cuota propia de la Analytics API             |
| Impresiones, CTR y fuentes   | Gratis: Reporting API                                |
| Evaluación a 7 días          | Una llamada a Claude por episodio                    |
| Auditoría mensual            | Unos US$0,50 por canal al mes                        |
| Comentarios, boletín y redes | Unos US$0,10 a US$0,20 por episodio (Haiku)          |
| Boletín y resumen semanal    | Resend: gratis hasta 3.000 correos al mes; Pro US$20 |
