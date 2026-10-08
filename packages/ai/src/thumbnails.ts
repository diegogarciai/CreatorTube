import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  FACE_GAP,
  hasFace,
  SCHEME_IDS,
  THUMBNAIL_SCHEMES,
  validateSchemeText,
  type Scenario,
  type SchemeId,
} from "@planificador/core";
import { addUsage, emptyUsage, type UsageTotals } from "./cost";
import { AiRefusalError, type AiConfig } from "./generate";
import type { PublicationAssets } from "./publication";
import type { StreamClient } from "./stages";

/**
 * Miniaturas (Fase 3 · paso 2) con la guía de miniaturas v1.0: cada texto
 * elegido tiene su esquema (A–F). Claude escribe la escena de cada una, Gemini
 * pinta la imagen sin texto con el prompt base y el del esquema, la app pone
 * el texto en la zona del esquema y Claude la califica con la guía.
 */

export type ThumbnailDesign = PublicationAssets["miniaturas"][number];

/**
 * Letras para «Probar y comparar» de YouTube: las tres miniaturas del video,
 * cada una con un esquema distinto.
 */
export const THUMBNAIL_LETTERS = ["A", "B", "C"] as const;
export const thumbnailLetter = (idx: number) => THUMBNAIL_LETTERS[idx] ?? String(idx + 1);

/** El texto de la miniatura (la app lo parte en líneas) y su palabra naranja. */
export type ThumbnailText = { lines: string[]; accent: string };

/** Los colores del kit que importan para la imagen. */
export type ThumbnailKit = {
  canvas: string;
  glow: string;
  amberDeep: string;
  accent: string;
  cream: string;
  grid: string;
  thumbnailStyle: string;
};

const bareWord = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();

/** La palabra naranja tal como está en el texto (o la última, si no está). */
export function findAccent(text: string, accent: string): string {
  const all = text.split(/\s+/).filter(Boolean);
  // La cifra de B conserva su signo: «40%».
  const exact = all.find((w) => w === accent.trim());
  if (exact) return exact;
  const found = all.find((w) => bareWord(w) && bareWord(w) === bareWord(accent));
  return found ?? all.at(-1) ?? "";
}

/** Los escenarios en inglés, para la escena. */
const SCENARIO_EN: Record<Scenario, string> = {
  "set oscuro": "the dark brand studio set",
  escritorio: "a desk setup",
  "en la mano": "the product held in hand on the dark brand set",
  detalle: "a macro detail shot on the dark brand set",
  sofá: "a sofa at home",
  café: "a café table",
  carro: "inside a car",
  calle: "a city street",
};

/** Una miniatura para el brief: el texto elegido con su esquema y escenario. */
export interface BriefItem {
  idx: number;
  scheme: SchemeId;
  scenario: Scenario;
  text: string;
  accent: string;
  angle: string;
  emotion: string;
  /** La escena que propuso la lista de textos, en una frase. */
  idea: string;
  note?: string | null;
}

export type ThumbnailBrief = {
  idx: number;
  /** La escena para Gemini, en inglés y sin texto. */
  scene: string;
  /** Texto del otro lado (solo A y C). */
  mirror: boolean;
};

const briefSchema = z.object({
  briefs: z.array(
    z.object({
      idx: z.number().int().describe("El índice de la miniatura, tal como llegó."),
      scene: z
        .string()
        .describe(
          "Lo propio de esta miniatura para el generador de imágenes, en inglés: qué producto y cómo se ve, el escenario, la luz y el gesto del presentador si aparece. Al presentador solo se le nombra «the presenter from the reference photos», sin describir su físico ni su ropa. En B y E, sin personas. Sin texto en la imagen y sin repetir la composición fija del esquema.",
        ),
      mirror: z
        .boolean()
        .describe(
          "Solo A y C: true si el producto o la mirada piden el texto del otro lado. En los demás, false.",
        ),
    }),
  ),
});

export interface BriefInput {
  items: BriefItem[];
  kit: ThumbnailKit;
  episodeTitle: string;
  verdict: string;
  presenter: string;
  /** Lo que muestra cada foto del producto, en orden («Product photo 1», «2»…). */
  productRefs: string[];
}

/** Lo que dice la guía de cada esquema, para Claude. */
function schemeGuide(id: SchemeId) {
  const s = THUMBNAIL_SCHEMES[id];
  return `${id} · ${s.name}. Úsalo cuando: ${s.when} No lo uses si: ${s.avoid}`;
}

/** Frases que hablan de una persona (en inglés o en español). */
const PERSON =
  /\b(presenter|person|people|man|woman|guy|he|his|him|face|body|smil\w*|looks?|looking|holds?|holding|presentador|persona|hombre|cara|él|sostiene)\b/i;

