import "server-only";
import {
  channelAudience,
  type ChannelAudience,
  type CommentCorrection,
  type CommentFlag,
  type CommentKind,
  type CommentReading,
  type ReplyStatus,
} from "@planificador/core";
import { YOUTUBE_COMMENTS_SCOPE } from "@planificador/youtube";
import { getSupabase } from "../auth";

/** Comentarios del episodio con su clasificación y respuesta (Fase 4 · paso 4). */

export type CommentView = {
  id: string;
  videoId: string;
  author: string;
  text: string;
  likes: number;
  publishedAt: string;
  channelReplied: boolean;
  kind: CommentKind | null;
  flags: CommentFlag[];
  correction: CommentCorrection | null;
  reply: string;
  replyStatus: ReplyStatus;
};

export type EpisodeCommentsView = {
  comments: CommentView[];
  reading: CommentReading | null;
  /** La tarea de clasificación está en marcha o falló. */
  active: boolean;
  error: string | null;
  /** El canal dio el permiso para publicar respuestas. */
  canPublishReplies: boolean;
};

export async function loadEpisodeComments(episode: {
  id: string;
  channelId: string;
}): Promise<EpisodeCommentsView> {
  const supabase = await getSupabase();
  const [{ data: rows }, { data: reading }, { data: task }, { data: conn }] = await Promise.all([
    supabase
      .from("youtube_comments")
      .select(
        "comment_id, video_id, author_name, text, like_count, published_at, channel_replied, kind, flags, correction, reply, reply_status",
      )
      .eq("channel_id", episode.channelId)
      .eq("episode_id", episode.id)
      .order("published_at", { ascending: false })
      .limit(500),
    supabase.from("comment_readings").select("reading").eq("episode_id", episode.id).maybeSingle(),
    supabase
      .from("tasks")
      .select("status, error")
      .eq("episode_id", episode.id)
      .eq("kind", "comments")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc("channel_connection_info", { ch: episode.channelId }),
  ]);
  return {
    comments: (rows ?? []).map((r) => ({
      id: r.comment_id,
      videoId: r.video_id,
      author: r.author_name,
      text: r.text,
      likes: r.like_count,
      publishedAt: r.published_at,
      channelReplied: r.channel_replied,
      kind: r.kind as CommentKind | null,
      flags: r.flags as CommentFlag[],
      correction: (r.correction as unknown as CommentCorrection | null) ?? null,
      reply: r.reply,
      replyStatus: r.reply_status as ReplyStatus,
    })),
    reading: (reading?.reading as unknown as CommentReading | null) ?? null,
    active: task?.status === "queued" || task?.status === "running",
    error: task?.status === "failed" ? (task.error ?? "errors.unknown") : null,
    canPublishReplies: (conn?.[0]?.scopes ?? []).includes(YOUTUBE_COMMENTS_SCOPE),
  };
}

export type AudienceView = ChannelAudience & {
  episodes: Record<string, { code: string; title: string }>;
  /** Comentarios por responder de cada episodio (sin respuesta del canal ni descartados). */
  pending: { episodeId: string; count: number }[];
  hasReadings: boolean;
};

/** Audiencia: las lecturas de todos los episodios juntas y lo que falta responder. */
export async function loadAudience(channelId: string): Promise<AudienceView> {
  const supabase = await getSupabase();
  const [{ data: readings }, { data: open }] = await Promise.all([
    supabase
      .from("comment_readings")
      .select("episode_id, reading, episode:episodes(code, title)")
      .eq("channel_id", channelId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("youtube_comments")
      .select("episode_id")
      .eq("channel_id", channelId)
      .eq("channel_replied", false)
      .in("reply_status", ["suggested", "edited"])
      .neq("kind", "troll_spam")
      .limit(5000),
  ]);
  const list = readings ?? [];
  const counts = new Map<string, number>();
  for (const r of open ?? []) {
    if (r.episode_id) counts.set(r.episode_id, (counts.get(r.episode_id) ?? 0) + 1);
  }
  return {
    ...channelAudience(
      list.map((r) => ({
        episodeId: r.episode_id,
        reading: r.reading as unknown as CommentReading,
      })),
    ),
    episodes: Object.fromEntries(
      list.map((r) => [
        r.episode_id,
        { code: r.episode?.code ?? "", title: r.episode?.title ?? "" },
      ]),
    ),
    pending: [...counts].map(([episodeId, count]) => ({ episodeId, count })),
    hasReadings: list.length > 0,
  };
}
