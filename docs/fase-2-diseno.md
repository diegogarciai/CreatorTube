# Fase 2 · IA y guion: diseño

Borrador para aprobar antes de escribir código. Fuentes:

- la especificación _Planificador de Episodios: de artefacto a aplicación web multi-canal_ (Fase 2);
- el documento _Gartechs · Reglas del guionista v4.1, preguntas de dirección y etapas del guion_ (7 de octubre de 2026).

**Criterio de salida (especificación):** Gartechs graba un episodio con un guion hecho en la app, y el artefacto queda en solo lectura.

## 1. Alcance

| Entra en la Fase 2                                                     | Queda para después                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Motor de tareas con progreso en vivo                                   | Render de motion graphics con Remotion (Fase 3)                                  |
| Créditos por espacio y costo estimado antes de cada acción             | Generación de miniaturas en Artlist (Fase 3); la etapa 4 deja su diseño en texto |
| Guía del guionista por versiones, con secciones                        | Comentarios, El Punto y difusión (Fase 4)                                        |
| Preguntas de dirección                                                 | Comandos de chat (EXAMÍNAME, PROFUNDIZA…): las reglas los dejan fuera del panel  |
| Guion en 5 etapas: Estudio, Guion, Verificación, Publicación y Podcast | Recomendaciones de ideas con IA, si no alcanza el tiempo (ver decisiones)        |
| Verificación con Parallel Search, reanudable                           |                                                                                  |
| Keywords y pilar al terminar Publicación                               |                                                                                  |
| Migración de los episodios de Gartechs desde el artefacto              |                                                                                  |

## 2. Cómo fluye un episodio

```
Idea ─ Arrancar episodio ─┐
Nuevo episodio (Idea, Guion o Por grabar) ─┼─> Dirección: 6 a 9 preguntas ─> respuestas (o Saltar)
Episodio → Crear guion ───┘                                   │
                                                              v
                      Estudio ─> Guion ─> Verificación ─> Publicación ─> Podcast
                      (cada etapa es una tarea; se ve en vivo y se puede regenerar desde cualquiera)
```

Los cuatro puntos de entrada de la tabla "Cuándo aparecen" se respetan tal cual:

- **Guiones → tema → Generar guion:** crea el episodio y abre las preguntas.
- **Nuevo episodio** con estado Idea, Guion o Por grabar: al guardar, abre **Dirección**.
- **Ideas → Arrancar episodio:** el episodio pasa a Guion y las preguntas se preparan en segundo plano.
- **Episodio → Crear guion:** si ya hay respuestas, arranca directo; si no, pregunta primero.

## 3. Guía del guionista por versiones

Las tablas `writer_guides` y `writer_guide_versions` ya existen. A la versión se le agregan:

- `sections jsonb`: el texto separado por sección (`"0"` … `"24"`). Se corta por los títulos numerados (`0. PRIORIDADES`, `1. ROL`…) al guardar. Si una sección no se reconoce, la versión no se guarda.
- `stage_sections jsonb`: qué secciones recibe cada etapa. Por defecto, la tabla del documento:

  | Etapa                  | Secciones                                                                                                |
  | ---------------------- | -------------------------------------------------------------------------------------------------------- |
  | Preguntas de dirección | 2                                                                                                        |
  | Estudio                | 0, 1, 2, 3, 4, 5, 7, 15                                                                                  |
  | Guion                  | 0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 15, 23                                                           |
  | Verificación           | 10 para extraer y verificar; 0, 2, 6, 7, 8, 9, 10, 13, 15 para corregir; 0, 6, 9, 10, 12, 13 para marcar |
  | Publicación            | 0, 1, 2, 3, 6, 7, 8, 9, 12, 13, 14, 15, 16, 23                                                           |
  | Podcast                | 0, 1, 2, 6, 7, 9, 15, 22, 23                                                                             |

- **Una sola fuente.** Como hoy en el panel, se edita en **Ajustes del canal → Guía del guionista**. Al pegar una versión nueva se guarda con número, nota de cambios y quién la subió, y se ve la diferencia con la anterior. Cada guion guarda con qué versión se escribió (`episodes.writer_guide_version_id`, que ya existe).
- **Las reglas no van en el repositorio.** Diego pega la v4.1 en la app y queda en la base, aislada por espacio como todo lo demás.
- El documento «Instrucciones para la creacion de Guiones» del proyecto de chat sigue desactualizado en v4.0. Eso no lo resuelve la app: hay que reemplazarlo a mano.