/**
 * La escena de un esquema sin cara (B, E) sin las frases que meten a una
 * persona: si la escena la menciona, Gemini dibuja a alguien que no es Diego.
 */
export function withoutPeople(scene: string, presenter = ""): string {
  const name = presenter.trim().split(/\s+/)[0]?.toLowerCase();
  const kept = scene.split(/(?<=[.;!?])\s+/).filter((sentence) => {
    const low = sentence.toLowerCase();
    return !PERSON.test(sentence) && !(name && name.length > 2 && low.includes(name));
  });
  return kept.join(" ").trim() || "The real product from Product photo 1 on the dark brand set.";
}

/** El brief de varias miniaturas en una sola llamada. */
export async function thumbnailBriefs(
  client: StreamClient,
  config: AiConfig,
  input: BriefInput,
): Promise<{ briefs: ThumbnailBrief[]; usage: UsageTotals; model: string }> {
  const system = [
    "Diriges el arte de las miniaturas de YouTube de un canal de tecnología con la guía de miniaturas del canal. Para cada miniatura escribes la escena para el generador de imágenes.",
    "Cada miniatura ya tiene su esquema de composición, su texto y su escenario. La composición del esquema (dónde va el presentador, el producto y el hueco del texto, y su expresión) ya está fija: tú escribes lo propio de esta miniatura dentro de ese esquema, sin cambiarlo.",
    "La imagen la genera otro modelo a partir de fotos reales del presentador y del producto; el texto lo pone después la app. La escena nunca lleva letras, números, logos, flechas, círculos, emojis ni marcos.",
    "El producto siempre es el real de sus fotos: nombra cuál es (Product photo 1, 2…). En el duelo (D), el producto 1 va a la izquierda y el 2 a la derecha. En el detalle (E), di qué pieza, función o defecto lleva el foco. En el veredicto (C), media sonrisa si el veredicto recomienda y ceño leve si no.",
    "Expresión natural siempre: duda, seguridad o concentración. Nunca asombro, boca abierta, señalar ni pulgares.",
    "El parecido manda: la cara sale de las fotos reales del presentador. Nunca describas su físico (cara, pelo, barba, edad, rasgos, cuerpo) ni su ropa: nómbralo solo como «the presenter from the reference photos». Cualquier descripción física hace que el generador dibuje a otra persona.",
    "Si no cabe todo, el producto manda sobre la persona: el producto entero y sin tapar; se recorta o achica el cuerpo del presentador, nunca el producto.",
    "El dato (B) y el detalle (E) no llevan personas: ni el presentador, ni caras, ni cuerpos. En E, como mucho una mano que entra al cuadro para dar escala.",
    "Nunca azul, neón, RGB, amarillo, madera ni dorado como color dominante; escenarios sin marcas visibles ni gente de fondo; los exteriores se gradúan a la paleta (sombras profundas, luz cálida, acento naranja).",
    "Espejo: solo A y C pueden invertirse, y solo si el producto o la mirada lo piden.",
  ].join("\n");
  const user = [
    `Tema central del episodio: ${input.episodeTitle}`,
    `Veredicto del guion: ${input.verdict || "(sin veredicto)"}`,
    `Presentador: ${input.presenter}`,
    input.productRefs.length
      ? `Fotos del producto: ${input.productRefs.map((l, i) => `Product photo ${i + 1}: ${l}`).join(" · ")}`
      : "Fotos del producto: ninguna",
    `Estilo de miniaturas del canal: ${input.kit.thumbnailStyle}`,
    "",
    ...input.items.map((it) =>
      [
        `## Miniatura ${thumbnailLetter(it.idx)} (idx ${it.idx})`,
        `esquema: ${schemeGuide(it.scheme)}`,
        `escenario: ${it.scenario}`,
        `texto: ${it.text} (en naranja: ${it.accent})`,
        `ángulo: ${it.angle}`,
        `emoción: ${it.emotion}`,
        ...(it.idea.trim() ? [`idea de escena: ${it.idea.trim()}`] : []),
        ...(it.note?.trim()
          ? [`Indicación del presentador para esta versión: ${it.note.trim()}`]
          : []),
      ].join("\n"),
    ),
  ].join("\n");

  const res = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 4_000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "low", format: betaZodOutputFormat(briefSchema) },
    ...(config.fallbacks && {
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
    }),
  });
  if (res.stop_reason === "refusal") {
    const details = (res as { stop_details?: { category?: string | null } | null }).stop_details;
    throw new AiRefusalError(details?.category ?? null);
  }
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("El brief de las miniaturas llegó incompleto");
  const briefs = input.items.map((it, i) => {
    const b = parsed.briefs.find((x) => x.idx === it.idx) ?? parsed.briefs[i];
    const scene = b?.scene?.trim() || it.idea;
    return {
      idx: it.idx,
      scene: hasFace(it.scheme) ? scene : withoutPeople(scene, input.presenter),
      mirror: THUMBNAIL_SCHEMES[it.scheme].mirror && Boolean(b?.mirror),
    } satisfies ThumbnailBrief;
  });
  return { briefs, usage: addUsage(emptyUsage(), res.usage), model: res.model };
}

