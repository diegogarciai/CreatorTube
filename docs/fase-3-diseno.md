# Fase 3 · Producción: diseño

Fuentes:

- la especificación _Planificador de Episodios: de artefacto a aplicación web multi-canal_ (Fase 3);
- las _Reglas del guionista v4.1_ (secciones 12 a 14);
- el manual de identidad Gartechs v3.0 (septiembre de 2026): colores, tipografía, movimiento, imagen y zonas seguras.

**Criterio de salida (especificación):** un episodio producido de punta a punta en la app.

## 1. Alcance

| Entra en la Fase 3                                                          | Queda para después                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Kit de marca por canal: colores, tipografías, retícula, halo, curva, logo   | Miniaturas con Artlist: no tiene API para que una app genere sola         |
| Fotos de referencia del presentador                                         | Subir la miniatura a YouTube: pide el permiso `youtube.upload` y revisión |
| Miniaturas con Gemini: imagen sin texto, texto de la marca, calificación    | Código de animación generado por IA                                       |
| Plan de ayudas visuales (C, L y M) como datos, desde las fichas 12.5 y 12.8 |                                                                           |
| Piezas animadas con Remotion: horizontal, vertical, transparente y verde    |                                                                           |
| Recursos del episodio en Producción, para descargar                         |                                                                           |

## 2. Decisiones

- **Miniaturas solo con Gemini (Nano Banana) por ahora.** Artlist solo ofrece un MCP para personas, no una API para servidores. Cuando la tenga, se agrega como otro proveedor.
- **Miniaturas generadas a partir de las fotos de referencia (reglas v4.1).** El manual v3.0 (sección 05) dice «nunca imágenes generadas»; Diego decidió que para las miniaturas mandan las reglas v4.1 y actualiza su manual. En todo lo demás la miniatura sigue el manual: fondo oscuro con luz cálida y halo naranja, expresión natural, sin flechas, emojis, marcos ni logos inventados.
- **Tres ángulos de la idea central, no pregunta, dato y veredicto.** El sistema A/B/C del manual no dio resultado. Cada miniatura es un ángulo totalmente distinto (el dinero, el error, la comparación, el mito, el uso real, para quién sí y para quién no…) que cambia la motivación, la emoción, la escena y el texto, sin perder el foco en el tema central del episodio (reglas v4.1, sección 14). El JSON de Publicación trae el ángulo de cada una (`angulo`); las letras A, B y C solo sirven para «Probar y comparar».
- **Gemini genera la imagen sin texto.** El texto (2 a 4 palabras en dos líneas, una en naranja) lo pone la app con la tipografía y los colores del kit, así nunca se sale del manual.
- **Motion graphics con piezas de marca.** Claude arma cada escena (regla 12.2) con piezas animadas ya hechas (barras, anillos, línea de tiempo, cifras que cuentan, matriz de puntos…) y sus datos. No se genera código: lo que se renderiza siempre es código revisado.
- **Render en Trigger.dev, sin AWS.** Remotion corre con sus APIs de servidor (`@remotion/bundler` y `@remotion/renderer`) y la extensión de ffmpeg. La licencia de Remotion es gratis para equipos de hasta 3 personas.
- **La miniatura se descarga** (1280 × 720 en PNG). Subirla a YouTube queda para cuando se pida el permiso nuevo.

## 3. Pasos (cada uno en su PR)

| Paso | Qué                                                                                       | Estado    |
| ---- | ----------------------------------------------------------------------------------------- | --------- |
| 1    | Este documento; almacenamiento de archivos; kit de marca por canal; fotos del presentador | Hecho     |
| 2    | Miniaturas con Gemini: generar, poner el texto, calificar con Claude, elegir y descargar  | Hecho     |
| 3    | Plan de ayudas visuales (C, L y M) como datos                                             | Pendiente |
| 4    | Render con Remotion en Trigger.dev                                                        | Pendiente |
| 5    | Recursos del episodio en Producción                                                       | Pendiente |
| 6    | Un episodio de Gartechs producido de punta a punta (prueba de salida)                     | Pendiente |

## 4. Almacenamiento (paso 1)

Un bucket privado de Supabase Storage, `channel-media` (imágenes PNG, JPG, WebP o SVG de hasta 10 MB). Toda ruta empieza por el canal:

