/**
 * «Así te fue ayer» (Fase 4): lo que pasó en las últimas ~24 horas, restando
 * las dos fotos diarias más recientes de los contadores públicos de cada video
 * (la Analytics API llega con 2 o 3 días de atraso), y el día típico del canal
 * (mediana de los últimos 28 días completos de Analytics) para comparar.
 */

export type Snapshot = {
  videoId: string;
  /** Fecha local del canal (AAAA-MM-DD). */
  day: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  takenAt: string;
};

export type Counts = { views: number; likes: number; comments: number };

export type YesterdayReport = Counts & {
  /** Las dos fotos que se restan. */
  fromDay: string;
  toDay: string;
  from: string;
  to: string;
  /** El video que más vistas sumó (null si ninguno sumó). */
  top: (Counts & { videoId: string; share: number }) | null;
};

const latestTaken = (rows: Snapshot[]) =>
  rows.reduce((a, r) => (r.takenAt > a ? r.takenAt : a), rows[0]!.takenAt);

/** Resta las dos fotos más recientes; null si todavía no hay dos días. */
export function yesterdayFromSnapshots(snapshots: readonly Snapshot[]): YesterdayReport | null {
  const days = [...new Set(snapshots.map((s) => s.day))].sort().reverse();
  if (days.length < 2) return null;
  const [toDay, fromDay] = days as [string, string];
  const now = snapshots.filter((s) => s.day === toDay);
  const before = new Map(snapshots.filter((s) => s.day === fromDay).map((s) => [s.videoId, s]));
  // Un contador que baja (YouTube corrige vistas no válidas) no resta.
  const diff = (a: number | null, b: number | null | undefined) => Math.max((a ?? 0) - (b ?? 0), 0);
  const perVideo = now.map((s) => {
    const prev = before.get(s.videoId);
    return {
      videoId: s.videoId,
      views: diff(s.views, prev?.views),
      likes: diff(s.likes, prev?.likes),
      comments: diff(s.comments, prev?.comments),
    };
  });
  const sum = (k: keyof Counts) => perVideo.reduce((a, v) => a + v[k], 0);
  const views = sum("views");
  const best = [...perVideo].sort((a, b) => b.views - a.views)[0];
  return {
    views,
    likes: sum("likes"),
    comments: sum("comments"),
    fromDay,
    toDay,
    from: latestTaken(snapshots.filter((s) => s.day === fromDay)),
    to: latestTaken(now),
    top: best && best.views > 0 ? { ...best, share: views ? best.views / views : 0 } : null,
  };
}

export type ChannelDay = {
  day: string;
  views: number;
  watchMinutes: number;
  averageViewDurationS: number;
  subscribersNet: number;
  likes: number;
  comments: number;
};

export type TypicalDay = Omit<ChannelDay, "day">;

export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Al menos una semana de días para que «lo normal» signifique algo. */
export const MIN_TYPICAL_DAYS = 7;
export const TYPICAL_WINDOW = 28;

/** Mediana de los últimos 28 días completos (null con menos de 7). */
export function typicalDay(days: readonly ChannelDay[]): TypicalDay | null {
  const last = [...days].sort((a, b) => a.day.localeCompare(b.day)).slice(-TYPICAL_WINDOW);
  if (last.length < MIN_TYPICAL_DAYS) return null;
  const m = (k: keyof TypicalDay) => median(last.map((d) => d[k]));
  return {
    views: m("views"),
    watchMinutes: m("watchMinutes"),
    averageViewDurationS: m("averageViewDurationS"),
    subscribersNet: m("subscribersNet"),
    likes: m("likes"),
    comments: m("comments"),
  };
}

/** Diferencia contra el día típico (0,3 = 30 % más); null si no hay base. */
export function compare(value: number, typical: number | null | undefined): number | null {
  if (typical === null || typical === undefined || typical <= 0) return null;
  return (value - typical) / typical;
}

/** El último día completo de Analytics. */
export function lastCompleteDay(days: readonly ChannelDay[]): ChannelDay | null {
  return [...days].sort((a, b) => a.day.localeCompare(b.day)).at(-1) ?? null;
}

export const GOOD_DAY = 0.2;
/** Un video «impulsa» el día si trajo al menos esta parte de las vistas. */
export const DRIVER_SHARE = 0.4;

export type DaySummary = {
  tone: "good" | "normal" | "weak" | null;
  /** Diferencia de vistas contra lo normal (null sin día típico). */
  change: number | null;
  /** El video que impulsó el día, si trajo al menos el 40 % de las vistas. */
  driver: { videoId: string; views: number } | null;
};

/** La frase del día, sin IA: buen día, normal o flojo, y qué lo impulsó. */
export function daySummary(y: YesterdayReport, typical: TypicalDay | null): DaySummary {
  const change = compare(y.views, typical?.views);
  const tone =
    change === null ? null : change >= GOOD_DAY ? "good" : change <= -GOOD_DAY ? "weak" : "normal";
  const driver =
    y.top && y.top.share >= DRIVER_SHARE ? { videoId: y.top.videoId, views: y.top.views } : null;
  return { tone, change, driver };
}
