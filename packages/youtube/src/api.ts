/**
 * Cliente mínimo de la YouTube Data API v3 con contador de cuota.
 * Costos oficiales: cada lectura (list) cuesta 1 unidad; escribir cuesta 50.
 * La cuota diaria (10.000) se comparte entre todos los canales de la app.
 */
const API = "https://www.googleapis.com/youtube/v3";

export const QUOTA_COST = { read: 1, write: 50 } as const;

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
  get quotaExceeded(): boolean {
    return this.reason === "quotaExceeded" || this.reason === "dailyLimitExceeded";
  }
  get unauthorized(): boolean {
    return this.status === 401;
  }
}

export interface ChannelInfo {
  id: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  uploadsPlaylistId: string | null;
  country: string | null;
  defaultLanguage: string | null;
}

export interface VideoInfo {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  privacyStatus: "public" | "private" | "unlisted";
  publishAt: Date | null;
  publishedAt: Date | null;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  /** Etiquetas del video (solo las ve el dueño del canal). */
  tags: string[];
}

/** Duración ISO 8601 (PT1H2M3S) a segundos. */
export function parseIsoDuration(value: string | undefined | null): number | null {
  if (!value) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!m) return null;
  const [, d, h, min, s] = m.map((x) => (x ? Number(x) : 0));
  return (d ?? 0) * 86400 + (h ?? 0) * 3600 + (min ?? 0) * 60 + (s ?? 0);
}

const num = (v: unknown) => (v === undefined || v === null ? null : Number(v));

type Json = Record<string, any>;

export class YouTubeClient {
  quotaUsed = 0;

  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get(path: string, params: Record<string, string>): Promise<Json> {
    const url = `${API}/${path}?${new URLSearchParams(params)}`;
    this.quotaUsed += QUOTA_COST.read;
    const res = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${this.accessToken}` },
    });
    const json = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) {
      const reason = json.error?.errors?.[0]?.reason ?? null;
      throw new YouTubeApiError(
        json.error?.message ?? `YouTube respondió ${res.status}`,
        res.status,
        reason,
      );
    }
    return json;
  }

  /** Canal de la cuenta autorizada (channels.list mine=true). */
  async getMyChannel(): Promise<ChannelInfo | null> {
    const json = await this.get("channels", { part: "snippet,contentDetails", mine: "true" });
    const item = json.items?.[0];
    if (!item) return null;
    return {
      id: item.id,
      title: item.snippet?.title ?? "",
      handle: item.snippet?.customUrl ?? null,
      thumbnailUrl: item.snippet?.thumbnails?.default?.url ?? null,
      uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
      country: item.snippet?.country ?? null,
      defaultLanguage: item.snippet?.defaultLanguage ?? null,
    };
  }

  /**
   * IDs de las subidas más recientes (incluye privadas y programadas para el
   * dueño), hasta `max`. Cada página de 50 cuesta 1 unidad de cuota.
   */
  async listRecentUploadIds(uploadsPlaylistId: string, max = 50): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const json = await this.get("playlistItems", {
        part: "contentDetails",
        playlistId: uploadsPlaylistId,
        maxResults: String(Math.min(50, max - ids.length)),
        ...(pageToken && { pageToken }),
      });
      ids.push(...(json.items ?? []).map((i: Json) => i.contentDetails?.videoId).filter(Boolean));
      pageToken = json.nextPageToken;
    } while (pageToken && ids.length < max);
    return ids.slice(0, max);
  }

  async getVideos(ids: readonly string[]): Promise<VideoInfo[]> {
    const out: VideoInfo[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      if (chunk.length === 0) break;
      const json = await this.get("videos", {
        part: "snippet,status,statistics,contentDetails",
        id: chunk.join(","),
        maxResults: "50",
      });
      for (const v of json.items ?? []) {
        const privacy = v.status?.privacyStatus;
        out.push({
          id: v.id,
          title: v.snippet?.title ?? "",
          description: v.snippet?.description ?? "",
          thumbnailUrl:
            v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url ?? null,
          privacyStatus: privacy === "public" || privacy === "unlisted" ? privacy : "private",
          publishAt: v.status?.publishAt ? new Date(v.status.publishAt) : null,
          // snippet.publishedAt es la fecha de subida; solo cuenta como publicación si es público.
          publishedAt:
            privacy === "public" && v.snippet?.publishedAt ? new Date(v.snippet.publishedAt) : null,
          durationSeconds: parseIsoDuration(v.contentDetails?.duration),
          viewCount: num(v.statistics?.viewCount),
          likeCount: num(v.statistics?.likeCount),
          commentCount: num(v.statistics?.commentCount),
          tags: Array.isArray(v.snippet?.tags) ? v.snippet.tags : [],
        });
      }
    }
    return out;
  }
}