| Ruta                            | Qué guarda                          | Quién escribe                   |
| ------------------------------- | ----------------------------------- | ------------------------------- |
| `{canal}/brand/{id}.{ext}`      | Logo y piezas del kit               | Quien configura el canal        |
| `{canal}/presenter/{id}.{ext}`  | Fotos de referencia del presentador | Quien configura el canal        |
| `{canal}/episodes/{episodio}/…` | Miniaturas y piezas renderizadas    | El servidor (tareas de Trigger) |

- Las políticas de `storage.objects` sacan el canal del primer segmento (`public.media_path_channel`) y usan `has_channel_permission`: lee quien ve el canal; sube, reemplaza y borra quien lo configura.
- El navegador sube directo al bucket y después una acción del servidor registra la ruta. Si el registro falla, el navegador borra el archivo.
- Las imágenes se muestran con URLs firmadas de una hora.
- `brand_kits.logo_path` y `presenter_photos.path` solo aceptan rutas de su canal y su carpeta (restricción en la base).

## 5. Kit de marca (paso 1)

Vive en `brand_kits` (`colors`, `fonts`, `style`, `thumbnail_style`, `logo_path`) y se valida con `brandKitSchema` de `@planificador/core`. Lo que falta o no es válido vuelve, por partes, a los valores por defecto, que son los del manual v3.0.

| Parte       | Valores por defecto (manual v3.0)                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colores     | Fondo lienzo `#111213`, Negro página `#0E0F10`, Blanco titular `#FFFFFF`, Crema cálido `#FFD9BD`, Naranja marca `#FF7A29`, Naranja resplandor `#E87026`, Ámbar profundo `#C65014`, Naranja retícula `#E2661F` |
| Tipografías | Inter (lectura), Inter Display (titulares), Inter Display Black (miniaturas), JetBrains Mono (cifras y etiquetas)                                                                                             |
| Reparto     | 70 % negro, 22 % blanco y crema, 8 % naranja                                                                                                                                                                  |
| Retícula    | Celda de 80 px al 10 %; al 6 % con datos en pantalla (rango del manual: 6–22 %)                                                                                                                               |
| Halo        | Resplandor al 55 % en el centro, Ámbar profundo al 28 % en la caída, hasta 0; nunca detrás de datos                                                                                                           |
| Movimiento  | `cubic-bezier(0.2, 0, 0, 1)`; nunca rebotes, giros, brillos ni glitch                                                                                                                                         |
| Texto       | Blanco sobre naranja solo desde 64 px; texto sobre el halo desde 48 px                                                                                                                                        |
| Vertical    | Zona segura de 1080 × 1920: 250 px arriba, 340 abajo, 120 a la derecha                                                                                                                                        |
| Logo        | Versión blanca para fondo oscuro (letras blancas y el punto en Naranja marca); mínimo 120 px de ancho                                                                                                         |

Para el paso 4 (piezas animadas) también cuentan, del manual:

- **Escala tipográfica.** En pantalla: 64 / 40 / 24 / 17 (display, título, subtítulo, lectura) y etiqueta mono de 13. En vertical 1080: 96 / 72 / 48 / 40, etiqueta mono de 28 y subtítulo de video de 56. Tipo oración, máximo dos pesos por pieza.
- **Gráficos.** Lienzo 1920 × 1080 (el más fuerte también en 1080 × 1350), con margen de 96 × 72 px y retícula al 6 %. Serie principal en Naranja marca y referencia en Crema al 35 %. Título en Inter Display 600 de 56 px y valores en JetBrains Mono de 32 px o más. Barras desde cero, y fuente y fecha al pie.
- **Tokens.** Superficie crema al 6 %, filete al 20 %, referencia al 35 % y velo de Negro página al 80 % para las cajas de subtítulo.

## 6. Fotos del presentador (paso 1)

- Tabla `presenter_photos (id, channel_id, path, label, created_by, created_at)`, con RLS de canal; hasta 8 por canal.
- Son datos personales (Ley 1581 de 2012): solo las ven los miembros con acceso al canal y se usan solo para sus miniaturas. Al borrar una foto se borra también el archivo.
- No van al repositorio: se suben desde Ajustes.

## 7. Miniaturas con Gemini (paso 2)

Viven en la pestaña **Producción** del episodio y siguen de forma estricta la **Guía de miniaturas v1.0** del diseñador (octubre de 2026). Las reglas están en `packages/core/src/thumbnail-schemes.ts`.