/** La composición fija de cada esquema (guía v1.0), en inglés para Gemini. */
function schemeComposition(scheme: SchemeId, mirror: boolean, scenario: Scenario) {
  const near = mirror ? "left" : "right";
  const far = mirror ? "right" : "left";
  switch (scheme) {
    case "A":
      return [
        `On the ${near} (40% of the width), the presenter from the waist up, eyes in the upper third, looking at the camera with a calm, honest expression of doubt: one eyebrow slightly raised, a hand lightly touching the chin without covering the beard or the mouth.`,
        `The product is optional: in his hand or behind him, never between him and the ${far} side.`,
        `The ${far} 50% of the frame stays as empty dark brand background for the headline.`,
      ];
    case "B":
      return [
        "On the right (40% of the width), the real product from Product photo 1, large and sharp, rotated 5–10°, with an orange rim reflection on its edge and nothing around it.",
        "The left 55% of the frame stays as empty dark brand background for a big figure and its words.",
      ];
    case "C":
      return [
        `On the ${far} (45% of the width), the presenter from the waist up, holding the real product toward the camera, with the product between him and the ${near} side.`,
        "Calm confidence: a slight smile if he recommends it, a slight frown if not (as the scene says). No thumbs, no exaggerated gestures.",
        `The ${near} 40% of the frame stays as empty dark brand background for the answer.`,
      ];
    case "D":
      return [
        "Real product 1 (Product photo 1) on the left and real product 2 (Product photo 2) on the right, the same size, angle and light. Only these two products.",
        "In the center, the presenter small (about 25% of the width), from the chest up, looking at product 2 with a thoughtful gesture that hints at the winner without revealing it.",
        "The top 30% of the frame stays as empty dark background for a one-line headline. No dividing lines, lightning bolts or versus signs.",
      ];
    case "E":
      return [
        "A macro close-up of the real product (Product photo 1) filling the upper-right two thirds and bleeding off the frame, a single point of focus on the detail, shallow depth of field.",
        "The lower-left area fades to black and stays empty for the headline; the detail is never there.",
      ];
    case "F":
      return [
        `A real full-bleed scene in ${SCENARIO_EN[scenario]}, graded to the brand palette: the presenter on the right, using the real product, focused, not looking at the camera.`,
        "The upper-left area fades to black and stays empty for the headline.",
        "No visible brands, no people in the background, no cold or blue light.",
      ];
  }
}

/** Qué tan grande y cómo se ve la cara en cada esquema con cara. */
const FACE_RULE: Partial<Record<SchemeId, string>> = {
  A: "His face is large (the head at least a quarter of the frame height), facing the camera, sharp and well lit.",
  C: "His face is large (the head at least a quarter of the frame height), facing the camera or in three-quarter view, sharp and well lit.",
  D: "Even though he is small in the frame, his head and face are clearly visible, sharp and well lit, facing the camera or in three-quarter view.",
  F: "He looks at the product, not at the camera, but his face stays clearly visible in three-quarter view, sharp and well lit; never from behind, never hidden.",
};

/** La identidad del presentador: va al principio del prompt y se repite al final. */
function identityBlock(scheme: SchemeId, presenterRefs: number) {
  return [
    `IDENTITY — the most important rule: the ${presenterRefs} images labeled "Reference photo of the presenter" all show the same real person, and the man in this thumbnail must be exactly that person, not a similar-looking or generic man: the same face shape, eyes, eyebrows, nose, mouth, beard (length, shape and density), hair (color, length and hairline), skin tone and clothes as in the reference photos. Do not beautify him, change his age, weight or features, or replace him with anyone else.`,
    FACE_RULE[scheme] ?? "",
    "Nothing covers his face: no hands, product, hair or shadows over the eyes, nose, mouth or beard.",
  ].filter(Boolean);
}

/** Lo que se le pide a Gemini cuando el intento anterior no pasó la verificación. */
export function identityCorrection(scheme: SchemeId, notes: string) {
  const detail = notes.trim() ? ` What was wrong: ${notes.trim()}` : "";
  return hasFace(scheme)
    ? `CORRECTION: the previous attempt did not look like the presenter.${detail} This time the face must match the reference photos exactly.`
    : `CORRECTION: the previous attempt showed a person.${detail} This time there are no people at all.`;
}

