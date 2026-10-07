import type { EpisodeLike } from "./episodes";
import { statusIndex } from "./episodes";
import { effectiveDate, isActive, weekCoverage, type ChannelRhythm } from "./planning";
import { THRESHOLDS } from "./thresholds";
import { addDays, diffDays, startOfWeek, type DateKey } from "./time";

/**
 * Señales del canal con umbrales Bien / Atención / Crítico, calculadas sin IA.
 * Se basan en la planificación del propio canal (no en métricas derivadas de
 * YouTube, que requieren auditoría de Google: ver el documento de riesgos).
 */
export type SignalLevel = "ok" | "warning" | "critical";

export type SignalKind = "days_since_publish" | "week_coverage" | "pipeline_weeks" | "on_time_rate";

export interface Signal {
  kind: SignalKind;
  level: SignalLevel;
  /** Valor numérico; `null` si aún no hay datos. */
  value: number | null;
}

/** Más alto es mejor. */
function levelHigh(value: number, t: { ok: number; warn: number }): SignalLevel {
  if (value >= t.ok) return "ok";
  if (value >= t.warn) return "warning";
  return "critical";
}

/** Más bajo es mejor. */
function levelLow(value: number, t: { ok: number; warn: number }): SignalLevel {
  if (value < t.ok) return "ok";
  if (value < t.warn) return "warning";
  return "critical";
}

export function daysSinceLastPublish(episodes: readonly EpisodeLike[], today: DateKey): number | null {
  let last: DateKey | null = null;
  for (const e of episodes) {
    if (!isActive(e) || e.status !== "published") continue;
    const d = effectiveDate(e);
    if (d && d <= today && (last === null || d > last)) last = d;
  }
  return last === null ? null : diffDays(last, today);
}

/**
 * Semanas futuras consecutivas (a partir de la próxima) cuya meta está
 * cubierta por episodios que ya pasaron de Planeado.
 */
export function pipelineWeeks(
  episodes: readonly EpisodeLike[],
  today: DateKey,
  rhythm: ChannelRhythm,
  maxWeeks = 12,
): number {
  if (rhythm.weeklyGoal <= 0) return maxWeeks;
  const inProduction = episodes.filter((e) => statusIndex(e.status) >= statusIndex("script"));
  let week = addDays(startOfWeek(today), 7);
  let count = 0;
  for (let i = 0; i < maxWeeks; i++) {
    if (weekCoverage(inProduction, week, rhythm).missing > 0) break;
    count++;
    week = addDays(week, 7);
  }
  return count;
}

export function onTimeRate(episodes: readonly EpisodeLike[], today: DateKey, weeks = 8): number | null {
  const from = addDays(today, -weeks * 7);
  const relevant = episodes.filter(
    (e) => isActive(e) && e.status === "published" && e.publishDate && e.publishedOn && e.publishedOn >= from,
  );
  if (relevant.length === 0) return null;
  const onTime = relevant.filter((e) => e.publishedOn! <= e.publishDate!).length;
  return onTime / relevant.length;
}

export function channelSignals(
  episodes: readonly EpisodeLike[],
  today: DateKey,
  rhythm: ChannelRhythm,
): Signal[] {
  const t = THRESHOLDS.signals;
  const since = daysSinceLastPublish(episodes, today);
  const cov = weekCoverage(episodes, startOfWeek(today), rhythm).ratio;
  const pipe = pipelineWeeks(episodes, today, rhythm);
  const onTime = onTimeRate(episodes, today);
  return [
    {
      kind: "days_since_publish",
      value: since,
      level: since === null ? "warning" : levelLow(since, t.daysSincePublish),
    },
    { kind: "week_coverage", value: cov, level: levelHigh(cov, t.weekCoverage) },
    { kind: "pipeline_weeks", value: pipe, level: levelHigh(pipe, t.pipelineWeeks) },
    {
      kind: "on_time_rate",
      value: onTime,
      level: onTime === null ? "ok" : levelHigh(onTime, t.onTimeRate),
    },
  ];
}
