import {
  autoAdvanceFromYouTube,
  diffDays,
  localDateKey,
  type DateKey,
  type EpisodeLike,
  type StageChange,
} from "@planificador/core";
import { YouTubeApiError, YouTubeClient, type VideoInfo } from "./api";
import { OAuthError, refreshAccessToken, type GoogleOAuthConfig, type TokenSet } from "./oauth";

/**
 * Sincronización de un canal: refresca el token si hace falta, trae las
 * subidas recientes, guarda los videos y avanza solos los episodios vinculados
 * a Programado y Publicado. La persistencia se inyecta (`SyncStore`) para poder
 * correrla desde un cron de Vercel hoy y desde el motor de tareas en la Fase 2.
 */

export interface StoredConnection {
  channelId: string;
  timezone: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}

export interface LinkedEpisode extends EpisodeLike {
  id: string;
}

export interface SyncStore {
  saveTokens(channelId: string, tokens: TokenSet): Promise<void>;
  markNeedsReauth(channelId: string, error: string): Promise<void>;
  upsertVideos(channelId: string, videos: VideoInfo[], fetchedAt: Date): Promise<void>;
  linkedEpisodes(channelId: string, videoIds: string[]): Promise<LinkedEpisode[]>;
  updateEpisode(
    episodeId: string,
    change: StageChange,
    video: { scheduledAt: Date | null; publishedAt: Date | null },
  ): Promise<void>;
  recordSync(channelId: string, result: { quotaUsed: number; error: string | null }): Promise<void>;
}

export interface SyncResult {
  channelId: string;
  ok: boolean;
  videos: number;
  advanced: number;
  quotaUsed: number;
  error: string | null;
  needsReauth: boolean;
}

export interface SyncOptions {
  oauth: Pick<GoogleOAuthConfig, "clientId" | "clientSecret">;
  store: SyncStore;
  fetchImpl?: typeof fetch;
  now?: Date;
  /** Subidas recientes a revisar (1 página = 1 unidad de cuota). */
  maxVideos?: number;
}

const REFRESH_MARGIN_MS = 2 * 60_000;

/** El token de acceso vigente: si vence en menos de 2 minutos, lo refresca y lo guarda. */
export async function freshAccessToken(
  conn: StoredConnection,
  oauth: SyncOptions["oauth"],
  store: Pick<SyncStore, "saveTokens">,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<string> {
  if (
    conn.accessToken &&
    conn.tokenExpiresAt &&
    conn.tokenExpiresAt.getTime() - now.getTime() >= REFRESH_MARGIN_MS
  ) {
    return conn.accessToken;
  }
  if (!conn.refreshToken) throw new OAuthError("Sin refresh token", "invalid_grant", 400);
  const tokens = await refreshAccessToken(oauth, conn.refreshToken, fetchImpl, now.getTime());
  await store.saveTokens(conn.channelId, {
    ...tokens,
    refreshToken: tokens.refreshToken ?? conn.refreshToken,
  });
  return tokens.accessToken;
}

export async function syncChannel(conn: StoredConnection, opts: SyncOptions): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const result: SyncResult = {
    channelId: conn.channelId,
    ok: false,
    videos: 0,
    advanced: 0,
    quotaUsed: 0,
    error: null,
    needsReauth: false,
  };

  let client: YouTubeClient | null = null;
  try {
    const accessToken = await freshAccessToken(conn, opts.oauth, opts.store, fetchImpl, now);
    client = new YouTubeClient(accessToken, fetchImpl);
    const channel = await client.getMyChannel();
    if (!channel?.uploadsPlaylistId) throw new Error("El canal no tiene lista de subidas");
    const ids = await client.listRecentUploadIds(channel.uploadsPlaylistId, opts.maxVideos ?? 50);
    const videos = await client.getVideos(ids);
    await opts.store.upsertVideos(conn.channelId, videos, now);
    result.videos = videos.length;

    const byId = new Map(videos.map((v) => [v.id, v]));
    const episodes = await opts.store.linkedEpisodes(conn.channelId, [...byId.keys()]);
    for (const ep of episodes) {
      const video = ep.youtubeVideoId ? byId.get(ep.youtubeVideoId) : undefined;
      if (!video) continue;
      const change = autoAdvanceFromYouTube(ep, video);
      if (change) {
        await opts.store.updateEpisode(ep.id, change, {
          scheduledAt: video.publishAt,
          publishedAt: video.publishedAt,
        });
        result.advanced++;
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
  result.quotaUsed = client?.quotaUsed ?? 0;
  await opts.store.recordSync(conn.channelId, { quotaUsed: result.quotaUsed, error: result.error });
  return result;
}

/**
 * Cada cuánto sincronizar: cada hora si hay algo por publicar cerca (±2 días)
 * y cada 6 horas en canales quietos. Así 10.000 unidades diarias alcanzan para
 * decenas de canales.
 */
export function shouldSync(input: {
  lastSyncedAt: Date | null;
  now: Date;
  timezone: string;
  upcomingPublishDates: DateKey[];
  hasScheduled: boolean;
}): boolean {
  if (!input.lastSyncedAt) return true;
  const minutes = (input.now.getTime() - input.lastSyncedAt.getTime()) / 60_000;
  const today = localDateKey(input.now, input.timezone);
  const busy =
    input.hasScheduled || input.upcomingPublishDates.some((d) => Math.abs(diffDays(today, d)) <= 2);
  return minutes >= (busy ? 55 : 6 * 60 - 5);
}
