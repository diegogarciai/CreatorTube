import { YouTubeApiError } from "./api";
import { OAuthError, type GoogleOAuthConfig } from "./oauth";
import { freshAccessToken, type StoredConnection, type SyncStore } from "./sync";

/**
 * Cliente de la YouTube Analytics API (reports.query) y sincronización diaria
 * de la analítica de un canal: métricas por día del canal y de cada video, y la
 * curva de retención. Usa el permiso `yt-analytics.readonly` y su propia cuota
 * (no gasta la de la Data API). YouTube corrige las cifras con 2 o 3 días de
 * atraso, así que los últimos días se vuelven a pedir.
 */
const API = "https://youtubeanalytics.googleapis.com/v2/reports";

export const DAILY_METRICS = [
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "subscribersGained",
  "subscribersLost",
  "likes",
  "comments",
  "shares",
] as const;

export interface DailyMetrics {
  /** AAAA-MM-DD. */
  day: string;
  views: number;
  watchMinutes: number;
  averageViewDurationS: number;
  averageViewPercentage: number;
  subscribersGained: number;
  subscribersLost: number;
  likes: number;
  comments: number;
  shares: number;
}

/** Un punto de la curva de retención: `r` (0 a 1) es la parte del video. */
export interface RetentionPoint {
  r: number;
  /** Proporción de la audiencia que sigue viendo en ese punto (puede pasar de 1 por repeticiones). */
  watch: number;
  /** Retención comparada con videos de largo parecido en YouTube (0 a 1; 0,5 es la mediana). */
  relative: number | null;
}

type Json = Record<string, any>;

