import "server-only";
import { OUTLIER_MIN_RATIO } from "@planificador/core";
import { getSupabase } from "../auth";

/** Competencia y videos atípicos (banco de ideas). */

export type CompetitorView = {
  id: string;
  youtubeChannelId: string;
  title: string | null;
  handle: string | null;
  thumbnailUrl: string | null;
  medianViews: number | null;
  syncedAt: string | null;
};

export async function loadCompetitors(channelId: string): Promise<CompetitorView[]> {
  const supabase = await getSupabase();
  const { data } = await supabase
    .from("competitor_channels")
    .select("id, youtube_channel_id, title, handle, thumbnail_url, median_views, synced_at")
    .eq("channel_id", channelId)
    .order("created_at");
  return (data ?? []).map((c) => ({
    id: c.id,
    youtubeChannelId: c.youtube_channel_id,
    title: c.title,
    handle: c.handle,
    thumbnailUrl: c.thumbnail_url,
    medianViews: c.median_views === null ? null : Number(c.median_views),
    syncedAt: c.synced_at,
  }));
}

export type OutlierView = {
  competitorId: string;
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  channelTitle: string;
  publishedAt: string;
  views: number;
  ratio: number;
  inIdeas: boolean;
};

/** Los videos atípicos de los últimos 60 días, del más atípico al menos. */
export async function loadOutliers(channelId: string, limit = 12): Promise<OutlierView[]> {
  const supabase = await getSupabase();
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const [{ data }, { data: ideas }] = await Promise.all([
    supabase
      .from("competitor_videos")
      .select(
        "competitor_id, video_id, title, thumbnail_url, published_at, views, ratio, competitor:competitor_channels(title)",
      )
      .eq("channel_id", channelId)
      .gte("ratio", OUTLIER_MIN_RATIO)
      .gte("published_at", since)
      .order("ratio", { ascending: false })
      .limit(limit),
    supabase.from("ideas").select("notes").eq("channel_id", channelId).eq("origin", "competitor"),
  ]);
  const notes = (ideas ?? []).map((i) => i.notes).join(" ");
  return (data ?? []).map((v) => ({
    competitorId: v.competitor_id,
    videoId: v.video_id,
    title: v.title,
    thumbnailUrl: v.thumbnail_url,
    channelTitle: v.competitor?.title ?? "",
    publishedAt: v.published_at,
    views: Number(v.views),
    ratio: Number(v.ratio),
    inIdeas: notes.includes(`youtu.be/${v.video_id}`),
  }));
}
