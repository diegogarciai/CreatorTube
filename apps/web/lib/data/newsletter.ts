import "server-only";
import {
  importantComments,
  NEWSLETTER_DEFAULT_COMMENTS,
  parseBrandKit,
  type CommentCorrection,
  type CommentKind,
} from "@planificador/core";
import { getSupabase } from "../auth";
import { EMAIL_CONFIGURED } from "../email";

/** Lo que el boletín necesita del canal: nombre, colores y qué falta para enviar. */
export async function loadNewsletterSetup(channelId: string) {
  const supabase = await getSupabase();
  const [{ data: settings }, { data: brand }] = await Promise.all([
    supabase
      .from("distribution_settings")
      .select("newsletter_name, sender_email, newsletter_segment_id")
      .eq("channel_id", channelId)
      .maybeSingle(),
    supabase.from("brand_kits").select("colors").eq("channel_id", channelId).maybeSingle(),
  ]);
  const kit = parseBrandKit(brand ? { colors: brand.colors } : null);
  const missing = [
    ...(EMAIL_CONFIGURED() ? [] : ["key"]),
    ...(settings?.newsletter_segment_id ? [] : ["segment"]),
    ...(settings?.sender_email ? [] : ["sender"]),
  ];
  return {
    brand: {
      name: settings?.newsletter_name || "El Punto",
      accent: kit.colors.accent,
      ink: kit.colors.canvas,
    },
    missing,
  };
}

export type NewsletterRow = Awaited<ReturnType<typeof loadEpisodeNewsletter>>["newsletter"];

/** Un borrador programado cuya hora ya pasó cuenta como enviado. */
export const effectiveStatus = (n: { status: string; scheduled_at: string | null }, now: Date) =>
  n.status === "scheduled" && n.scheduled_at && new Date(n.scheduled_at) <= now ? "sent" : n.status;

export type CandidateComment = {
  id: string;
  text: string;
  kind: CommentKind | null;
  likes: number;
};

/** Los comentarios que se pueden elegir (los más importantes primero). */
const CANDIDATES = 30;

/** El boletín del episodio, sus comentarios candidatos y la última tarea. */
export async function loadEpisodeNewsletter(channelId: string, episodeId: string) {
  const supabase = await getSupabase();
  const [{ data: newsletter }, { data: comments }, { data: task }] = await Promise.all([
    supabase.from("newsletters").select("*").eq("episode_id", episodeId).maybeSingle(),
    supabase
      .from("youtube_comments")
      .select("comment_id, text, kind, flags, like_count, reply_count, correction")
      .eq("channel_id", channelId)
      .eq("episode_id", episodeId)
      .order("like_count", { ascending: false })
      .limit(300),
    supabase
      .from("tasks")
      .select("status, error")
      .eq("channel_id", channelId)
      .eq("episode_id", episodeId)
      .eq("kind", "newsletter")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const ranked = importantComments(
    (comments ?? []).map((c) => ({
      id: c.comment_id,
      text: c.text,
      kind: c.kind as CommentKind | null,
      flags: c.flags,
      likes: c.like_count,
      replies: c.reply_count,
      correctionValid: (c.correction as CommentCorrection | null)?.valid ?? null,
    })),
    CANDIDATES,
  );
  const candidates: CandidateComment[] = ranked.map((c) => ({
    id: c.id,
    text: c.text,
    kind: c.kind,
    likes: c.likes,
  }));
  const selected = newsletter
    ? newsletter.comment_ids
    : candidates.slice(0, NEWSLETTER_DEFAULT_COMMENTS).map((c) => c.id);
  return { newsletter, candidates, selected, task };
}