## 4. Preguntas de dirección

**Quién las arma.** Una llamada a Claude Sonnet 5.5 (el "modelo equilibrado" del documento) recibe:

- la sección 2 de la guía;
- los 4 tipos de episodio y la ficha de entrada;
- el tema, la postura, las notas, el pilar y la duración objetivo;
- el contexto del canal: videos publicados y próximo video programado.

**Salida estructurada** (JSON validado con esquema, no texto libre). Por cada pregunta:

- `id` y `pregunta`;
- `porque`: qué cambia en el guion según la respuesta;
- `multiple`: si admite varias opciones;
- `opciones`: de 2 a 5, de máximo 12 palabras.

El servidor valida además las reglas que se pueden contar: de 6 a 9 preguntas, la primera sobre el enfoque, y siempre presentes postura, mediciones con la opción «No hice pruebas propias», alcance, audiencia y patrocinio. Si falla una regla, se pide de nuevo una sola vez.

**Pantalla.** Sección **Dirección** del episodio:

- chips de una o varias opciones, más un campo propio por pregunta;
- al final, «¿Algo más que el guionista deba saber?»;
- botones **Generar guion con mis respuestas**, **Saltar: que decida el guionista** y **Guardar respuestas**.

Las respuestas se pueden editar. Si cambian después de generar, la app avisa que hay que regenerar desde Estudio.

**Cómo llegan al guionista.** Al final de cada etapa va el encabezado «DIRECCIÓN DEL EPISODIO (…)» con el texto exacto del documento. Después, cada pregunta con su respuesta o con «sin respuesta: decide tú con las reglas de siempre», y al final «Algo más».

**Ficha de entrada.** Columnas nuevas en `episodes`, que también se llenan desde las respuestas:

- `episode_type`: producto, explicativo, actualidad u opinión;
- `target_minutes`: 8, 10, 12 o 14; por defecto 10;
- `sponsorship`: no, patrocinio, afiliados o sin confirmar;
- `own_measurements`;
- `stance_confirmed`.

## 5. Las 5 etapas

Cada etapa es una llamada a la API de Claude con:

1. **Sistema fijo:**
   - el modo panel ("no haces preguntas, no generas archivos, todo en bloques `### BLOQUE: <título>`");
   - las secciones de la guía que le tocan, entre etiquetas de instrucciones, con la orden de aplicarlas al pie de la letra.
2. **Mensaje del episodio:**
   - fecha de hoy en la zona del canal, ID y duración objetivo;
   - tema, postura y notas;
   - la Dirección;
   - el material de las etapas anteriores;
   - en Guion, Publicación y Podcast, también el contexto del canal: nombre del boletín, próximo video y videos publicados con título, fecha, pilar, búsquedas y postura.

La salida se corta por `### BLOQUE:` y se guarda bloque por bloque. Teleprompter, reels y podcast quedan en texto plano; el resto, en Markdown. Si falta un bloque esperado, la etapa queda **Incompleta** y se puede reintentar.

| #   | Etapa        | Bloques que se esperan                                                                                                           | Web           |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | Estudio      | Dossier (sección 4) y tarjetas (sección 5)                                                                                       | No            |
| 2   | Guion        | Escaleta y control de calidad, teleprompter, guion con reels marcados, verificación pendiente, motion graphics y plan de B-rolls | No            |
| 3   | Verificación | Tabla de verificación con fuentes, guion corregido, reels y marcas rehechos, motion graphics                                     | Sí (Parallel) |
| 4   | Publicación  | Reels R1 a R3, assets, ficha del episodio y assets en JSON; después, keywords, pilar y diseño de miniaturas                      | No            |
| 5   | Podcast      | Guion de audio y descripción para Spotify y Apple Podcasts                                                                       | No            |

### Verificación (etapa 3)

Es la única etapa con búsqueda. Corre como un ciclo controlado por el servidor, no como un chat:

