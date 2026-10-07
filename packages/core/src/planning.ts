import type { EpisodeLike, EpisodeStatus } from "./episodes";
import { statusIndex } from "./episodes";
import { THRESHOLDS } from "./thresholds";
import { addDays, diffDays, isWithin, startOfWeek, type DateKey } from "./time";

/** Datos mínimos de un episodio para los cálculos de Inicio. */
export interface PlannedEpisode extends EpisodeLike {
  id: string;
  title: string;
  /** Instante del último cambio de estado. */
  statusChangedAt: Date;
}

export interface ChannelRhythm {
  /** Meta de episodios por semana. */
  weeklyGoal: number;
}

export function isActive(e: Pick<EpisodeLike, "archivedAt">): boolean {
  return e.archivedAt === null;
}

/**
 * Fecha en que cuenta un episodio para la semana: la de publicación real si
 * ya salió; si no, la planeada.
 */
export function effectiveDate(e: EpisodeLike): DateKey | null {
  return e.publishedOn ?? e.publishDate;
}

export interface WeekCoverage {
  weekStart: DateKey;
  goal: number;
  /** Episodios con fecha en la semana (planeados o publicados). */
  planned: number;
  published: number;
  /** Episodios que faltan planear para llegar a la meta. */
  missing: number;
  /** Fracción de la meta cubierta por episodios planeados (0..1+). */
  ratio: number;
}

export function weekCoverage(
  episodes: readonly EpisodeLike[],
  weekStart: DateKey,
  rhythm: ChannelRhythm,
): WeekCoverage {
  const end = addDays(weekStart, 6);
  const inWeek = episodes.filter((e) => {
    const d = effectiveDate(e);
    return isActive(e) && d !== null && isWithin(d, weekStart, end);
  });
  const published = inWeek.filter((e) => e.status === "published").length;
  const goal = Math.max(0, rhythm.weeklyGoal);
  return {
    weekStart,
    goal,
    planned: inWeek.length,
    published,
    missing: Math.max(0, goal - inWeek.length),
    ratio: goal === 0 ? 1 : inWeek.length / goal,
  };
}

/**
 * Racha: semanas consecutivas cumpliendo la meta de publicados. La semana en
 * curso suma si ya se cumplió, pero no rompe la racha mientras no termine.
 */
export function publishingStreak(
  episodes: readonly EpisodeLike[],
  today: DateKey,
  rhythm: ChannelRhythm,
  maxWeeks = 104,
): number {
  if (rhythm.weeklyGoal <= 0) return 0;
  const publishedPerWeek = new Map<DateKey, number>();
  for (const e of episodes) {
    if (!isActive(e) || e.status !== "published") continue;
    const d = effectiveDate(e);
    if (!d) continue;
    const w = startOfWeek(d);
    publishedPerWeek.set(w, (publishedPerWeek.get(w) ?? 0) + 1);
  }
  const thisWeek = startOfWeek(today);
  let streak = (publishedPerWeek.get(thisWeek) ?? 0) >= rhythm.weeklyGoal ? 1 : 0;
  let week = addDays(thisWeek, -7);
  for (let i = 0; i < maxWeeks; i++) {
    if ((publishedPerWeek.get(week) ?? 0) < rhythm.weeklyGoal) break;
    streak++;
    week = addDays(week, -7);
  }
  return streak;
}

export type Severity = "info" | "warning" | "critical";

export type AlertKind =
  | "overdue_publish"
  | "not_ready"
  | "record_overdue"
  | "week_uncovered"
  | "stale_episode"
  | "scheduled_without_video";

export interface Alert {
  kind: AlertKind;
  severity: Severity;
  episodeId?: string;
  /** Datos para el texto de la alerta (se traduce en la web). */
  params: Record<string, string | number>;
}

const BEFORE_SCHEDULED: EpisodeStatus[] = ["planned", "script", "to_record", "editing"];

export function computeAlerts(
  episodes: readonly PlannedEpisode[],
  today: DateKey,
  rhythm: ChannelRhythm,
  now: Date,
): Alert[] {
  const t = THRESHOLDS.alerts;
  const alerts: Alert[] = [];
  const active = episodes.filter(isActive);

  for (const e of active) {
    if (e.publishDate && BEFORE_SCHEDULED.includes(e.status)) {
      const daysLeft = diffDays(today, e.publishDate);
      if (daysLeft < 0) {
        alerts.push({
          kind: "overdue_publish",
          severity: "critical",
          episodeId: e.id,
          params: { title: e.title, days: -daysLeft },
        });
      } else if (
        daysLeft <= t.notReadyWarnDays &&
        statusIndex(e.status) <= statusIndex("script")
      ) {
        alerts.push({
          kind: "not_ready",
          severity: daysLeft <= t.notReadyCriticalDays ? "critical" : "warning",
          episodeId: e.id,
          params: { title: e.title, days: daysLeft },
        });
      }
    }

    if (
      e.recordDate &&
      diffDays(today, e.recordDate) < 0 &&
      statusIndex(e.status) <= statusIndex("to_record")
    ) {
      alerts.push({
        kind: "record_overdue",
        severity: "warning",
        episodeId: e.id,
        params: { title: e.title, days: -diffDays(today, e.recordDate) },
      });
    }

    if (e.status === "scheduled" && !e.youtubeVideoId) {
      alerts.push({
        kind: "scheduled_without_video",
        severity: "warning",
        episodeId: e.id,
        params: { title: e.title },
      });
    }

    const staleDays = Math.floor((now.getTime() - e.statusChangedAt.getTime()) / 86_400_000);
    if (e.status !== "published" && e.status !== "scheduled" && staleDays >= t.staleDays) {
      alerts.push({
        kind: "stale_episode",
        severity: "info",
        episodeId: e.id,
        params: { title: e.title, days: staleDays },
      });
    }
  }

  const thisWeek = startOfWeek(today);
  for (let i = 0; i <= t.coverageLookaheadWeeks; i++) {
    const week = addDays(thisWeek, i * 7);
    const cov = weekCoverage(active, week, rhythm);
    if (cov.missing > 0) {
      alerts.push({
        kind: "week_uncovered",
        severity: i === 0 ? "critical" : i === 1 ? "warning" : "info",
        params: { weekStart: week, missing: cov.missing, goal: cov.goal },
      });
    }
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

export interface UpcomingDate {
  date: DateKey;
  kind: "record" | "publish";
  episodeId: string;
  title: string;
  status: EpisodeStatus;
}

export function upcomingDates(
  episodes: readonly PlannedEpisode[],
  today: DateKey,
  days = 14,
): UpcomingDate[] {
  const end = addDays(today, days);
  const out: UpcomingDate[] = [];
  for (const e of episodes) {
    if (!isActive(e)) continue;
    if (e.recordDate && isWithin(e.recordDate, today, end) && statusIndex(e.status) <= statusIndex("to_record")) {
      out.push({ date: e.recordDate, kind: "record", episodeId: e.id, title: e.title, status: e.status });
    }
    if (e.publishDate && isWithin(e.publishDate, today, end) && e.status !== "published") {
      out.push({ date: e.publishDate, kind: "publish", episodeId: e.id, title: e.title, status: e.status });
    }
  }
  return out.sort((a, b) => (a.date === b.date ? a.kind.localeCompare(b.kind) : a.date < b.date ? -1 : 1));
}