export class YouTubeAnalyticsClient {
  requests = 0;

  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** reports.query: devuelve las filas como objetos con el nombre de cada columna. */
  async query(params: Record<string, string>): Promise<Record<string, string | number>[]> {
    const url = `${API}?${new URLSearchParams({ ids: "channel==MINE", ...params })}`;
    this.requests++;
    const res = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${this.accessToken}` },
    });
    const json = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) {
      const reason = json.error?.errors?.[0]?.reason ?? json.error?.status ?? null;
      throw new YouTubeApiError(
        json.error?.message ?? `YouTube Analytics respondió ${res.status}`,
        res.status,
        reason,
      );
    }
    const headers: string[] = (json.columnHeaders ?? []).map((h: Json) => h.name);
    return ((json.rows ?? []) as (string | number)[][]).map((row) =>
      Object.fromEntries(headers.map((h, i) => [h, row[i]!])),
    );
  }

  private async daily(from: string, to: string, filters?: string): Promise<DailyMetrics[]> {
    const rows = await this.query({
      startDate: from,
      endDate: to,
      metrics: DAILY_METRICS.join(","),
      dimensions: "day",
      sort: "day",
      ...(filters ? { filters } : {}),
    });
    const n = (v: unknown) => Number(v ?? 0) || 0;
    return rows.map((r) => ({
      day: String(r.day),
      views: n(r.views),
      watchMinutes: n(r.estimatedMinutesWatched),
      averageViewDurationS: n(r.averageViewDuration),
      averageViewPercentage: n(r.averageViewPercentage),
      subscribersGained: n(r.subscribersGained),
      subscribersLost: n(r.subscribersLost),
      likes: n(r.likes),
      comments: n(r.comments),
      shares: n(r.shares),
    }));
  }

  /** Métricas del canal por día (fechas AAAA-MM-DD, incluidas). */
  channelDaily(from: string, to: string) {
    return this.daily(from, to);
  }

  /** Métricas de un video por día. */
  videoDaily(videoId: string, from: string, to: string) {
    return this.daily(from, to, `video==${videoId}`);
  }

  /** Curva de retención de un video (100 puntos); vacía si aún no hay suficientes vistas. */
  async videoRetention(videoId: string, from: string, to: string): Promise<RetentionPoint[]> {
    const rows = await this.query({
      startDate: from,
      endDate: to,
      metrics: "audienceWatchRatio,relativeRetentionPerformance",
      dimensions: "elapsedVideoTimeRatio",
      sort: "elapsedVideoTimeRatio",
      filters: `video==${videoId}`,
    });
    return rows.map((r) => ({
      r: Number(r.elapsedVideoTimeRatio),
      watch: Number(r.audienceWatchRatio),
      relative:
        r.relativeRetentionPerformance === undefined
          ? null
          : Number(r.relativeRetentionPerformance),
    }));
  }
}

/** Días AAAA-MM-DD en UTC. */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

export interface AnalyticsVideo {
  id: string;
  publishedAt: Date;
}

export interface AnalyticsStore extends Pick<SyncStore, "saveTokens" | "markNeedsReauth"> {
  /** El último día guardado del canal (null si nunca se trajo). */
  lastChannelDay(channelId: string): Promise<string | null>;
  saveChannelDays(channelId: string, days: DailyMetrics[], fetchedAt: Date): Promise<void>;
  /** Videos publicados del canal desde `since`. */
  publishedVideos(channelId: string, since: Date): Promise<AnalyticsVideo[]>;
  saveVideoDays(
    channelId: string,
    videoId: string,
    days: DailyMetrics[],
    fetchedAt: Date,
  ): Promise<void>;
  saveRetention(
    channelId: string,
    videoId: string,
    points: RetentionPoint[],
    fetchedAt: Date,
  ): Promise<void>;
}

export interface AnalyticsResult {
  channelId: string;
  ok: boolean;
  channelDays: number;
  videos: number;
  retention: number;
  requests: number;
  error: string | null;
  needsReauth: boolean;
}

/** Ventanas de la sincronización, en días. */
export const ANALYTICS_WINDOWS = {
  /** La primera vez se trae el historial del canal. */
  firstChannel: 90,
  /** Después, los últimos días (YouTube corrige con atraso). */
  channelRefresh: 7,
  /** Videos con métricas diarias: publicados hace menos de esto. */
  videoDaily: 90,
  /** Videos con curva de retención: publicados hace entre 2 y 60 días. */
  retentionFrom: 2,
  retentionTo: 60,
} as const;

/**
 * Trae la analítica de un canal: sus días (90 la primera vez, después los
 * últimos 7), los días de cada video publicado hace menos de 90 días y la
 * retención de los publicados hace 2 a 60 días.
 */
export async function syncAnalytics(
  conn: StoredConnection,
  opts: {
    oauth: Pick<GoogleOAuthConfig, "clientId" | "clientSecret">;
    store: AnalyticsStore;
    fetchImpl?: typeof fetch;
    now?: Date;
  },
): Promise<AnalyticsResult> {
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const result: AnalyticsResult = {
    channelId: conn.channelId,
    ok: false,
    channelDays: 0,
    videos: 0,
    retention: 0,
    requests: 0,
    error: null,
    needsReauth: false,
  };
  let client: YouTubeAnalyticsClient | null = null;
  try {
    const token = await freshAccessToken(conn, opts.oauth, opts.store, fetchImpl, now);
    client = new YouTubeAnalyticsClient(token, fetchImpl);
    const today = isoDay(now);
    const W = ANALYTICS_WINDOWS;

    const last = await opts.store.lastChannelDay(conn.channelId);
    const from = last
      ? isoDay(addDays(now, -W.channelRefresh))
      : isoDay(addDays(now, -W.firstChannel));
    const days = await client.channelDaily(from, today);
    await opts.store.saveChannelDays(conn.channelId, days, now);
    result.channelDays = days.length;

    const videos = await opts.store.publishedVideos(conn.channelId, addDays(now, -W.videoDaily));
    for (const v of videos) {
      const published = isoDay(v.publishedAt);
      const vDays = await client.videoDaily(v.id, published, today);
      await opts.store.saveVideoDays(conn.channelId, v.id, vDays, now);
      result.videos++;
      const age = (now.getTime() - v.publishedAt.getTime()) / 86_400_000;
      if (age >= W.retentionFrom && age <= W.retentionTo) {
        const points = await client.videoRetention(v.id, published, today);
        if (points.length) {
          await opts.store.saveRetention(conn.channelId, v.id, points, now);
          result.retention++;
        }
      }
    }
    result.ok = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    if (
      (err instanceof OAuthError && err.needsReauth) ||
      (err instanceof YouTubeApiError && err.unauthorized)
    ) {
      result.needsReauth = true;
      await opts.store.markNeedsReauth(conn.channelId, result.error);
    }
  }
  result.requests = client?.requests ?? 0;
  return result;
}
