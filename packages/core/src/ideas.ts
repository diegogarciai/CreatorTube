/**
 * Ideas del banco. En la Fase 2 las recomendaciones llegan con IA; aquí solo
 * vive el modelo y la puntuación con las cinco señales (1 a 5 cada una).
 */
export const IDEA_ORIGINS = [
  "recommendation",
  "own",
  "pain_point",
  "search",
  "competitor",
] as const;
export type IdeaOrigin = (typeof IDEA_ORIGINS)[number];

/** «suggested»: propuesta por IA, esperando que alguien la acepte o la descarte. */
export const IDEA_STATUSES = ["new", "in_progress", "discarded", "suggested"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

/** Con menos ideas nuevas que esto, la app avisa que conviene proponer más. */
export const IDEAS_LOW_BANK = 10;

export const IDEA_SIGNALS = ["demand", "fit", "novelty", "effort", "timing"] as const;
export type IdeaSignal = (typeof IDEA_SIGNALS)[number];

export type IdeaSignals = Partial<Record<IdeaSignal, number>>;

/**
 * Puntuación 0..100. "effort" se invierte (menos esfuerzo puntúa más).
 * Las señales vacías no cuentan; sin señales devuelve `null`.
 */
export function ideaScore(signals: IdeaSignals): number | null {
  const values: number[] = [];
  for (const key of IDEA_SIGNALS) {
    const raw = signals[key];
    if (raw === undefined || raw === null || Number.isNaN(raw)) continue;
    const clamped = Math.min(5, Math.max(1, raw));
    values.push(key === "effort" ? 6 - clamped : clamped);
  }
  if (values.length === 0) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(((avg - 1) / 4) * 100);
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Palabras que no dicen de qué trata una búsqueda. */
const STOPWORDS = new Set(
  "de la el los las un una unos unas y o en con sin para por que como cual cuál es vs del al mi tu su lo le se mas más".split(
    " ",
  ),
);

const words = (s: string) =>
  fold(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));

/**
 * ¿Ya hay un video para esta búsqueda? Sí, si algún título o palabra clave
 * del canal tiene todas sus palabras importantes (sin tildes ni mayúsculas).
 */
export function termCovered(term: string, texts: readonly string[]): boolean {
  const need = words(term);
  if (!need.length) return true;
  return texts.some((t) => {
    const have = new Set(words(t));
    return need.every((w) => have.has(w));
  });
}

/** Un video atípico supera esta razón contra la mediana de su canal. */
export const OUTLIER_MIN_RATIO = 3;
/** Y tiene al menos estos días (antes, las vistas todavía no dicen nada). */
export const OUTLIER_MIN_AGE_DAYS = 3;

/**
 * La razón de cada video contra la mediana de vistas de los videos del canal
 * que ya tienen la edad mínima (null si es muy nuevo o no hay con qué comparar).
 */
export function outlierRatios(
  videos: readonly { id: string; views: number; publishedAt: Date }[],
  now: Date,
): { median: number | null; ratios: Map<string, number | null> } {
  const minAge = OUTLIER_MIN_AGE_DAYS * 86_400_000;
  const old = videos.filter((v) => now.getTime() - v.publishedAt.getTime() >= minAge);
  const sorted = old.map((v) => v.views).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length
    ? sorted.length % 2
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2
    : null;
  const ratios = new Map<string, number | null>();
  for (const v of videos) ratios.set(v.id, median && old.includes(v) ? v.views / median : null);
  return { median, ratios };
}
