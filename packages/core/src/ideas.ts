/**
 * Ideas del banco. En la Fase 2 las recomendaciones llegan con IA; aquí solo
 * vive el modelo y la puntuación con las cinco señales (1 a 5 cada una).
 */
export const IDEA_ORIGINS = ["recommendation", "own", "pain_point"] as const;
export type IdeaOrigin = (typeof IDEA_ORIGINS)[number];

export const IDEA_STATUSES = ["new", "in_progress", "discarded"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

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