### 7.1 La guía en el sistema

**Seis esquemas de composición.**

| Esquema          | Cara               | Texto                               | Fotos del producto | Texto en                               | Sujeto                                                                  |
| ---------------- | ------------------ | ----------------------------------- | ------------------ | -------------------------------------- | ----------------------------------------------------------------------- |
| A · La pregunta  | Sí                 | 2–4 palabras con ¿?                 | opcional           | 50 % izquierdo                         | Diego en el 40 % derecho, duda honesta, mano al mentón                  |
| B · El dato      | No                 | Cifra ≤ 4 caracteres + 1–2 palabras | 1                  | izquierda, la cifra hasta 300 px       | Producto en el 40 % derecho, girado 5–10°                               |
| C · El veredicto | Sí                 | 2–3 palabras, sin «?»               | opcional           | 40 % derecho                           | Diego en el 45 % izquierdo sosteniendo el producto, seguridad tranquila |
| D · El duelo     | Pequeña            | 2–3 palabras en una línea, sin «VS» | 2                  | arriba, centrado                       | Producto 1 y 2 a los lados; Diego pequeño al centro, pensativo          |
| E · El detalle   | No                 | 2–3 palabras                        | 1                  | abajo a la izquierda, sobre degradado  | Macro arriba a la derecha, que sale del cuadro                          |
| F · En uso       | Sin mirar a cámara | 2–3 palabras                        | 1                  | arriba a la izquierda, sobre degradado | Escena a sangre sin retícula; Diego a la derecha usando el producto     |

A y C admiten **espejo** (texto del otro lado). Shorts 1080 × 1920 quedan pendientes.

**Lo que valida el código** (no se puede saltar):

- **Set:** tres esquemas distintos, al menos uno con cara (A, C, D, F) y uno sin cara (B, E) (`validateSchemeSet`). Sets recomendados según el `tipo` del JSON de Publicación: reseña A+B+C, comparativa D+B+C, tutorial o largo plazo F+E+A.
- **Veredicto:** sin `postura` (o si es «depende») no se proponen textos ni se generan miniaturas (`errors.no_verdict`).
- **Texto** (`validateSchemeText`):
  - 2–4 palabras (según el esquema), máximo 22 caracteres con espacios;
  - tipo oración (nunca TODO MAYÚSCULAS), sin emojis ni signos dobles, con ¿ y ¡ de apertura;
  - sin «VS», sin superlativos vacíos y sin precios sin moneda;
  - la palabra naranja tiene que estar en el texto;
  - las reglas propias de A, B (cifra, sin decimales, rangos ni dos cifras; la cifra en naranja) y C.
- **Fotos:** B, E y F necesitan 1 foto del producto y D necesita 2. Sin ellas el esquema sale bloqueado en la lista, con el motivo. Los esquemas sin cara no mandan las fotos del presentador a Gemini.
- **Composición** (`apps/jobs/src/lib/compose-thumbnail.ts`):
  - letra Inter Black, tracking −4 %, interlineado 0,92 y alto de cuerpo de 120 a 150 px (la cifra de B hasta 300);
  - blanco con una palabra #FF7A29 y sombra negra suave en las letras, sin mancha detrás;
  - margen de 64 px y la esquina de la duración (220 × 90) vacía;
  - con la cara ubicada por Claude (`thumbnail_layout`, solo en esquemas con cara), el texto se achica dentro del rango hasta dejar 40 px.

  Lo que no se puede cumplir queda como **aviso** en la versión (`layout_warnings`).

- **Rotación de escenarios:** no se repite dentro del set ni, si se puede, el de las miniaturas elegidas de los últimos 3 videos (`assignScenarios`). Escenarios: set oscuro, escritorio, en la mano, detalle, sofá, café, carro, calle.

**Lo que revisa la calificación** (lo que pide criterio):

- que siga el esquema y que el texto complete el título sin repetirlo;
- la cara: es Diego, con la expresión del esquema, nunca asombro, boca abierta ni señalar;
- el producto real y sin inventos;
- los prohibidos: flechas, círculos rojos, emojis, marcos y colores dominantes;
- la prueba de móvil a 168 × 94 px;
- el veredicto.

La separación y la esquina las mide la app y van como dato.

### 7.2 El flujo

**Elegir los textos.** Antes de las tarjetas está **«Textos para las miniaturas»**:

- La tarea `thumbnail_ideas` le pide a Claude 30 textos, cada uno con su esquema (solo los disponibles según las fotos del producto). Pide al menos 3 por esquema y más en el set recomendado. Usa el título, el veredicto, la ficha (las cifras solo salen de ahí), los títulos, las keywords y el estilo del kit. Los que no pasan `validateSchemeText` se descartan.
- La lista se agrupa y filtra por esquema, marca el set recomendado y dice en vivo por qué una selección no vale.
- Diego marca 3 y genera: van a las tarjetas A, B y C en el orden en que los marcó (`thumbnail_ideas.slot`). Cada versión guarda el texto (`idea_id`), el esquema, el escenario y el espejo.
- «Proponer otros 30» reemplaza la lista y conserva los que están en uso. Las tarjetas solo generan desde un texto elegido; las versiones de antes de la guía se siguen viendo.

Cada miniatura pasa por cuatro pasos dentro de la tarea `thumbnails` (Trigger.dev):

1. **Brief (Claude).** Una llamada para todas: lo propio de cada una dentro de su esquema y escenario (el producto, el detalle de E, el gesto de C según el veredicto) y si va en espejo. La nota de Diego al regenerar entra aquí.
2. **Imagen (Gemini).** `generateContent` con las referencias etiquetadas que pide el esquema, 16:9 en 2K con Pro y **sin texto**. La instrucción (`schemeImagePrompt`) es el PROMPT BASE de la guía más la composición del esquema y la escena. Lo único adaptado: Gemini deja libre la zona del texto en vez de pintarlo.
3. **Composición (la app).** El texto en la zona del esquema, con las medidas de la guía, y JPG de menos de 2 MB.
4. **Calificación (Claude con visión).** La miniatura, la misma a 168 × 94 y una foto del presentador (si hay cara). Nota de 0 a 10 con los criterios de la guía (esquema, texto, título, cara, producto, separación, esquina, prohibidos, móvil y veredicto) y qué mejorar.

Además:

- **Editar el texto** crea otra versión con la misma imagen, validada con las reglas del esquema (y espejo en A y C). Solo se recompone y se califica, sin pagar otra imagen.
- **Versiones:** cada generación es una fila de `episode_assets` y se conservan todas. Una sola miniatura queda **elegida** por episodio, y cada versión lista se **descarga** con el código del episodio y la letra (A, B o C).
- **Fotos del producto:** hasta 3 por episodio (`episode_refs`, carpeta `{canal}/episodes/{episodio}/refs/`). La primera es el producto 1 y la segunda el producto 2 del duelo.
- **Modelo:** `GEMINI_IMAGE_MODEL` en Trigger.dev, por defecto `gemini-3-pro-image` (Nano Banana Pro): con Nano Banana 2 la cara salía como otra persona. El modelo de Claude para el brief y la calificación es la etapa «Miniaturas» de Administración.
- **Costo:** unos US$0,134 por imagen (Pro, 2K) más el brief y la calificación, cerca de US$0,17 por miniatura. Se registra como `thumbnail_ideas`, `thumbnail_brief`, `thumbnail_image` (con `image_usd`), `thumbnail_layout` y `thumbnail_score`. El panel de consumo tiene la tarjeta «Imágenes (Gemini)» con su presupuesto.
- **Tablas:**
  - `episode_assets`: `id`, `episode_id`, `channel_id`, `kind`, `design_idx`, `status`, `source_id`, `idea_id`, `scheme`, `scenario`, `mirror`, `layout_warnings`, `base_path`, `path`, `text`, `prompt`, `note`, `score`, `chosen`, `model`, `credits`, `error` y `task_id`. `text_side` y `text_v` quedan de antes de la guía. Solo la escribe el servidor.
  - `thumbnail_ideas`: los 30 textos con `scheme`, `angle`, `text`, `accent`, `scene`, `emotion` y `slot`.
  - `episode_refs`: las fotos del producto.

## 8. Costos estimados por episodio

| Qué                                        | Estimado                                          |
| ------------------------------------------ | ------------------------------------------------- |
| 3 miniaturas con una regeneración cada una | unos US$1,00 (imágenes Pro, brief y calificación) |
| Plan de ayudas visuales                    | una llamada a Claude                              |
| Render de piezas en Trigger.dev            | minutos de máquina de Trigger.dev                 |