/**
 * La instrucción completa para Gemini: el prompt base de la guía, qué son las
 * referencias, la composición del esquema y la escena. Lo único adaptado de la
 * guía: el texto no lo pinta Gemini, deja libre su zona y lo pone la app. En
 * los esquemas con cara, la identidad va primero y se repite al final.
 */
export function schemeImagePrompt(input: {
  scheme: SchemeId;
  scene: string;
  scenario: Scenario;
  mirror?: boolean;
  presenterRefs: number;
  productRefs: number;
  kit: Pick<ThumbnailKit, "canvas" | "glow" | "amberDeep" | "accent" | "cream" | "grid">;
}): string {
  const s = THUMBNAIL_SCHEMES[input.scheme];
  const mirror = s.mirror && Boolean(input.mirror);
  const face = hasFace(input.scheme) && input.presenterRefs > 0;
  const k = input.kit;
  const background = s.grid
    ? `Gartechs identity: near-black background ${k.canvas} with a very faint orange grid (${k.grid} at 10% opacity), a radial orange glow (${k.glow} at the center falling to ${k.amberDeep}) behind the main subject, vignette to black.`
    : `Gartechs identity without the grid: the real scene graded to the brand palette, a warm orange glow (${k.glow} to ${k.amberDeep}) behind the main subject, vignette to black.`;
  const noPeople =
    input.scheme === "E"
      ? "No people at all: no person, face or body (at most one hand entering the frame to give scale)."
      : "No people at all: no person, face, body or hands.";
  return [
    "Photorealistic YouTube thumbnail, 16:9, 1280×720.",
    ...(face ? identityBlock(input.scheme, input.presenterRefs) : []),
    ...(hasFace(input.scheme) ? [] : [noPeople]),
    ...(input.productRefs
      ? [
          `The images labeled "Product photo" show the real product: reproduce it exactly (shape, color, ports, logos on the device itself). Never invent products or logos.`,
        ]
      : []),
    background,
    `Warm side light. Palette: black, white, cream ${k.cream} and orange ${k.accent}.`,
    `Composition (scheme ${input.scheme} · ${s.name}):`,
    ...schemeComposition(input.scheme, mirror, input.scenario),
    `Scene: ${input.scene}`,
    ...(face ? ["Natural expression: never surprised, never an open mouth, never pointing."] : []),
    ...(face && input.productRefs
      ? [
          "Priority if everything does not fit: the product stays whole, large and uncovered; reduce or crop the presenter's body (shoulders, arms, torso) instead, never the product. His face stays recognizable.",
        ]
      : []),
    "Keep a 64 px safe margin on every side for the important parts. The bottom-right corner (220×90 px) stays empty: no face, product or detail there, because the video duration goes there.",
    "The headline is added later by the app: leave its area empty and do not draw any text.",
    "Strictly no text, letters, numbers, captions, logos, watermarks, arrows, red circles, emojis, frames or borders anywhere, including on screens and objects. No blue, neon, RGB, yellow, wood or gold as a dominant color.",
    face
      ? "Final check before answering: the man must be unmistakably the person in the reference photos — same face, beard and hair. If he could be someone else, it is wrong."
      : `Final check before answering: ${noPeople.charAt(0).toLowerCase()}${noPeople.slice(1)}`,
  ].join("\n");
}

const identitySchema = z.object({
  person: z.boolean().describe("Aparece una persona (cara o cuerpo). Una mano sola no cuenta."),
  same_person: z
    .boolean()
    .describe("Si aparece, es inequívocamente la misma persona de las fotos de referencia."),
  likeness: z
    .number()
    .int()
    .min(0)
    .max(10)
    .describe("Parecido con las fotos de referencia, de 0 a 10 (0 si no aparece nadie)."),
  notes: z
    .string()
    .describe(
      "En inglés y en una frase: qué cambia respecto a las fotos (barba, pelo, forma de la cara, edad…) o qué persona sobra. Vacío si está bien.",
    ),
});

export type IdentityCheck = {
  ok: boolean;
  likeness: number;
  notes: string;
};

/**
 * Antes de componer: ¿la persona de la imagen (sin texto) es el presentador de
 * las fotos? En los esquemas sin cara (B, E), que no aparezca nadie.
 */
