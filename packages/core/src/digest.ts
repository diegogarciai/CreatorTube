import {
  computeAlerts,
  upcomingDates,
  weekCoverage,
  type Alert,
  type UpcomingDate,
} from "./planning";
import type { PlannedEpisode } from "./planning";
import { addDays, startOfWeek, type DateKey } from "./time";

/**
 * Resumen semanal por correo (Fase 4 · paso 5): el lunes, la meta de la
 * semana, lo que se graba y se publica, lo atrasado y lo que está en riesgo.
 */
export interface WeeklyDigest {
  weekStart: DateKey;
  weekEnd: DateKey;
  coverage: ReturnType<typeof weekCoverage>;
  /** Cómo cerró la semana pasada (publicados contra la meta). */
  lastWeek: ReturnType<typeof weekCoverage>;
  /** Grabaciones y publicaciones de la semana. */
  agenda: UpcomingDate[];
  /** Lo que ya se pasó de fecha. */
  overdue: Alert[];
  /** Lo que está en riesgo (fechas cercanas sin estar listo, semanas sin cubrir). */
  atRisk: Alert[];
}

const OVERDUE = new Set<Alert["kind"]>(["overdue_publish", "record_overdue"]);

export function weeklyDigest(
  episodes: readonly PlannedEpisode[],
  today: DateKey,
  weeklyGoal: number,
  now: Date,
): WeeklyDigest {
  const rhythm = { weeklyGoal };
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const alerts = computeAlerts(episodes, today, rhythm, now).filter((a) => a.severity !== "info");
  return {
    weekStart,
    weekEnd,
    coverage: weekCoverage(episodes, weekStart, rhythm),
    lastWeek: weekCoverage(episodes, addDays(weekStart, -7), rhythm),
    agenda: upcomingDates(episodes, weekStart, 6).filter((d) => d.date <= weekEnd),
    overdue: alerts.filter((a) => OVERDUE.has(a.kind)),
    atRisk: alerts.filter((a) => !OVERDUE.has(a.kind)),
  };
}

/** ¿Hay algo que contar? (sin meta, sin agenda y sin alertas, no se envía). */
export const digestHasContent = (d: WeeklyDigest) =>
  d.coverage.goal > 0 || d.agenda.length > 0 || d.overdue.length > 0 || d.atRisk.length > 0;
