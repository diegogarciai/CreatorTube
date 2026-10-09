/**
 * Evaluación a 7 días y auditoría mensual (Fase 4 · paso 3): la primera
 * semana del episodio (días 0 a 6 desde que se publicó) contra la mediana de
 * la primera semana de los últimos episodios del canal, los párrafos donde
 * más gente se fue, y lo que Claude aprende de eso. La auditoría junta las
 * evaluaciones de un mes y propone ajustes a la guía y a los temas.
 */

/** La primera semana: el día en que se publicó y los 6 siguientes. */
export const EVALUATION_WINDOW_DAYS = 7;
/** Contra cuántos episodios anteriores se compara. */
export const BASELINE_EPISODES = 10;
/** Por debajo de ±10 % de la mediana, «en línea». */
export const INLINE_BAND = 0.1;

export const EVAL_METRICS = [
  "views",
  "averageViewPercentage",
  "averageViewDurationS",
  "impressions",
  "ctr",
  "likes",
  "comments",
  "subscribersNet",
] as const;
export type EvalMetric = (typeof EVAL_METRICS)[number];

export const VERDICTS = ["above", "inline", "below"] as const;
export type Verdict = (typeof VERDICTS)[number];

export type MetricValues = Partial<Record<EvalMetric, number | null>>;

export type MetricComparison = {
  metric: EvalMetric;
  value: number | null;
  median: number | null;
  /** Diferencia relativa con la mediana ((valor − mediana) / |mediana|). */
  delta: number | null;
  /** Con cuántos episodios se calculó la mediana. */
  samples: number;
};

export type EvaluationDrop = { index: number; text: string; drop: number };

/** Lo que se guarda en `episode_evaluations.data`. */
export type EvaluationData = {
  window: { from: string; to: string };
  metrics: MetricComparison[];
  baseline: { count: number; codes: string[] };
  drops: EvaluationDrop[];
  /** Lo de Claude (vacío mientras la evaluación está pendiente). */
  verdict: Verdict | null;
  summary: string;
  learnings: string[];
};

export const AUDIT_TOPIC_ACTIONS = ["more", "less", "try"] as const;
export type AuditTopicAction = (typeof AUDIT_TOPIC_ACTIONS)[number];

/** Lo que se guarda en `channel_audits.proposals`. */
export type AuditProposals = {
  summary: string;
  guide: { section: string; change: string; evidence: string }[];
  topics: { topic: string; action: AuditTopicAction; evidence: string }[];
};

export function median(values: readonly number[]): number | null {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}

/** Cada métrica del episodio contra la mediana de los anteriores que la tienen. */
export function compareToBaseline(
  current: MetricValues,
  baseline: readonly MetricValues[],
): MetricComparison[] {
  return EVAL_METRICS.map((metric) => {
    const values = baseline
      .map((b) => b[metric])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const med = median(values);
    const value = current[metric];
    const v = typeof value === "number" && Number.isFinite(value) ? value : null;
    return {
      metric,
      value: v,
      median: med,
      delta: v !== null && med !== null && med !== 0 ? (v - med) / Math.abs(med) : null,
      samples: values.length,
    };
  });
}

/** Por encima, en línea o por debajo de la mediana (null sin con qué comparar). */
export function metricTrend(c: Pick<MetricComparison, "delta">): Verdict | null {
  if (c.delta === null) return null;
  if (c.delta > INLINE_BAND) return "above";
  if (c.delta < -INLINE_BAND) return "below";
  return "inline";
}

/** Las métricas que más pesan para el veredicto sugerido. */
const CORE_METRICS: readonly EvalMetric[] = ["views", "averageViewPercentage", "ctr"];

/**
 * El veredicto que sugieren los números (Claude da el suyo con este de
 * referencia): la mayoría entre vistas, % visto y CTR.
 */
export function suggestedVerdict(metrics: readonly MetricComparison[]): Verdict | null {
  const trends = metrics
    .filter((m) => CORE_METRICS.includes(m.metric))
    .map(metricTrend)
    .filter((t): t is Verdict => t !== null);
  if (!trends.length) return null;
  const score = trends.reduce((a, t) => a + (t === "above" ? 1 : t === "below" ? -1 : 0), 0);
  return score > 0 ? "above" : score < 0 ? "below" : "inline";
}

const addDaysIso = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** La primera semana: del día de publicación (UTC, como YouTube Analytics) al sexto. */
export function evaluationWindow(publishedAt: string | Date): { from: string; to: string } {
  const from = (typeof publishedAt === "string" ? publishedAt : publishedAt.toISOString()).slice(
    0,
    10,
  );
  return { from, to: addDaysIso(from, EVALUATION_WINDOW_DAYS - 1) };
}

/** ¿Ya llegaron los datos de los 7 días? (YouTube los publica con 2 o 3 días de atraso). */
export function firstWeekReady(publishedAt: string | Date, lastDataDay: string | null): boolean {
  return lastDataDay !== null && lastDataDay >= evaluationWindow(publishedAt).to;
}

/** El primer día de un mes «AAAA-MM» y el último. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to };
}