export async function checkIdentity(
  client: StreamClient,
  config: AiConfig,
  input: {
    image: Buffer;
    mime: string;
    scheme: SchemeId;
    references: { data: Buffer; mime: string }[];
  },
): Promise<{ check: IdentityCheck; usage: UsageTotals; model: string }> {
  const face = hasFace(input.scheme);
  const image = (data: Buffer, mime: string) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: mime as "image/jpeg",
      data: data.toString("base64"),
    },
  });
  const res = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 800,
    system: [
      "Verificas la identidad en imágenes generadas para miniaturas de YouTube. Eres estricto: un parecido general (mismo tipo de barba, misma edad aproximada) no basta; tiene que ser la misma persona, reconocible por quien la conoce.",
      face
        ? "Compara la persona de la imagen generada con las fotos de referencia del presentador: forma de la cara, ojos, cejas, nariz, boca, barba, pelo, entradas y tono de piel."
        : "Este esquema no lleva personas: revisa que no aparezca nadie (una mano sola que entra al cuadro no cuenta).",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          { type: "text" as const, text: "Imagen generada:" },
          image(input.image, input.mime),
          ...(face
            ? input.references.flatMap((r, i) => [
                { type: "text" as const, text: `Foto de referencia del presentador ${i + 1}:` },
                image(r.data, r.mime),
              ])
            : []),
          {
            type: "text" as const,
            text: face
              ? "¿La persona de la imagen generada es el presentador de las fotos?"
              : "¿Aparece alguna persona en la imagen generada?",
          },
        ],
      },
    ],
    output_config: { effort: "low", format: betaZodOutputFormat(identitySchema) },
    ...(config.fallbacks && {
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
    }),
  });
  if (res.stop_reason === "refusal") {
    const details = (res as { stop_details?: { category?: string | null } | null }).stop_details;
    throw new AiRefusalError(details?.category ?? null);
  }
  const p = res.parsed_output;
  if (!p) throw new Error("La verificación de la cara llegó incompleta");
  const ok = face ? p.person && p.same_person : !p.person;
  return {
    check: { ok, likeness: face ? p.likeness : ok ? 10 : 0, notes: p.notes.trim() },
    usage: addUsage(emptyUsage(), res.usage),
    model: res.model,
  };
}

export const SCORE_CRITERIA = [
  "scheme",
  "text",
  "title",
  "face",
  "product",
  "separation",
  "corner",
  "prohibited",
  "mobile",
  "verdict",
] as const;
export type ScoreCriterion = (typeof SCORE_CRITERIA)[number];

const scoreSchema = z.object({
  score: z.number().int().min(0).max(10).describe("Nota de 0 a 10."),
  criteria: z.array(
    z.object({
      key: z.enum(SCORE_CRITERIA),
      ok: z.boolean(),
      note: z.string().describe("Una frase corta en español."),
    }),
  ),
  improve: z.string().describe("Qué cambiar para la próxima versión, en una o dos frases."),
});

export type ThumbnailScore = z.infer<typeof scoreSchema>;

/** Qué pide la guía de la imagen de cada esquema, para la calificación. */
const SCHEME_CHECK: Record<SchemeId, string> = {
  A: "Pregunta con ¿? en el 50 % izquierdo (derecho en espejo); el presentador en el 40 % del otro lado, de la cintura hacia arriba, mirando a cámara con duda honesta (ceja levantada, mano al mentón); el producto nunca entre él y el texto.",
  B: "Sin personas. La cifra enorme en naranja y 1–2 palabras debajo a la izquierda; el producto real en el 40 % derecho, girado 5–10°, sin objetos alrededor.",
  C: "La respuesta sin signos de pregunta en el 40 % derecho (izquierdo en espejo); el presentador en el 45 % del otro lado sosteniendo el producto hacia la cámara, entre él y el texto, con seguridad tranquila.",
  D: "Una línea centrada arriba; dos productos reales a izquierda y derecha con la misma escala, ángulo y luz; el presentador pequeño al centro, pensativo, mirando a uno sin revelar el ganador. Sin VS, rayos ni líneas divisorias.",
  E: "Sin personas (salvo una mano para dar escala). Macro real del producto arriba a la derecha que sale del cuadro, un solo punto de foco; el texto abajo a la izquierda sobre degradado negro, nunca encima del detalle.",
  F: "Escena real a sangre, sin retícula, graduada a la paleta; el presentador a la derecha usando el producto, concentrado y sin mirar a cámara; el texto arriba a la izquierda sobre degradado negro. Sin marcas visibles, gente de fondo ni luz fría.",
};

