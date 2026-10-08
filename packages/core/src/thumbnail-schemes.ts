/**
 * Guía de miniaturas v1.0 (octubre de 2026): seis esquemas de composición y
 * las reglas de texto. Cada video lleva tres miniaturas de esquemas distintos,
 * al menos una con cara y una sin cara.
 */

export const SCHEME_IDS = ["A", "B", "C", "D", "E", "F"] as const;
export type SchemeId = (typeof SCHEME_IDS)[number];
export const isSchemeId = (v: unknown): v is SchemeId =>
  typeof v === "string" && (SCHEME_IDS as readonly string[]).includes(v);

export type SchemeFace = "yes" | "small" | "no" | "away";

export interface ThumbnailScheme {
  id: SchemeId;
  name: string;
  /** Cara del presentador: sí, pequeña, no aparece o sin mirar a cámara. */
  face: SchemeFace;
  minWords: number;
  maxWords: number;
  /** Fotos reales del producto que necesita (D: las dos). */
  productPhotos: number;
  /** F es el único esquema sin retícula. */
  grid: boolean;
  /** Degradado negro detrás del texto (E abajo a la izquierda, F arriba a la izquierda). */
  gradient: "none" | "bottom-left" | "top-left";
  /** A y C pueden invertirse (texto del otro lado). */
  mirror: boolean;
  when: string;
  avoid: string;
  examples: string[];
}

export const THUMBNAIL_SCHEMES: Record<SchemeId, ThumbnailScheme> = {
  A: {
    id: "A",
    name: "La pregunta",
    face: "yes",
    minWords: 2,
    maxWords: 4,
    productPhotos: 0,
    grid: true,
    gradient: "none",
    mirror: true,
    when: "El video responde una duda concreta que el público ya se hace.",
    avoid: "La respuesta es obvia o el título ya es una pregunta.",
    examples: ["¿Vale la pena?", "¿Sirve para trabajar?"],
  },
  B: {
    id: "B",
    name: "El dato",
    face: "no",
    minWords: 2,
    maxWords: 3,
    productPhotos: 1,
    grid: true,
    gradient: "none",
    mirror: false,
    when: "Hay una cifra verificada que sorprende o resume el video: precio, ahorro, horas de batería, rendimiento.",
    avoid: "La cifra no está verificada o necesita contexto para entenderse.",
    examples: ["40% más barato", "20 h de batería"],
  },
  C: {
    id: "C",
    name: "El veredicto",
    face: "yes",
    minWords: 2,
    maxWords: 3,
    productPhotos: 0,
    grid: true,
    gradient: "none",
    mirror: true,
    when: "El video termina con una recomendación firme: comprar, esperar, no comprar.",
    avoid: "Todavía no hay postura o el veredicto es «depende».",
    examples: ["Sí lo compro", "Espera un año", "No lo compres", "Me quedo con este"],
  },
  D: {
    id: "D",
    name: "El duelo",
    face: "small",
    minWords: 2,
    maxWords: 3,
    productPhotos: 2,
    grid: true,
    gradient: "none",
    mirror: false,
    when: "Comparativas «X o Y», alternativas, versión nueva contra la anterior.",
    avoid: "Hay más de dos productos o no hay foto real de ambos.",
    examples: ["¿Cuál gana?", "¿Vale el cambio?", "Solo uno"],
  },
  E: {
    id: "E",
    name: "El detalle",
    face: "no",
    minWords: 2,
    maxWords: 3,
    productPhotos: 1,
    grid: true,
    gradient: "bottom-left",
    mirror: false,
    when: "El video gira en torno a una pieza, una función o un defecto visible.",
    avoid: "El detalle no se ve en una foto o necesita explicación.",
    examples: ["Nadie lo nota", "El fallo", "Lo mejor está aquí"],
  },
  F: {
    id: "F",
    name: "En uso",
    face: "away",
    minWords: 2,
    maxWords: 3,
    productPhotos: 1,
    grid: false,
    gradient: "top-left",
    mirror: false,
    when: "Pruebas de largo plazo, tutoriales, «en la vida real», configuraciones y rutinas.",
    avoid: "El escenario distrae más que el producto.",
    examples: ["Un mes después", "Mi setup real", "Así lo uso"],
  },
};

