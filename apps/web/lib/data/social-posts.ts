import "server-only";
import {
  CAPSULE_KINDS,
  parseSocials,
  videoLink,
  type CapsuleKind,
  type ChannelSocial,
  type PostStatus,
} from "@planificador/core";
import { getSupabase } from "../auth";

/** Posts para redes del episodio (Fase 4 · paso 6). */

export type SocialPostView = {
  id: string;
  network: string;
  kind: CapsuleKind;
  text: string;
  status: PostStatus;
  postUrl: string | null;
  publishedAt: string | null;
};

export type EpisodeSocialsView = {
  /** Las redes del canal, cada una con sus cápsulas (en orden dato, mito, postura). */
  networks: (ChannelSocial & { posts: SocialPostView[] })[];
  /** Posts de redes que ya no están en Ajustes (se muestran igual). */
  orphans: SocialPostView[];
  active: boolean;
  error: string | null;
  hasScript: boolean;
  /** El enlace al video para copiar con el post, si ya está en YouTube. */
  link: string | null;
};

export async function loadEpisodeSocials(episode: {
  id: string;
  channelId: string;
  scriptRunId: string | null;
  youtubeVideoId: string | null;
}): Promise<EpisodeSocialsView> {
  const supabase = await getSupabase();
  const [{ data: rows }, { data: settings }, { data: task }, { data: fix }] = await Promise.all([
    supabase
      .from("social_posts")
      .select("id, network, kind, text, status, post_url, published_at")
      .eq("episode_id", episode.id),
    supabase
      .from("distribution_settings")
      .select("socials")
      .eq("channel_id", episode.channelId)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("status, error")
      .eq("episode_id", episode.id)
      .eq("kind", "social_posts")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    episode.scriptRunId
      ? supabase
          .from("script_step_runs")
          .select("run_id")
          .eq("run_id", episode.scriptRunId)
          .eq("step", "fix")
          .eq("status", "succeeded")
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const posts: SocialPostView[] = (rows ?? [])
    .map((r) => ({
      id: r.id,
      network: r.network,
      kind: r.kind as CapsuleKind,
      text: r.text,
      status: r.status as PostStatus,
      postUrl: r.post_url,
      publishedAt: r.published_at,
    }))
    .sort((a, b) => CAPSULE_KINDS.indexOf(a.kind) - CAPSULE_KINDS.indexOf(b.kind));
  const socials = parseSocials(settings?.socials);
  return {
    networks: socials.map((s) => ({ ...s, posts: posts.filter((p) => p.network === s.network) })),
    orphans: posts.filter((p) => !socials.some((s) => s.network === p.network)),
    active: task?.status === "queued" || task?.status === "running",
    error: task?.status === "failed" ? (task.error ?? "errors.unknown") : null,
    hasScript: Boolean(fix),
    link: episode.youtubeVideoId ? videoLink(episode.youtubeVideoId) : null,
  };
}