/** Claude mira la miniatura terminada (y reducida para el móvil) y la califica con la guía. */
export async function scoreThumbnail(
  client: StreamClient,
  config: AiConfig,
  input: {
    image: Buffer;
    /** La misma miniatura a 168 × 94 px (prueba de móvil). */
    mobile: Buffer;
    mime: string;
    scheme: SchemeId;
    text: ThumbnailText;
    topic: string;
    titles: string[];
    verdict: string;
    /** Lo que la app ya midió: la separación del texto y la esquina de la duración. */
    warnings: string[];
    /** Una foto del presentador, para comparar la cara. */
    reference?: { data: Buffer; mime: string } | null;
  },
): Promise<{ score: ThumbnailScore; usage: UsageTotals; model: string }> {
  const s = THUMBNAIL_SCHEMES[input.scheme];
  const text = input.text.lines.join(" ");
  const ruleErrors = validateSchemeText(input.scheme, text, input.text.accent);
  const system = [
    "Calificas miniaturas de YouTube de un canal de tecnología con la guía de miniaturas del canal. Respondes en español.",
    "Criterios (uno por clave):",
    "- scheme: la imagen sigue la composición de su esquema (abajo).",
    "- text: 2–4 palabras, máximo 22 caracteres y 2 líneas, tipo oración con tildes y ¿? ¡! de apertura, una sola palabra naranja (la que carga la emoción o la decisión); sin superlativos vacíos, marcas, precios sin moneda, emojis ni clickbait que el video no cumpla.",
    "- title: completa el título del video sin repetirlo; juntos forman una idea completa.",
    "- face: si el esquema lleva cara, es la misma persona de la foto de referencia (mismo rostro, barba, pelo y ropa) con la expresión del esquema y natural: nunca asombro, boca abierta ni señalar. Si parece otra persona, va en falso y la nota no pasa de 4. Si el esquema no lleva cara, no aparece ninguna persona.",
    "- product: el producto es el real de sus fotos; nada de productos o logos inventados.",
    "- separation: el texto y la cara no se tocan (40 px de separación mínima). La app ya lo midió: usa ese dato.",
    "- corner: la esquina inferior derecha (220 × 90 px) queda vacía para la duración; la app ya comprobó el texto, tú miras que no haya cara, producto ni detalle importante ahí.",
    "- prohibited: sin flechas, círculos rojos, emojis, marcos, texto adicional en pantallas u objetos, ni azul, neón, RGB, amarillo, madera o dorado como color dominante.",
    "- mobile: en la versión de 168 × 94 px el texto se lee y la cara (si la hay) se reconoce. Si no, hay que simplificar.",
    "- verdict: parte del veredicto del guion, no lo contradice ni promete lo que el video no entrega.",
    "La nota es de 0 a 10; 8 o más significa lista para publicar.",
  ].join("\n");
  const image = (data: Buffer, mime: string) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: mime as "image/jpeg",
      data: data.toString("base64"),
    },
  });
  const res = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 2_000,
    system,
    messages: [
      {
        role: "user",
        content: [
          image(input.image, input.mime),
          { type: "text" as const, text: "La misma miniatura a 168 × 94 px (prueba de móvil):" },
          image(input.mobile, "image/jpeg"),
          ...(input.reference && hasFace(input.scheme)
            ? [
                { type: "text" as const, text: "Foto de referencia del presentador:" },
                image(input.reference.data, input.reference.mime),
              ]
            : []),
          {
            type: "text",
            text: [
              `Tema central del episodio: ${input.topic}`,
              input.titles.length ? `Títulos del video: ${input.titles.join(" | ")}` : "",
              `Esquema: ${input.scheme} · ${s.name}. ${SCHEME_CHECK[input.scheme]}`,
              `Texto de la miniatura: ${text} (en naranja: ${input.text.accent})`,
              ruleErrors.length
                ? `Reglas de texto que no cumple: ${ruleErrors.join(" ")}`
                : "Reglas de texto medibles: cumple.",
              input.warnings.length
                ? `Medido por la app: ${input.warnings.join(" ")}`
                : `Medido por la app: el texto deja ${FACE_GAP} px o más a la cara, está dentro del margen y no toca la esquina de la duración.`,
              `Veredicto del episodio: ${input.verdict || "(sin veredicto)"}`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
    ],
    output_config: { effort: "low", format: betaZodOutputFormat(scoreSchema) },
    ...(config.fallbacks && {
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
    }),
  });
  if (res.stop_reason === "refusal") {
    const details = (res as { stop_details?: { category?: string | null } | null }).stop_details;
    throw new AiRefusalError(details?.category ?? null);
  }
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("La calificación de la miniatura llegó incompleta");
  return { score: parsed, usage: addUsage(emptyUsage(), res.usage), model: res.model };
}

/** Un recuadro en fracciones del ancho y el alto de la imagen (0 a 1). */
export type SubjectBox = {
  label: "face" | "person" | "product";
  x: number;
  y: number;
  w: number;
  h: number;
};

const subjectsSchema = z.object({
  boxes: z.array(
    z.object({
      label: z.enum(["face", "person", "product"]),
      x: z.number().describe("Borde izquierdo, de 0 a 1 del ancho."),
      y: z.number().describe("Borde de arriba, de 0 a 1 del alto."),
      w: z.number().describe("Ancho, de 0 a 1."),
      h: z.number().describe("Alto, de 0 a 1."),
    }),
  ),
});

/**
 * Dónde están la cara, el cuerpo y el producto en la imagen (sin texto), para
 * que el texto no los tape. Un análisis de píxeles no basta: la pantalla oscura
 * de un portátil o un celular parece fondo vacío.
 */
export async function locateSubjects(
  client: StreamClient,
  config: AiConfig,
  input: { image: Buffer; mime: string },
): Promise<{ boxes: SubjectBox[]; usage: UsageTotals; model: string }> {
  const res = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 1_000,
    system:
      "Ubicas los elementos de una foto para que un titular no los tape. Devuelves recuadros en fracciones de la imagen (0 a 1): la cara del presentador (face), su cuerpo completo visible (person) y cada producto o dispositivo (product). Si algo no está, no lo incluyes.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: input.mime as "image/jpeg",
              data: input.image.toString("base64"),
            },
          },
          { type: "text", text: "Ubica la cara, el cuerpo y los productos de esta foto." },
        ],
      },
    ],
    output_config: { effort: "low", format: betaZodOutputFormat(subjectsSchema) },
    ...(config.fallbacks && {
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
    }),
  });
  if (res.stop_reason === "refusal") {
    const details = (res as { stop_details?: { category?: string | null } | null }).stop_details;
    throw new AiRefusalError(details?.category ?? null);
  }
  const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  const boxes = (res.parsed_output?.boxes ?? [])
    .map((b) => {
      const x = clamp(b.x);
      const y = clamp(b.y);
      return {
        label: b.label,
        x,
        y,
        w: clamp(Math.min(b.w, 1 - x)),
        h: clamp(Math.min(b.h, 1 - y)),
      };
    })
    .filter((b) => b.w > 0 && b.h > 0);
  return { boxes, usage: addUsage(emptyUsage(), res.usage), model: res.model };
}