1. **Extraer** (salida estructurada): afirmaciones verificables con línea, separando hecho de opinión (10.1), más los `___DATO` pendientes. Se guardan en `verification_items` con estado Pendiente.
2. **Verificar de 4 en 4.** Por cada grupo, Claude recibe la herramienta `buscar(consulta)`, que el servidor ejecuta contra la API de Parallel, y devuelve por cada afirmación:
   - estado: Verificado, Con matiz, No verificable o Contradicho;
   - naturaleza;
   - URL exacta;
   - cita de máximo 15 palabras;
   - fecha.

   **Una URL que no salió de las búsquedas de esa tarea se rechaza en el servidor**: la regla «una fuente que no salió de la búsqueda no cuenta» se impone en el código, no solo en el texto.

3. **Completar** los `___DATO` uno por uno.
4. **Reanudar.** Si Parallel falla 3 veces seguidas, la tarea se detiene con lo avanzado guardado. **Reintentar** sigue desde la primera afirmación pendiente.
5. **Corregir y marcar.** Con la tabla completa, una llamada corrige el guion y otra vuelve a marcar reels e invitaciones.
6. **Motion graphics.** Solo con cifras de filas Verificado o Con matiz. El servidor revisa que cada cifra tenga su fila.

**Pegar un resultado de chat.** Se puede pegar una verificación hecha en un chat del proyecto: la app la lee al mismo formato de tabla y sigue con los pasos 5 y 6.

**Bloqueo (10.4).** Mientras quede una fila No verificable o Contradicho sin resolver, el episodio no puede pasar a **Por grabar**. La pantalla muestra cuántas faltan y las tres salidas: reescribir, eliminar o marcar `___DATO POR CONFIRMAR___`. Con esto aparece en la app la acción "Resolver verificación", que el núcleo ya tiene marcada como de la Fase 2.

### Regenerar

- **Regenerar desde X** vuelve a correr esa etapa y las siguientes. Las versiones anteriores quedan en el historial, comparables y restaurables.
- **Generar aparte** el podcast desde el episodio, como pide el documento.

## 6. Motor de tareas

**Por qué no basta una función de Vercel.** Una corrida completa son unas 7 llamadas largas, más 30 a 40 búsquedas. Puede pasar de varios minutos, y en el plan Hobby las funciones tienen un tope de duración. La especificación eligió **Trigger.dev**, que no tiene límite por tarea, reintenta y guarda el avance.

**Cómo corre una etapa:**

1. La acción del servidor valida el permiso y estima el costo.
2. Inserta la fila en `tasks` (que ya existe) y dispara la tarea de Trigger.dev con su id.
3. La tarea escribe `progress`, `message` y el resultado en la base con la service role.
4. La página ve el avance en vivo con Supabase Realtime sobre `tasks` y `script_stage_runs`. Cerrar la pestaña no detiene nada.

**Dónde vive el código:**

- La lógica de cada etapa va en un paquete nuevo, `packages/ai`, en TypeScript puro y con el cliente de Claude inyectable, para probarlo sin red.
- Trigger.dev solo la orquesta.
- La sincronización de YouTube también se puede mover ahí, como ya preveía el README.

**Respaldo sin Trigger.dev:** correr cada etapa como una función de Vercel con streaming, una etapa por llamada. Funciona mientras cada etapa quepa en el límite de duración, pero sin reanudar automáticamente. Ver decisiones.

## 7. Llamadas a Claude

- **Modelo.** Sonnet 5.5 para preguntas y etapas, como en la especificación. Opus 5.5 queda como opción por canal para la etapa Guion, al doble de costo (ver decisiones).
- **Esfuerzo.**
  - Alto en Guion y Verificación.
  - Medio en Estudio, Publicación y Podcast.
  - Bajo en preguntas y extracción.

  Se ajusta midiendo con el registro de consumo.

- **Streaming siempre**, con `max_tokens` amplio (64.000). El guion completo con sus bloques puede pasar de 10.000 tokens de salida.
- **Caché del prompt.**
  - Las secciones de la guía van primero en el sistema, idénticas byte a byte entre episodios, con caché de 1 hora.
  - Lo que cambia (fecha, episodio, Dirección, material anterior) va después.
  - Cada etapa tiene su propio prefijo, porque recibe secciones distintas. La caché se aprovecha al regenerar y entre episodios del mismo día.
  - Leer de la caché cuesta la décima parte. Se verifica con `cache_read_input_tokens` en el registro.
