-- Guía de miniaturas v1.0: cada texto lleva su esquema de composición (A a F).
-- Los textos de antes no tienen esquema y se borran (las versiones que salieron
-- de ellos se quedan, con idea_id en null).
delete from public.thumbnail_ideas;
alter table public.thumbnail_ideas
  add column scheme text not null check (scheme in ('A', 'B', 'C', 'D', 'E', 'F'));

-- Cada versión guarda su esquema, el escenario (para rotarlo), si va en espejo
-- y los avisos de composición (lo que no se pudo cumplir de la guía).
alter table public.episode_assets
  add column scheme text check (scheme in ('A', 'B', 'C', 'D', 'E', 'F')),
  add column scenario text check (char_length(scenario) <= 40),
  add column mirror boolean not null default false,
  add column layout_warnings text[] not null default '{}';

-- El estilo de miniaturas por defecto pasa a la guía. Un estilo escrito a mano
-- no se toca.
update public.brand_kits
set thumbnail_style = 'Guía de miniaturas v1.0: tres miniaturas por video con tres esquemas distintos (A la pregunta, B el dato, C el veredicto, D el duelo, E el detalle, F en uso), al menos una con cara y una sin cara. Sets recomendados: reseña A+B+C, comparativa D+B+C, tutorial o largo plazo F+E+A. Todo parte del veredicto del guion; sin veredicto no se diseña. El texto completa el título, no lo repite: 2–4 palabras, máximo 22 caracteres y 2 líneas, Inter Black blanco con una sola palabra en naranja, tipo oración con tildes y ¿? ¡! de apertura. Sin superlativos vacíos, marcas, precios sin moneda, emojis ni clickbait. Fondo casi negro con retícula naranja muy tenue, halo naranja detrás del sujeto y viñeteado; luz cálida lateral. El presentador se parece a sí mismo, con expresión natural (duda, seguridad, concentración); nunca asombro, boca abierta ni señalar. El producto, siempre de foto real. Margen de 64 px, la esquina inferior derecha (220 × 90 px) vacía para la duración y 40 px entre el texto y la cara. Nunca flechas, círculos rojos, emojis, marcos, azul, neón, RGB, amarillo, madera ni dorado dominantes. Rotar el escenario: no repetir el de los últimos 3 videos ni dentro del set. 1280 × 720 y menos de 2 MB.'
where thumbnail_style = 'Tres ángulos totalmente distintos de la idea central del episodio (el dinero, el error, la comparación, el mito, el uso real, para quién sí y para quién no…): cada uno cambia la motivación, la emoción, la escena y el texto, sin perder el foco en el tema central, sin contradecir el veredicto y sin prometer lo que el video no entrega. Toda cifra en pantalla está verificada. Texto de 2 a 4 palabras en dos líneas, casi la mitad del ancho, en blanco con una sola palabra clave en naranja; nunca amarillo. Fondo oscuro y luz cálida con halo naranja. Sin flechas, emojis, marcos ni logos inventados. El presentador con expresión natural, nunca cara de asombro; de medio cuerpo en al menos una de las tres. Sombra suave y negra solo para que se lea el texto. Baldosa G. como marca de agua. 1280 × 720 y menos de 2 MB.';
