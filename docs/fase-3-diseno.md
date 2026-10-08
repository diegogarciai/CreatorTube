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
- **Miniaturas generadas a partir de las fotos de referencia (reglas v4.1).** El manual v3.0 (sección 05) dice «nunca imágenes generadas»; Diego decidió que para las miniaturas mandan las reglas v4.1 y actualiza su manual. En todo lo demás la miniatura sigue el manual: sistema A/B/C (pregunta, dato, veredicto), fondo oscuro con luz cálida y halo naranja, expresión natural, sin flechas, emojis, marcos ni logos inventados.
- **Gemini genera la imagen sin texto.** El texto (2 a 4 palabras en dos líneas, una en naranja) lo pone la app con la tipografía y los colores del kit, así nunca se sale del manual.
- **Motion graphics con piezas de marca.** Claude arma cada escena (regla 12.2) con piezas animadas ya hechas (barras, anillos, línea de tiempo, cifras que cuentan, matriz de puntos…) y sus datos. No se genera código: lo que se renderiza siempre es código revisado.
- **Render en Trigger.dev, sin AWS.** Remotion corre con sus APIs de servidor (`@remotion/bundler` y `@remotion/renderer`) y la extensión de ffmpeg. La licencia de Remotion es gratis para equipos de hasta 3 personas.
- **La miniatura se descarga** (1280 × 720 en PNG). Subirla a YouTube queda para cuando se pida el permiso nuevo.

## 3. Pasos (cada uno en su PR)

| Paso | Qué                                                                                       | Estado    |
| ---- | ----------------------------------------------------------------------------------------- | --------- |
| 1    | Este documento; almacenamiento de archivos; kit de marca por canal; fotos del presentador | Hecho     |
| 2    | Miniaturas con Gemini: generar, poner el texto, calificar con Claude, elegir y descargar  | Pendiente |
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

- **Entrada:** las 3 miniaturas del JSON de Publicación (texto, escena, expresión, protagonista, composición, ayuda visual y emoción), el kit y las fotos del presentador.
- **Tarea `thumbnails`:** llama a Gemini con las fotos como referencia y pide la imagen en 16:9, sin texto. El modelo va en `GEMINI_IMAGE_MODEL` y la clave en `GEMINI_API_KEY`, solo en Trigger.dev.
- **Texto:** la app lo compone encima, con la tipografía y los colores del kit.
- **Calificación:** Claude revisa cada una con la sección 14 (prueba del scroll, protagonista, contraste, emoción, texto legible, coincide con el veredicto) y da una nota con qué mejorar. Se agrega la etapa `thumbnails` a los modelos de Administración.
- **En Producción:** tres tarjetas con Generar o Regenerar (con una nota opcional), la calificación, Elegir y Descargar.
- **Tabla `episode_assets`:** `id`, `episode_id`, `channel_id`, `kind` (`thumbnail`; después `motion`), `design_idx`, `status`, `path`, `prompt`, `score`, `chosen`, `task_id` y `credits`.
- **Costo:** unos US$0,04 por imagen más la calificación. Se registra como `thumbnail_image` y `thumbnail_score`, y el panel de consumo suma la tarjeta «Imágenes (Gemini)».

## 8. Costos estimados por episodio

| Qué                                        | Estimado                               |
| ------------------------------------------ | -------------------------------------- |
| 3 miniaturas con una regeneración cada una | unos US$0,25 (imágenes) + calificación |
| Plan de ayudas visuales                    | una llamada a Claude                   |
| Render de piezas en Trigger.dev            | minutos de máquina de Trigger.dev      |