- **Salidas estructuradas** (esquema JSON) solo donde la app necesita datos: las preguntas, la extracción de afirmaciones, el resultado por afirmación y los assets en JSON. Las etapas de escritura devuelven texto en bloques, como manda la guía.
- **Negativas y errores.**
  - Se revisa `stop_reason`. Una negativa (por ejemplo, en temas de seguridad informática) queda como error de la etapa con su categoría, sin cobrar créditos extra.
  - El SDK reintenta los errores 429 y 5xx.
  - Se activa el respaldo automático de modelo del servidor ante negativas.
- **Claves.** `ANTHROPIC_API_KEY` y `PARALLEL_API_KEY` solo en el servidor (Vercel y Trigger.dev), nunca en el navegador ni en la base.

## 8. Créditos

- **Unidad.** 1 crédito = US$0,01 de costo real.
- **Registro.** Cada llamada registra en `usage_ledger` (ya existe):
  - tokens de entrada, de caché (escritura y lectura) y de salida;
  - búsquedas;
  - costo en dólares, según la tabla de precios en `packages/core`.
- **Cupo mensual por espacio.** Columna `workspaces.monthly_credits`. El saldo es el cupo menos lo gastado en el mes.
- **Antes de cada acción cara**, la app muestra el estimado, por ejemplo "Guion completo ≈ 120 a 180 créditos". Si el saldo no alcanza, no arranca y lo dice.
- **Tope.** Una corrida en curso termina aunque cruce el saldo; no se corta a mitad de etapa.
- **Vista.** Consumo por canal, por episodio y por tipo de acción, en **Espacio y equipo** y en **Administración**.

**Costo esperado por episodio** (precios de la especificación: Sonnet 5.5 a US$2 y US$10 por millón de tokens de entrada y salida; Parallel a US$1–5 por 1.000 búsquedas):

| Paso                                  | US$               |
| ------------------------------------- | ----------------- |
| Preguntas de dirección                | ≈ 0,04            |
| 5 etapas, con la guía en caché        | 0,90 a 1,20       |
| 30 a 40 búsquedas                     | 0,04 a 0,20       |
| **Por guion, sin regenerar**          | **≈ 1,00 a 1,45** |
| Con regeneraciones habituales (× 1,5) | 1,50 a 2,20       |

Son estimaciones; se miden con los primeros episodios reales.

## 9. Modelo de datos nuevo

Todas las tablas llevan `workspace_id` y `channel_id` tomados del canal por trigger, y tienen RLS con la matriz de permisos actual:

- leer guiones: `read`;
- responder la dirección y generar: `write_script`;
- resolver la verificación: `write_script`;
- cambiar la guía: `configure_channel`.

| Tabla                       | Qué guarda                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `episode_direction`         | Preguntas generadas (JSON), respuestas, «Algo más», estado (pendiente, respondida, saltada), quién y cuándo                |
| `script_runs`               | Una corrida de guion: episodio, versión de la guía, modelo, etapa actual, estado y costo total                             |
| `script_stage_runs`         | Una etapa de una corrida: etapa, estado, bloques (`jsonb`), texto crudo, uso de tokens, error y tarea                      |
| `verification_items`        | Afirmaciones de la etapa 3: número, texto, línea, hecho u opinión, estado, naturaleza, URL, cita, fecha y búsquedas usadas |
| `writer_guide_versions` (+) | Columnas `sections` y `stage_sections`                                                                                     |
| `episodes` (+)              | Ficha de entrada (sección 4) y `current_script_run_id`                                                                     |
| `workspaces` (+)            | `monthly_credits`                                                                                                          |

El contexto del canal sale de lo que ya existe:

- `distribution_settings.newsletter_name` y `podcast_name`;
- episodios publicados con pilar, keywords y postura;
- `youtube_videos`;
- el próximo episodio programado.

## 10. Pantallas

- **Episodio**, con secciones nuevas:
  - **Dirección.**
  - **Guion**, con 5 pestañas que muestran estado y avance en vivo:
    - el teleprompter con botón **Copiar** y conteo de palabras contra el objetivo;
    - el resto de bloques en Markdown;
    - la tabla de verificación con filtros y las tres salidas por fila;
    - historial de corridas.
- **Guiones**: lista de corridas del canal y **Nuevo guion desde un tema**.
- **Ajustes del canal → Guía del guionista**: versiones, diferencias, secciones detectadas y qué etapa recibe cada una.
- **Bandeja de tareas**: en la barra lateral, lo que está corriendo en el espacio.

## 11. Migración desde el artefacto