/** Un texto propuesto para una miniatura, con su esquema y su ángulo. */
export type ThumbnailIdea = {
  scheme: SchemeId;
  angle: string;
  text: string;
  accent: string;
  scene: string;
  emotion: string;
};

export const THUMBNAIL_IDEAS_COUNT = 30;
/** Textos mínimos por esquema disponible. */
export const IDEAS_PER_SCHEME = 3;

const ideasSchema = z.object({
  ideas: z.array(
    z.object({
      scheme: z.enum(SCHEME_IDS).describe("El esquema de composición: A, B, C, D, E o F."),
      angle: z
        .string()
        .describe("El ángulo en 1 a 4 palabras: el dinero, el error, la comparación, el mito…"),
      text: z.string().describe("El texto de la miniatura, con las reglas de su esquema."),
      accent: z
        .string()
        .describe("La única palabra del texto que va en naranja (en B, la cifra tal cual)."),
      scene: z
        .string()
        .describe(
          "La escena de la imagen en una frase, según su esquema. En B y E, solo el producto o el detalle, sin personas.",
        ),
      emotion: z.string().describe("La emoción que despierta, en 1 a 3 palabras."),
    }),
  ),
});

/** Las reglas de texto de cada esquema, para Claude. */
const SCHEME_TEXT: Record<SchemeId, string> = {
  A: "una pregunta de 2–4 palabras con ¿?; la palabra naranja es la que duda. No repite el título como pregunta.",
  B: "una cifra verificada de la ficha (máx. 4 caracteres: 40%, 3×, $199, 20 h; sin decimales, rangos ni dos cifras) y 1–2 palabras después. La cifra es la palabra naranja.",
  C: "la respuesta en 2–3 palabras, sin signos de pregunta (Sí lo compro, Espera un año, No lo compres, Me quedo con este).",
  D: "2–3 palabras en una línea, sin «VS» ni marcas (¿Cuál gana?, ¿Vale el cambio?, Solo uno).",
  E: "2–3 palabras sobre el detalle (Nadie lo nota, El fallo, Lo mejor está aquí).",
  F: "2–3 palabras que suelen hablar de tiempo o resultado (Un mes después, Mi setup real, Así lo uso).",
};

export interface IdeasInput {
  episodeTitle: string;
  verdict: string;
  /** La ficha del episodio (paso «sheet»); manda sobre las cifras. */
  sheet: string;
  titles: string[];
  keywords: string[];
  thumbnailStyle: string;
  presenter: string;
  /** Los esquemas que se pueden usar (según las fotos del producto). */
  schemes: SchemeId[];
  /** El set recomendado para el tipo de episodio. */
  recommended: SchemeId[];
}