/** Esquemas con la cara del presentador y sin ella. */
export const hasFace = (id: SchemeId) => THUMBNAIL_SCHEMES[id].face !== "no";

export type EpisodeKind = "review" | "comparison" | "tutorial";

/** Sets recomendados: reseña A+B+C, comparativa D+B+C, tutorial o largo plazo F+E+A. */
export const RECOMMENDED_SETS: Record<EpisodeKind, SchemeId[]> = {
  review: ["A", "B", "C"],
  comparison: ["D", "B", "C"],
  tutorial: ["F", "E", "A"],
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** El tipo de episodio (campo «tipo» del JSON de Publicación) a su set. */
export function episodeKind(tipo: string | null | undefined): EpisodeKind {
  const t = fold(tipo ?? "");
  if (/compar|\bvs\b|versus|\bduelo\b|alternativ/.test(t)) return "comparison";
  if (/tutorial|largo plazo|guia|como |configur|rutina|en uso|vida real|un mes/.test(t))
    return "tutorial";
  return "review";
}

/** Escenarios para rotar (no repetir los de los últimos 3 videos ni dentro del set). */
export const SCENARIOS = [
  "set oscuro",
  "escritorio",
  "en la mano",
  "detalle",
  "sofá",
  "café",
  "carro",
  "calle",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** Los escenarios que admite cada esquema (B y D van sobre el fondo de la marca). */
export const SCHEME_SCENARIOS: Record<SchemeId, readonly Scenario[]> = {
  A: ["set oscuro", "escritorio", "sofá", "café", "carro", "calle"],
  B: ["set oscuro", "escritorio"],
  C: ["en la mano", "set oscuro", "escritorio", "sofá", "café"],
  D: ["set oscuro", "escritorio"],
  E: ["detalle", "set oscuro", "escritorio"],
  F: ["escritorio", "sofá", "café", "carro", "calle"],
};

/**
 * El escenario de cada miniatura del set: ninguno repetido dentro del set y,
 * si se puede, ninguno de los últimos 3 videos. Se asignan primero los
 * esquemas con menos opciones.
 */
export function assignScenarios(
  schemes: readonly SchemeId[],
  recent: readonly string[] = [],
): Scenario[] {
  const out: Scenario[] = new Array(schemes.length);
  const used = new Set<Scenario>();
  const order = schemes
    .map((scheme, i) => ({ scheme, i }))
    .sort((a, b) => SCHEME_SCENARIOS[a.scheme].length - SCHEME_SCENARIOS[b.scheme].length);
  for (const { scheme, i } of order) {
    const options = SCHEME_SCENARIOS[scheme];
    const pick =
      options.find((o) => !used.has(o) && !recent.includes(o)) ??
      options.find((o) => !used.has(o)) ??
      options[0]!;
    used.add(pick);
    out[i] = pick;
  }
  return out;
}

/** El veredicto existe y es una postura (no «depende»). */
export function hasVerdict(postura: string | null | undefined) {
  const v = fold(postura ?? "").trim();
  return v.length > 0 && !/^depende\b/.test(v);
}

/** Qué esquemas se pueden usar con las fotos del producto que hay. */
export function availableSchemes(productPhotos: number): SchemeId[] {
  return SCHEME_IDS.filter((id) => THUMBNAIL_SCHEMES[id].productPhotos <= productPhotos);
}

export const TEXT_MAX_CHARS = 22;
export const TEXT_MAX_LINES = 2;

const EMPTY_SUPERLATIVES = [
  "increible",
  "brutal",
  "epico",
  "impresionante",
  "alucinante",
  "espectacular",
  "bestial",
  "insano",
  "locura",
  "lo nunca visto",
  "el mejor del mundo",
];

const bare = (w: string) => fold(w).replace(/[^\p{L}\p{N}%$€×]/gu, "");

/** La cifra de B: máx. 4 caracteres (40%, 3×, $199, 20 h). */
const FIGURE = /^([$€]?\d+(?:[.,]\d+)?(?:%|×|x)?)(\s(?:h|GB|TB|W|Hz|K|mAh|min))?(?=\s|$)/u;

/**
 * Las infracciones del texto de una miniatura según su esquema (vacío si
 * cumple). Lo que pide criterio (clickbait, que repita el título, marcas)
 * lo revisa la calificación.
 */
export function validateSchemeText(scheme: SchemeId, text: string, accent: string): string[] {
  const out: string[] = [];
  const s = THUMBNAIL_SCHEMES[scheme];
  const t = text.trim().replace(/\s+/g, " ");
  const words = t.split(" ").filter((w) => bare(w) !== "");
  if (!t) return ["Falta el texto."];

  if (t.length > TEXT_MAX_CHARS)
    out.push(`Máximo ${TEXT_MAX_CHARS} caracteres con espacios (tiene ${t.length}).`);

  const letters = t.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 4 && letters === letters.toUpperCase())
    out.push("Tipo oración: nunca TODO EN MAYÚSCULAS.");
  if (/\p{Extended_Pictographic}/u.test(t)) out.push("Sin emojis.");
  if (/[!?]{2,}|[¡¿]{2,}/.test(t)) out.push("Un solo signo de pregunta o exclamación.");
  if ((t.match(/\?/g) ?? []).length !== (t.match(/¿/g) ?? []).length)
    out.push("La pregunta lleva ¿ de apertura.");
  if ((t.match(/!/g) ?? []).length !== (t.match(/¡/g) ?? []).length)
    out.push("La exclamación lleva ¡ de apertura.");
  if (/(^|\s)vs\.?(\s|$)/i.test(t)) out.push("Nada de «VS».");
  const folded = ` ${fold(t).replace(/[^\p{L}\p{N}\s]/gu, "")} `;
  for (const w of EMPTY_SUPERLATIVES) {
    if (folded.includes(` ${w} `)) {
      out.push(`Sin superlativos vacíos («${w}»).`);
      break;
    }
  }
  // Un número de 3 o más cifras sin moneda ni unidad parece un precio sin moneda.
  const currency = /^(usd|cop|mxn|eur|euros?|dolares?|pesos?|soles?|\$|€)$/;
  for (const [i, w] of words.entries()) {
    const next = fold(words[i + 1] ?? "").replace(/[^\p{L}$€]/gu, "");
    if (/^\d{3,}$/.test(w) && !/^(19|20)\d{2}$/.test(w) && !currency.test(next)) {
      out.push("Los precios llevan moneda ($199 o 199 USD).");
      break;
    }
  }

  const accentWords = words.filter((w) => bare(w) !== "" && bare(w) === bare(accent));
  if (!accent.trim() || accentWords.length === 0)
    out.push("La palabra en naranja tiene que estar en el texto.");

  if (scheme === "B") {
    const m = FIGURE.exec(t);
    if (!m) {
      out.push("El dato empieza con una cifra (40%, 3×, $199, 20 h).");
    } else {
      const figure = m[0];
      const rest = t
        .slice(figure.length)
        .trim()
        .split(" ")
        .filter((w) => bare(w) !== "");
      if (figure.replace(/\s/g, "").length > 4) out.push("La cifra tiene máximo 4 caracteres.");
      if (/[.,]\d/.test(figure)) out.push("La cifra va sin decimales.");
      if (rest.length < 1 || rest.length > 2) out.push("Debajo de la cifra van 1 o 2 palabras.");
      if (rest.some((w) => /\d/.test(w)) || /\d\s?[-–]\s?\d/.test(t))
        out.push("Una sola cifra: sin rangos ni dos cifras.");
      if (bare(accent) !== bare(m[1]!)) out.push("En el dato, la cifra es la palabra naranja.");
    }
  } else {
    if (words.length < s.minWords || words.length > s.maxWords)
      out.push(`De ${s.minWords} a ${s.maxWords} palabras (tiene ${words.length}).`);
  }
  if (scheme === "A" && !(t.includes("¿") && t.includes("?"))) out.push("La pregunta lleva ¿ y ?.");
  if (scheme === "C" && /[¿?]/.test(t)) out.push("El veredicto va sin signos de pregunta.");
  return out;
}

/**
 * ¿Sirven estos tres esquemas para «Probar y comparar»? Tres distintos, al
 * menos uno con cara y uno sin cara. Devuelve las razones si no.
 */
export function validateSchemeSet(schemes: readonly SchemeId[]): string[] {
  const out: string[] = [];
  if (schemes.length !== 3) out.push("Elige 3 miniaturas.");
  if (new Set(schemes).size !== schemes.length)
    out.push("Los 3 esquemas tienen que ser distintos.");
  if (!schemes.some(hasFace)) out.push("Falta una con cara (A, C, D o F).");
  if (!schemes.some((s) => !hasFace(s))) out.push("Falta una sin cara (B o E).");
  return out;
}

/** Medidas de la composición a 1280 × 720. */
export const THUMB_W = 1280;
export const THUMB_H = 720;
export const SAFE_MARGIN = 64;
/** La esquina de la duración de YouTube: queda vacía. */
export const DURATION_BOX = { x: THUMB_W - 220, y: THUMB_H - 90, w: 220, h: 90 };
/** Separación mínima entre el texto y la cara. */
export const FACE_GAP = 40;
/** Alto de cuerpo (tamaño de la letra, px) del texto; la cifra de B llega a 300. */
export const TEXT_SIZE = { min: 120, max: 150, figureMax: 300 };

export type Rect = { x: number; y: number; w: number; h: number };

export interface SchemeLayout {
  /** Dónde va el bloque de texto. */
  zone: Rect;
  align: "left" | "center";
  anchor: "top" | "middle" | "bottom";
  /** Dónde va el sujeto (para el prompt): fracciones del ancho. */
  subject: string;
}

/** La zona del texto de cada esquema (con espejo en A y C). */
export function schemeLayout(scheme: SchemeId, mirror = false): SchemeLayout {
  const m = SAFE_MARGIN;
  const inner = { y: m, h: THUMB_H - 2 * m };
  const flip = THUMBNAIL_SCHEMES[scheme].mirror && mirror;
  switch (scheme) {
    case "A":
      return flip
        ? {
            zone: { x: THUMB_W / 2, ...inner, w: THUMB_W / 2 - m },
            align: "left",
            anchor: "middle",
            subject: "left 40%",
          }
        : {
            zone: { x: m, ...inner, w: THUMB_W / 2 - m },
            align: "left",
            anchor: "middle",
            subject: "right 40%",
          };
    case "B":
      return {
        zone: { x: m, ...inner, w: THUMB_W * 0.55 - m },
        align: "left",
        anchor: "middle",
        subject: "right 40%",
      };
    case "C":
      return flip
        ? {
            zone: { x: m, ...inner, w: THUMB_W * 0.4 - m },
            align: "left",
            anchor: "middle",
            subject: "right 45%",
          }
        : {
            zone: { x: THUMB_W * 0.6, ...inner, w: THUMB_W * 0.4 - m },
            align: "left",
            anchor: "middle",
            subject: "left 45%",
          };
    case "D":
      return {
        zone: { x: m, y: m, w: THUMB_W - 2 * m, h: THUMB_H * 0.3 },
        align: "center",
        anchor: "top",
        subject: "products left and right, presenter small at the center",
      };
    case "E":
      return {
        zone: { x: m, ...inner, w: THUMB_W * 0.55 - m },
        align: "left",
        anchor: "bottom",
        subject: "upper right two thirds",
      };
    case "F":
      return {
        zone: { x: m, ...inner, w: THUMB_W * 0.55 - m },
        align: "left",
        anchor: "top",
        subject: "right side",
      };
  }
}
