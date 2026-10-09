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

/** Un comentario principal de un video, con si el canal ya le respondió. */
export interface CommentInfo {
  id: string;
  videoId: string;
  authorName: string;
  authorChannelId: string | null;
  text: string;
  likeCount: number;
  publishedAt: Date;
  replyCount: number;
  /** Alguna de las respuestas que vienen con el hilo es del canal. */
  channelReplied: boolean;
}

type Json = Record<string, any>;

export class YouTubeClient {
  quotaUsed = 0;

  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get(path: string, params: Record<string, string>): Promise<Json> {
    return this.call(`${API}/${path}?${new URLSearchParams(params)}`, QUOTA_COST.read);
  }

  private async post(path: string, params: Record<string, string>, body: Json): Promise<Json> {
    return this.call(`${API}/${path}?${new URLSearchParams(params)}`, QUOTA_COST.write, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async call(url: string, cost: number, init: RequestInit = {}): Promise<Json> {
    this.quotaUsed += cost;
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { authorization: `Bearer ${this.accessToken}`, ...init.headers },
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
   * Un canal público por su id (UC…) o su @handle (channels.list: 1 unidad).
   * Devuelve null si no existe.
   */
  async getChannel(
    ref: { id: string } | { handle: string },
  ): Promise<(ChannelInfo & { subscriberCount: number | null }) | null> {
    const json = await this.get("channels", {
      part: "snippet,contentDetails,statistics",
      ...("id" in ref ? { id: ref.id } : { forHandle: ref.handle }),
    });
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
      subscriberCount: num(item.statistics?.subscriberCount),
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

  /**
   * Una página de hilos de comentarios de un video, del más nuevo al más viejo
   * (commentThreads.list: 1 unidad). Marca si el canal `channelYouTubeId` ya
   * respondió entre las respuestas que trae el hilo.
   */
  async listCommentThreads(
    videoId: string,
    opts: { pageToken?: string; channelYouTubeId?: string | null } = {},
  ): Promise<{ comments: CommentInfo[]; nextPageToken: string | null }> {
    const json = await this.get("commentThreads", {
      part: "snippet,replies",
      videoId,
      order: "time",
      maxResults: "100",
      textFormat: "plainText",
      ...(opts.pageToken && { pageToken: opts.pageToken }),
    });
    const comments = (json.items ?? []).map((t: Json): CommentInfo => {
      const top = t.snippet?.topLevelComment;
      const s = top?.snippet ?? {};
      const replies: Json[] = t.replies?.comments ?? [];
      return {
        id: top?.id ?? t.id,
        videoId,
        authorName: s.authorDisplayName ?? "",
        authorChannelId: s.authorChannelId?.value ?? null,
        text: s.textOriginal ?? s.textDisplay ?? "",
        likeCount: Number(s.likeCount ?? 0),
        publishedAt: new Date(s.publishedAt),
        replyCount: Number(t.snippet?.totalReplyCount ?? 0),
        channelReplied: Boolean(
          opts.channelYouTubeId &&
            replies.some((r) => r.snippet?.authorChannelId?.value === opts.channelYouTubeId),
        ),
      };
    });
    return { comments, nextPageToken: json.nextPageToken ?? null };
  }

  /** Responde un comentario (comments.insert: 50 unidades). Devuelve el id de la respuesta. */
  async replyToComment(parentId: string, text: string): Promise<string> {
    const json = await this.post(
      "comments",
      { part: "snippet" },
      { snippet: { parentId, textOriginal: text } },
    );
    return json.id;
  }
}