/**
 * 30 textos de ángulos distintos alrededor del tema central del episodio, cada
 * uno con su esquema de la guía, para elegir los 3 de «Probar y comparar».
 * Los que no cumplen las reglas de texto de su esquema se descartan.
 */
export async function thumbnailIdeas(
  client: StreamClient,
  config: AiConfig,
  input: IdeasInput,
): Promise<{ ideas: ThumbnailIdea[]; usage: UsageTotals; model: string }> {
  const schemes = SCHEME_IDS.filter((id) => input.schemes.includes(id));
  const recommended = input.recommended.filter((id) => schemes.includes(id));
  const system = [
    `Propones ${THUMBNAIL_IDEAS_COUNT} textos para miniaturas de YouTube de un canal de tecnología, en español, con la guía de miniaturas del canal.`,
    "Todos parten de «el punto»: el veredicto del guion. Giran alrededor del tema central del episodio desde ángulos distintos (el dinero, el error, la comparación, el mito, el uso real, para quién sí, para quién no, la sorpresa, el riesgo…).",
    "Cada texto lleva uno de estos esquemas de composición, y cumple sus reglas:",
    ...schemes.map(
      (id) =>
        `- ${id} · ${THUMBNAIL_SCHEMES[id].name}. Úsalo cuando: ${THUMBNAIL_SCHEMES[id].when} No lo uses si: ${THUMBNAIL_SCHEMES[id].avoid} Texto: ${SCHEME_TEXT[id]}`,
    ),
    `Reparte los textos entre esos esquemas: al menos ${IDEAS_PER_SCHEME} por esquema${recommended.length ? `, y más en el set recomendado para este episodio (${recommended.join("+")})` : ""}.`,
    "Reglas de todos los textos: máximo 22 caracteres con espacios y 2 líneas; tipo oración (nunca TODO MAYÚSCULAS), con tildes y ¿? ¡! de apertura; una sola palabra en naranja, la que carga la emoción o la decisión; sin superlativos vacíos (increíble, brutal), sin marcas (ya van en el título), sin precios sin moneda, sin emojis y sin clickbait que el video no cumpla.",
    "El texto completa el título, no lo repite: juntos forman una idea completa. Las cifras solo pueden salir de la ficha del episodio. Ningún texto contradice el veredicto. No repitas textos.",
    "Por cada texto: el esquema, el ángulo, el texto, la palabra en naranja, la escena de la imagen en una frase según su esquema y la emoción. En la escena no describas el físico del presentador; en B y E no aparece ninguna persona.",
  ].join("\n");
  const user = [
    `Tema central del episodio: ${input.episodeTitle}`,
    `Veredicto («el punto»): ${input.verdict || "(sin veredicto)"}`,
    `Presentador: ${input.presenter}`,
    input.titles.length ? `Títulos del video: ${input.titles.join(" | ")}` : "",
    input.keywords.length ? `Keywords: ${input.keywords.join(", ")}` : "",
    `Estilo de miniaturas del canal: ${input.thumbnailStyle}`,
    "",
    "## Ficha del episodio",
    input.sheet.trim().slice(0, 12_000) || "(sin ficha)",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const res = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 8_000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "low", format: betaZodOutputFormat(ideasSchema) },
    ...(config.fallbacks && {
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
    }),
  });
  if (res.stop_reason === "refusal") {
    const details = (res as { stop_details?: { category?: string | null } | null }).stop_details;
    throw new AiRefusalError(details?.category ?? null);
  }
  const parsed = res.parsed_output;
  if (!parsed?.ideas.length) throw new Error("Los textos de las miniaturas llegaron vacíos");
  const seen = new Set<string>();
  const ideas: ThumbnailIdea[] = [];
  for (const i of parsed.ideas) {
    const text = i.text.trim().replace(/\s+/g, " ");
    const key = text.toLowerCase();
    if (!text || seen.has(key) || !schemes.includes(i.scheme)) continue;
    const accent = findAccent(text, i.accent);
    if (validateSchemeText(i.scheme, text, accent).length) continue;
    seen.add(key);
    ideas.push({
      scheme: i.scheme,
      angle: i.angle.trim().slice(0, 60) || "Otro",
      text,
      accent: accent.slice(0, 40),
      scene: (hasFace(i.scheme) ? i.scene.trim() : withoutPeople(i.scene, input.presenter)).slice(
        0,
        400,
      ),
      emotion: i.emotion.trim().slice(0, 80),
    });
  }
  return {
    ideas: ideas.slice(0, THUMBNAIL_IDEAS_COUNT),
    usage: addUsage(emptyUsage(), res.usage),
    model: res.model,
  };
}