Hay que traer los episodios de Gartechs, con estado, fechas, postura, notas y guiones si los hay. Depende de cómo exporte el artefacto (ver decisiones). La idea es un importador de JSON en **Administración** que:

- crea los episodios en el canal conectado;
- respeta los códigos `GT-…`;
- muestra un resumen antes de confirmar.

Después de importar, el artefacto queda en solo lectura.

## 12. Plan de entrega

| Paso | Qué                                                                        | Se prueba con                                                    |
| ---- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1    | Tablas, RLS y créditos; guía por versiones con secciones; ficha de entrada | Pruebas de RLS; pegar la v4.1 y ver las 25 secciones             |
| 2    | Motor de tareas (Trigger.dev) y bandeja en vivo                            | Una tarea de prueba con avance                                   |
| 3    | Preguntas de dirección                                                     | 3 temas reales de Gartechs; Diego revisa si las preguntas sirven |
| 4    | Etapas 1 y 2 (Estudio y Guion)                                             | Un tema real comparado con el panel actual                       |
| 5    | Etapa 3 (Verificación con Parallel, reanudable y con bloqueo)              | Forzar fallas de búsqueda y reanudar                             |
| 6    | Etapas 4 y 5; keywords y pilar                                             | Corrida completa                                                 |
| 7    | Migración desde el artefacto                                               | Importar todo Gartechs                                           |
| 8    | Gartechs graba un episodio con guion de la app                             | Criterio de salida                                               |

Cada paso va en su PR, con las pruebas del núcleo y de la base y una prueba de punta a punta. Las llamadas a Claude y a Parallel se simulan en las pruebas automáticas. Las pruebas con IA real se hacen con temas de Gartechs y cuestan créditos.

## 13. Decisiones

Tomadas el 8 de octubre de 2026:

1. **Motor de tareas: Trigger.dev.** Falta crear la cuenta y conectar el repositorio.
2. **Modelo:** Sonnet 5.5 en todas las etapas. En 2 episodios se compara la etapa Guion con Opus 5.5 antes de decidir.
3. **Cupo de la beta: US$20 al mes (2.000 créditos).** Es el valor por defecto de cada espacio; se cambia por espacio en **Administración**.

Pendientes:

4. **Cuentas y claves.** Crear las claves de API de Anthropic y de Parallel y cargarlas como variables de entorno en Vercel y Trigger.dev. No se pegan en el chat.
5. **Reglas para otros canales.** Recomendado: en la Fase 2, cada canal pega su propia guía; la plantilla general se escribe cuando entre el segundo canal.
6. **Exportación del artefacto.** ¿El panel actual puede exportar los episodios como JSON o CSV? Con un ejemplo se arma el importador.
7. **Recomendaciones de ideas con IA.** Recomendado: hacerlas al final de la fase, si el guion ya está estable.

## 14. Avance

- **Paso 1 (bases):**
  - ficha de entrada en el episodio;
  - guía del guionista por versiones, con secciones y las etapas que reciben cada una;
  - cupo y consumo de créditos.

  Con la v4.1 real se detectan 22 secciones: de la 0 a la 16 y de la 20 a la 24.

- **Paso 2 (motor de tareas):**
  - paquete `apps/jobs` con Trigger.dev 4 y la tarea de prueba `ping`;
  - `startJob` en la web crea la fila en `tasks` y dispara la tarea;
  - `runTracked` actualiza avance, mensaje y estado;
  - si se agotan los reintentos, la fila queda en Falló;
  - bandeja **Tareas en curso** en la barra lateral, en vivo con Supabase Realtime;
  - botón **Probar el motor** en Administración.

  La configuración está en [`configurar-trigger.md`](configurar-trigger.md).

- **Paso 3 (preguntas de dirección):**
  - paquete `packages/ai` con el prompt, la salida estructurada (zod), las reglas que se pueden contar, el bloque «DIRECCIÓN DEL EPISODIO», la ficha desde las respuestas y el costo;
  - tarea `direction` en Trigger.dev, que usa la sección 2 de la guía, la ficha y el contexto del canal, y registra el consumo en `usage_ledger`;
  - tabla `episode_direction`;
  - sección **Dirección del episodio** en la pestaña Guion, con **Guardar respuestas**, **Saltar** y **Volver a preparar**;
  - el modelo se elige con `AI_MODEL` en Trigger.dev.
